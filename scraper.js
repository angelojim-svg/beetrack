import axios from 'axios';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ ERREUR : Identifiants Supabase manquants.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function runScraper() {
  console.log("🚀 Lancement du scraper...");

  try {
    // Si tu utilises ScraperAPI pour passer Cloudflare :
    // const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY;
    // const TARGET_URL = encodeURIComponent('VOTRE_URL_EVENTS_DRIZZLE');
    // const response = await axios.get(`http://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&url=${TARGET_URL}`);

    // Si tu appelles ton API directement :
    const API_URL = 'https://www.betrail.run/api/events-drizzle?after=2026-10-05&before=2027-10-06&scope=calendar&predicted=1&length=full&offset=0&country=all&forAddition=false';
    const response = await axios.get(API_URL);

    const events = Array.isArray(response.data) ? response.data : (response.data.data || response.data.events || []);

    console.log(`📊 ${events.length} épreuves récupérées !`);

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
      console.log("✅ Base de données mise à jour !");
    }

  } catch (err) {
    console.error("❌ Erreur :", err.message);
    process.exit(1);
  }
}

runScraper();
