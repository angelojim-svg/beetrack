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
  console.log("🚀 Lancement du scraper via ScraperAPI (avec rendu JS)...");

  try {
    // URL exacte récupérée depuis l'onglet Réseau/Network de ton navigateur
    const TARGET_URL = encodeURIComponent('https://www.betrail.run/api/events-drizzle?after=2026-10-05&before=2027-10-06&scope=calendar&predicted=1&length=full&offset=0&country=all&forAddition=false');
    
    // Ajout de render=true pour forcer l'exécution du JavaScript
    const proxyUrl = `http://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&url=${TARGET_URL}&render=true`;

    const response = await axios.get(proxyUrl);

    // Inspection du contenu reçu dans les logs GitHub
    console.log("Type de données reçues :", typeof response.data);
    
    let rawData = response.data;
    if (typeof rawData === 'string') {
      try {
        rawData = JSON.parse(rawData);
      } catch (e) {
        console.error("⚠️ La réponse reçue n'est pas du JSON brut. Aperçu :");
        console.error(rawData.substring(0, 300));
        process.exit(1);
      }
    }

    const events = Array.isArray(rawData) ? rawData : (rawData.data || rawData.events || []);

    console.log(`📊 ${events.length} épreuves récupérées !`);

    if (events.length === 0) {
      console.log("⚠️ Le tableau d'événements est vide.");
      return;
    }

    const races = events.map(event => ({
      title: event.name || event.title || 'Course sans nom',
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
    console.error("❌ Erreur de requête :", err.message);
    process.exit(1);
  }
}

runScraper();


