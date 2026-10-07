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

// Dictionnaire de secours pour placer les courses selon la ville ou la région
const CITY_COORDINATES = {
  'chamonix': { lat: 45.9237, lng: 6.8694 },
  'marseille': { lat: 43.2965, lng: 5.3698 },
  'paris': { lat: 48.8566, lng: 2.3522 },
  'lyon': { lat: 45.7640, lng: 4.8357 },
  'nice': { lat: 43.7102, lng: 7.2620 },
  'toulouse': { lat: 43.6047, lng: 1.4442 },
  'bordeaux': { lat: 44.8378, lng: -0.5792 },
  'grenoble': { lat: 45.1885, lng: 5.7245 },
  'annecy': { lat: 45.8992, lng: 6.1294 },
  'le puy-en-velay': { lat: 45.0428, lng: 3.8829 },
  'forcalquier': { lat: 43.9592, lng: 5.7888 },
  'plourhan': { lat: 48.6314, lng: -2.8711 },
  'rennes': { lat: 48.1172, lng: -1.6778 },
  'strasbourg': { lat: 48.5734, lng: 7.7521 },
  'auvergne-rhône-alpes': { lat: 45.5, lng: 5.5 },
  'paca': { lat: 43.8, lng: 6.0 },
  'provence-alpes-côte d\'azur': { lat: 43.8, lng: 6.0 },
  'occitanie': { lat: 43.6, lng: 2.2 },
  'bretagne': { lat: 48.2, lng: -2.9 },
  'île-de-france': { lat: 48.8, lng: 2.3 },
  'grand est': { lat: 48.6, lng: 5.8 },
  'nouvelle-aquitaine': { lat: 44.8, lng: -0.5 }
};

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
  return isNaN(num) || num === 0 ? null : num;
}

function extractCoords(obj, fallbackObj = {}) {
  // 1. Recherche directe dans les propriétés de l'objet
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

  if (lat && lng) return { lat, lng };

  // 2. Recherche par correspondance de ville/région
  const locationName = (obj.city || obj.location || obj.town || fallbackObj.city || fallbackObj.location || '').toLowerCase().trim();
  const regionName = (obj.region || obj.department_name || fallbackObj.region || '').toLowerCase().trim();

  for (const [key, coords] of Object.entries(CITY_COORDINATES)) {
    if (locationName.includes(key) || regionName.includes(key)) {
      // Petite variation aléatoire pour ne pas superposer exactement les courses de la même ville
      return {
        lat: coords.lat + (Math.random() - 0.5) * 0.05,
        lng: coords.lng + (Math.random() - 0.5) * 0.05
      };
    }
  }

  // 3. Fallback distribué sur l'ensemble du territoire métropolitain
  return {
    lat: 43.5 + Math.random() * 6.5, // De 43.5 (Sud) à 50.0 (Nord)
    lng: -1.0 + Math.random() * 8.5 // De -1.0 (Ouest) à 7.5 (Est)
  };
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

    // Réinitialisation préalable
    await supabase.from('races').delete().neq('id', '00000000-0000-0000-0000-000000000000');

    const { error } = await supabase
      .from('races')
      .upsert(uniqueRaces);

    if (error) {
      console.error("❌ Erreur Supabase :", error.message);
      process.exit(1);
    }

    console.log(`✅ ${uniqueRaces.length} épreuves insérées et bien réparties sur la carte !`);

  } catch (err) {
    console.error("❌ Erreur :", err.message);
    process.exit(1);
  }
}

runScraper();


