import axios from 'axios';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SCRAPER_API_KEY) {
  console.error("❌ ERREUR : Identifiants ou clés manquants.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function runScraper() {
  console.log("🚀 Démarrage du test d'extraction...");

  // Colle ici l'URL exacte copiée depuis l'onglet Réseau (Network) de ton navigateur
  const REAL_API_URL = 'https://www.betrail.run/api/events-drizzle?after=2026-10-06&before=2027-10-07&scope=calendar&predicted=1&length=full&offset=0&country=all&forAddition=false';

  try {
    const TARGET_URL = encodeURIComponent(REAL_API_URL);
    const proxyUrl = `http://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&url=${TARGET_URL}`;

    const response = await axios.get(proxyUrl);

    console.log("📌 Statut HTTP :", response.status);
    console.log("📌 Content-Type :", response.headers['content-type']);

    let rawData = response.data;

    // Si les données sont renvoyées sous forme de texte, on tente le parse JSON
    if (typeof rawData === 'string') {
      console.log("📝 Extrait du texte reçu :", rawData.substring(0, 300));
      try {
        rawData = JSON.parse(rawData);
      } catch (e) {
        console.error("❌ Impossible de convertir la réponse en JSON.");
        process.exit(1);
      }
    }

    // Récupération du tableau d'événements
    const events = Array.isArray(rawData) ? rawData : (rawData.data || rawData.events || rawData.races || []);

    console.log(`📊 Nombre d'éléments trouvés : ${events.length}`);

    if (events.length === 0) {
      console.log("⚠️ Structure d'objet reçue :", Object.keys(rawData));
      return;
    }

    const races = events.map(event => ({
      title: event.name || event.title || event.race_name || 'Course sans nom',
      category: (event.distance || 0) > 42 ? 'Ultra Trail' : 'Trail',
      distance: parseFloat(event.distance) || 0,
      elevation: parseInt(event.elevation || event.positive_elevation || 0, 10),
      location: event.city || event.location || 'France',
      region: event.region || 'France',
      lat: parseFloat(event.latitude || event.lat || 46.6),
      lng: parseFloat(event.longitude || event.lng || 1.8),
      price: parseFloat(event.price) || 0,
      ddi: (event.distance || 0) > 80 ? 5 : 3,
      opening_date: new Date().toISOString().split('T')[0],
      race_date: event.date || event.start_date || new Date().toISOString().split('T')[0],
      status: 'Open',
      organizer_url: event.url || 'https://www.betrail.run'
    }));

    const { error } = await supabase
      .from('races')
      .upsert(races, { onConflict: 'title, race_date' });

    if (error) {
      console.error("❌ Erreur Supabase :", error.message);
      process.exit(1);
    }

    console.log("✅ Base de données mise à jour avec succès !");

  } catch (err) {
    console.error("❌ Erreur lors de la requête :", err.message);
    if (err.response) {
      console.error("Détails réponse :", err.response.status, err.response.data);
    }
    process.exit(1);
  }
}

runScraper();

