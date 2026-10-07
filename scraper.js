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

  const REAL_API_URL = 'https://www.betrail.run/api/events-drizzle?after=2026-10-06&before=2027-10-07&scope=calendar&predicted=1&length=full&offset=0&country=all&forAddition=false';

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

    const rawEvents = Array.isArray(rawData) 
      ? rawData 
      : (rawData.data || rawData.events || rawData.races || rawData.results || []);

    console.log(`📊 ${rawEvents.length} événements bruts récupérés !`);

    if (rawEvents.length === 0) {
      console.log("⚠️ Aucun événement trouvé.");
      return;
    }

    const races = [];

    for (const item of rawEvents) {
      const eventName = item.name || item.title || item.race_name || item.event_name || '';
      if (!eventName || eventName === 'Course sans nom') continue;

      // Vérifie si l'événement contient un sous-tableau de courses/distances
      const subRaces = item.races || item.distances || item.courses || item.sub_events || item.epreuves || [];

      if (Array.isArray(subRaces) && subRaces.length > 0) {
        // Extraction de chaque sous-course
        for (const sub of subRaces) {
          const subTitle = sub.name || sub.title || `${eventName} - ${sub.distance || sub.length || ''}km`;
          const dist = parseFloat(String(sub.distance || sub.distance_km || sub.length || sub.dist || 0).replace(',', '.'));
          const elev = parseInt(String(sub.elevation || sub.positive_elevation || sub.denivele || sub.ascent || sub.dplus || 0), 10);

          races.push({
            title: subTitle,
            category: dist > 42 ? 'Ultra Trail' : 'Trail',
            distance: dist,
            elevation: elev,
            location: item.city || item.location || sub.city || 'France',
            region: item.region || item.department_name || 'France',
            lat: parseFloat(item.latitude || item.lat || 46.6),
            lng: parseFloat(item.longitude || item.lng || 1.8),
            price: parseFloat(sub.price || sub.entry_fee || item.price || 0),
            ddi: dist > 80 ? 5 : 3,
            opening_date: formatDate(sub.opening_date || item.opening_date),
            race_date: formatDate(sub.date || sub.start_date || item.date || item.start_date),
            status: 'Open',
            organizer_url: sub.url || item.url || 'https://www.betrail.run'
          });
        }
      } else {
        // Si l'objet est déjà une course directe
        const dist = parseFloat(String(item.distance || item.distance_km || item.length || item.dist || 0).replace(',', '.'));
        const elev = parseInt(String(item.elevation || item.positive_elevation || item.denivele || item.ascent || item.dplus || 0), 10);

        races.push({
          title: eventName,
          category: dist > 42 ? 'Ultra Trail' : 'Trail',
          distance: dist,
          elevation: elev,
          location: item.city || item.location || 'France',
          region: item.region || item.department_name || 'France',
          lat: parseFloat(item.latitude || item.lat || 46.6),
          lng: parseFloat(item.longitude || item.lng || 1.8),
          price: parseFloat(item.price || item.entry_fee || 0),
          ddi: dist > 80 ? 5 : 3,
          opening_date: formatDate(item.opening_date),
          race_date: formatDate(item.date || item.start_date),
          status: 'Open',
          organizer_url: item.url || 'https://www.betrail.run'
        });
      }
    }

    console.log(`📊 ${races.length} épreuves individuelles générées.`);

    // Purge des anciennes entrées invalides dans Supabase puis réinsertion
    await supabase.from('races').delete().eq('distance', 0);

    const { error } = await supabase
      .from('races')
      .upsert(races);

    if (error) {
      console.error("❌ Erreur Supabase :", error.message);
      process.exit(1);
    }

    console.log("✅ Toutes les épreuves ont été insérées avec leurs distances et D+ !");

  } catch (err) {
    console.error("❌ Erreur :", err.message);
    process.exit(1);
  }
}

runScraper();

