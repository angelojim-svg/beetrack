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
const geoCache = new Map();

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

function parseCoord(val) {
  if (!val) return null;
  const num = parseFloat(String(val).replace(',', '.'));
  return isNaN(num) || num === 0 ? null : num;
}

function cleanCityName(title, city, region) {
  if (city && city.length > 2 && city !== 'France') return city;
  const match = title.match(/(?:trail|course|foulées|ultra)\s+(?:du|des|de|d')?\s*([A-Za-zÀ-ÖØ-öø-ÿ\s-]+)/i);
  if (match && match[1] && match[1].length > 3) {
    return match[1].split('-')[0].trim();
  }
  return region || city || 'France';
}

async function fetchCoordsForCity(cityName) {
  if (!cityName || cityName === 'France') return null;
  const key = cityName.toLowerCase().trim();

  if (geoCache.has(key)) return geoCache.get(key);

  try {
    const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(cityName)}&type=municipality&limit=1`;
    const res = await axios.get(url, { timeout: 2000 });
    
    if (res.data?.features?.length > 0) {
      const [lng, lat] = res.data.features[0].geometry.coordinates;
      const coords = { lat, lng };
      geoCache.set(key, coords);
      return coords;
    }
  } catch (e) {
    // Erreur de temporisation ou réseau
  }
  return null;
}

async function runScraper() {
  console.log("🚀 Extraction des données des épreuves...");

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

    if (rawEvents.length === 0) return;

    const racesMap = new Map();

    for (const item of rawEvents) {
      const eventName = item.name || item.title || item.race_name || item.event_name || '';
      if (!eventName || eventName === 'Course sans nom') continue;

      const subRaces = item.races || item.distances || item.courses || item.sub_events || item.epreuves || [];
      const city = cleanCityName(eventName, item.city || item.location || item.town || '', item.region);
      const region = item.region || item.department_name || 'France';

      let baseLat = parseCoord(item.lat || item.latitude || (item.coordinates && item.coordinates[1]));
      let baseLng = parseCoord(item.lng || item.longitude || (item.coordinates && item.coordinates[0]));

      if (!baseLat || !baseLng) {
        const geo = await fetchCoordsForCity(city);
        if (geo) {
          baseLat = geo.lat;
          baseLng = geo.lng;
        }
      }

      if (!baseLat || !baseLng) {
        baseLat = 43.5 + Math.random() * 6.5;
        baseLng = -1.0 + Math.random() * 8.5;
      }

      const processRace = (title, distVal, elevVal, dateVal, subObj = {}) => {
        const dist = parseFloat(String(distVal || 0).replace(',', '.'));
        const elev = parseInt(String(elevVal || 0), 10);
        const raceDate = formatDate(dateVal);
        
        // Clé unique incluant la distance pour différencier les formats (SaintéLyon 79, 44, etc.)
        const key = `${title.trim().toLowerCase()}_${dist}km_${raceDate}`;

        // Petit décalage aléatoire pour éviter la superposition stricte
        const jitterLat = (Math.random() - 0.5) * 0.003;
        const jitterLng = (Math.random() - 0.5) * 0.003;

        if (!racesMap.has(key)) {
          racesMap.set(key, {
            title: title,
            category: dist > 42 ? 'Ultra Trail' : 'Trail',
            distance: dist,
            elevation: elev,
            location: city,
            region: region,
            lat: baseLat + jitterLat,
            lng: baseLng + jitterLng,
            price: parseFloat(subObj.price || item.price || 0),
            ddi: dist > 80 ? 5 : 3,
            opening_date: formatDate(subObj.opening_date || item.opening_date),
            race_date: raceDate,
            status: 'Open',
            organizer_url: subObj.url || item.url || 'https://www.betrail.run'
          });
        }
      };

      if (Array.isArray(subRaces) && subRaces.length > 0) {
        for (const sub of subRaces) {
          const subTitle = sub.name || sub.title || `${eventName} - ${sub.distance || sub.length || ''}km`;
          processRace(subTitle, sub.distance || sub.length || sub.dist, sub.elevation || sub.positive_elevation, sub.date || sub.start_date || item.date, sub);
        }
      } else {
        processRace(eventName, item.distance || item.length || item.dist, item.elevation || item.positive_elevation, item.date || item.start_date, item);
      }
    }

    const uniqueRaces = Array.from(racesMap.values());

    await supabase.from('races').delete().neq('id', '00000000-0000-0000-0000-000000000000');

    const { error } = await supabase.from('races').upsert(uniqueRaces);

    if (error) {
      console.error("❌ Erreur Supabase :", error.message);
      process.exit(1);
    }

    console.log(`✅ ${uniqueRaces.length} épreuves insérées !`);

  } catch (err) {
    console.error("❌ Erreur :", err.message);
    process.exit(1);
  }
}

runScraper();


