import axios from 'axios';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ ERREUR : Variables d'environnement Supabase manquantes.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function scrapeBetrailApi() {
  console.log("🚀 Lancement du scraping via l'API Betrail...");

  try {
    // ⚠️ Remplace 'VOTRE_URL_EVENTS_DRIZZLE' par l'URL copiée depuis la console DevTools (Network/Réseau)
    const API_URL = 'https://www.betrail.run/api/events-drizzle?after=2026-10-05&before=2027-10-06&scope=calendar&predicted=1&length=full&offset=0&country=all&forAddition=false';

    const response = await axios.get(API_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Referer': 'https://www.betrail.run/'
      }
    });

    const events = Array.isArray(response.data) ? response.data : (response.data.data || response.data.events || []);

    console.log(`📊 ${events.length} épreuves brutes récupérées.`);

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

    if (races.length > 0) {
      const { error } = await supabase
        .from('races')
        .upsert(races, { onConflict: 'title, race_date' });

      if (error) {
        console.error("❌ Erreur Supabase :", error.message);
        process.exit(1);
      }
      console.log("✅ Base de données mise à jour avec succès !");
    } else {
      console.log("⚠️ Aucun événement trouvé dans la réponse API.");
    }

  } catch (err) {
    console.error("❌ Erreur lors de la requête API :", err.message);
    process.exit(1);
  }
}

// On n'exécute QUE cette fonction
scrapeBetrailApi();


