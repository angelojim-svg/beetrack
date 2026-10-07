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

function formatDate(rawDate) {
  if (!rawDate) return new Date().toISOString().split('T')[0];
  
  if (!isNaN(rawDate)) {
    const timestamp = Number(rawDate);
    const date = new Date(timestamp > 1e11 ? timestamp : timestamp * 1000);
    return date.toISOString().split('T')[0];
  }

  const parsed = new Date(rawDate);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split('T')[0];
  }

  return new Date().toISOString().split('T')[0];
}

async function runScraper() {
  console.log("🚀 Extraction des données...");

  const REAL_API_URL = 'https://www.betrail.run/api/events-drizzle?after=2026-10-06&before=2027-10-07&scope=calendar&predicted=1&length=full&offset=0&country=all&forAddition=false
';

  try {
    const TARGET_URL = encodeURIComponent(REAL_API_URL);
    const proxyUrl = `http://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&url=${TARGET_URL}`;

    const response = await axios.get(proxyUrl);
    let rawData = response.data;

    if (rawData && rawData.body) {
      rawData = typeof rawData.body === 'string' ? JSON.parse(rawData.body) : rawData.body;
    } else if (typeof rawData === 'string') {
      rawData = JSON.parse(rawData);
    }

    const events = Array.isArray(rawData) 
      ? rawData 
      : (rawData.data || rawData.events || rawData.races || rawData.results || []);

    console.log(`📊 ${events.length} épreuves brutes récupérées !`);

    if (events.length === 0) {
      console.log("⚠️ Aucune course trouvée dans le flux.");
      return;
    }

    const validEvents = events.filter(event => {
      const name = event.name || event.title || event.race_name || event.event_name;
      const distance = parseFloat(event.distance || event.distance_km || event.length || 0);
      return name && name.trim() !== '' && name !== 'Course sans nom' && distance > 0;
    });

    console.log(`📊 ${validEvents.length} épreuves valides conservées sur ${events.length}.`);

    const races = validEvents.map(event => {
      const title = event.name || event.title || event.race_name || event.event_name;
      const distance = parseFloat(event.distance || event.distance_km || event.length || 0);
      const elevation = parseInt(event.elevation || event.positive_elevation || event.denivele || event.ascent || 0, 10);

      return {
        title: title,
        category: distance > 42 ? 'Ultra Trail' : 'Trail',
        distance: distance,
        elevation: elevation,
        location: event.city || event.location || event.town || 'France',
        region: event.region || event.department_name || 'France',
        lat: parseFloat(event.latitude || event.lat || 46.6),
        lng: parseFloat(event.longitude || event.lng || 1.8),
        price: parseFloat(event.price || event.entry_fee || 0),
        ddi: distance > 80 ? 5 : 3,
        opening_date: formatDate(event.opening_date || event.registration_open_date),
        race_date: formatDate(event.date || event.start_date || event.race_date),
        status: 'Open',
        organizer_url: event.url || event.link || 'https://www.betrail.run'
      };
    });

    const { error } = await supabase
      .from('races')
      .upsert(races);

    if (error) {
      console.error("❌ Erreur Supabase :", error.message);
      process.exit(1);
    }

    console.log("✅ Toutes les épreuves valides ont été insérées dans Supabase avec succès !");

  } catch (err) {
    console.error("❌ Erreur :", err.message);
    process.exit(1);
  }
}

runScraper();

