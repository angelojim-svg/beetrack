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
  return !isNaN(parsed.getTime()) ? parsed.toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
}

function parseCoordinate(val) {
  if (val === undefined || val === null || val === '') return null;
  const num = parseFloat(String(val).replace(',', '.'));
  return isNaN(num) ? null : num;
}

// Fonction pour extraire la latitude et la longitude de n'importe quel objet
function extractCoords(obj, fallbackObj = {}) {
  let lat = parseCoordinate(
    obj.lat || obj.latitude || obj.geo_lat || 
    (obj.coordinates && obj.coordinates[1]) ||
    (obj.geo && obj.geo.lat) ||
    fallbackObj.lat || fallbackObj.latitude || fallbackObj.geo_lat ||
    (fallbackObj.coordinates && fallbackObj.coordinates[1])
  );

  let lng = parseCoordinate(
    obj.lng || obj.longitude || obj.lon || obj.geo_lng ||
    (obj.coordinates && obj.coordinates[0]) ||
    (obj.geo && obj.geo.lng) ||
    fallbackObj.lng || fallbackObj.longitude || fallbackObj.lon || fallbackObj.geo_lng ||
    (fallbackObj.coordinates && fallbackObj.coordinates[0])
  );

  // Si pas de coordonnées, petite variation aléatoire autour du centre pour éviter la superposition parfaite
  if (lat === null || lng === null) {
    lat = 46.6 + (Math.random() - 0.5) * 4;
    lng = 1.8 + (Math.random() - 0.5) * 4;
  }

  return { lat, lng };
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

    const racesMap = new Map();

    for (const item of rawEvents) {
      const eventName = item.name || item.title || item.race_name || item.event_name || '';
      if (!eventName || eventName === 'Course sans nom') continue;

      const subRaces = item.races || item.distances || item.courses || item.sub_events || item.epreuves || [];

      if (Array.isArray(subRaces) && subRaces.length > 0) {
        for (const sub of subRaces) {
          const subTitle = sub.name || sub.title || `${eventName} - ${sub.distance || sub.length || ''}km`;
          const dist = parseFloat(String(sub.distance || sub.distance_km || sub.length || sub.dist || 0).replace(',', '.'));
          const elev = parseInt(String(sub.elevation || sub.positive_elevation || sub.denivele || sub.ascent || sub.dplus || 0), 10);
          const raceDate = formatDate(sub.date || sub.start_date || item.date || item.start_date);
          const coords = extractCoords(sub, item);

          const key = `${subTitle.trim().toLowerCase()}_${raceDate}`;

          if (!racesMap.has(key)) {
            racesMap.set(key, {
              title: subTitle,
              category: dist > 42 ? 'Ultra Trail' : 'Trail',
              distance: dist,
              elevation: elev,
              location: item.city || item.location || sub.city || 'France',
              region: item.region || item.department_name || 'France',
              lat: coords.lat,
              lng: coords.lng,
              price: parseFloat(sub.price || sub.entry_fee || item.price || 0),
              ddi: dist > 80 ? 5 : 3,
              opening_date: formatDate(sub.opening_date || item.opening_date),
              race_date: raceDate,
              status: 'Open',
              organizer_url: sub.url || item.url || 'https://www.betrail.run'
            });
          }
        }
      } else {
        const dist = parseFloat(String(item.distance || item.distance_km || item.length || item.dist || 0).replace(',', '.'));
        const elev = parseInt(String(item.elevation || item.positive_elevation || item.denivele || item.ascent || item.dplus || 0), 10);
        const raceDate = formatDate(item.date || item.start_date);
        const coords = extractCoords(item);

        const key = `${eventName.trim().toLowerCase()}_${raceDate}`;

        if (!racesMap.has(key)) {
          racesMap.set(key, {
            title: eventName,
            category: dist > 42 ? 'Ultra Trail' : 'Trail',
            distance: dist,
            elevation: elev,
            location: item.city || item.location || 'France',
            region: item.region || item.department_name || 'France',
            lat: coords.lat,
            lng: coords.lng,
            price: parseFloat(item.price || item.entry_fee || 0),
            ddi: dist > 80 ? 5 : 3,
            opening_date: formatDate(item.opening_date),
            race_date: raceDate,
            status: 'Open',
            organizer_url: item.url || 'https://www.betrail.run'
          });
        }
      }
    }

    const uniqueRaces = Array.from(racesMap.values());

    // Réinitialisation préalable des entrées existantes
    await supabase.from('races').delete().neq('id', '00000000-0000-0000-0000-000000000000');

    const { error } = await supabase
      .from('races')
      .upsert(uniqueRaces);

    if (error) {
      console.error("❌ Erreur Supabase :", error.message);
      process.exit(1);
    }

    console.log("✅ Toutes les épreuves ont été enregistrées avec leurs emplacements géographiques !");

  } catch (err) {
    console.error("❌ Erreur :", err.message);
    process.exit(1);
  }
}

runScraper();

