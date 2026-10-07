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

// Batch de géocodage rapide
async function preloadCities(cities) {
  const uniqueCities = [...new Set(cities)].filter(c => c && c !== 'France' && !geoCache.has(c.toLowerCase()));
  
  // Exécution par paquets de 10 requêtes simultanées
  const chunkSize = 10;
  for (let i = 0; i < uniqueCities.length; i += chunkSize) {
    const chunk = uniqueCities.slice(i, i + chunkSize);
    await Promise.all(chunk.map(async (cityName) => {
      try {
        const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(cityName)}&type=municipality&limit=1`;
        const res = await axios.get(url, { timeout: 1500 });
        if (res.data?.features?.length > 0) {
          const [lng, lat] = res.data.features[0].geometry.coordinates;
          geoCache.set(cityName.toLowerCase(), { lat, lng });
        }
      } catch (e) {
        // Ignorer en cas de timeout
      }
    }));
  }
}

async function runScraper() {
  console.log("🚀 Extraction ultra-rapide des données...");

  const REAL_API_URL = process.env.BETRAIL_API_URL || 'https://www.finishers.com/courses';

  try {
    const proxyUrl = `http://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&url=${encodeURIComponent(REAL_API_URL)}`;
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

    // 1. Pré-extraction des villes à géocoder
    const citiesToFetch = rawEvents.map(item => {
      const lat = parseCoord(item.lat || item.latitude || (item.coordinates && item.coordinates[1]));
      if (!lat) {
        const eventName = item.name || item.title || item.race_name || '';
        return cleanCityName(eventName, item.city || item.location || item.town || '', item.region);
      }
      return null;
    }).filter(Boolean);

    console.log(`🌍 Géocodage accéléré de ${citiesToFetch.length} communes...`);
    await preloadCities(citiesToFetch);

    // 2. Traitement direct en mémoire
    const racesMap = new Map();

    for (const item of rawEvents) {
      const eventName = item.name || item.title || item.race_name || item.event_name || '';
      if (!eventName || eventName === 'Course sans nom') continue;

      const subRaces = item.races || item.distances || item.courses || item.sub_events || item.epreuves || [];
      const city = cleanCityName(eventName, item.city || item.location || item.town || '', item.region);
      const region = item.region || item.department_name || 'France';

// Verification stricte des coordonnées avant d'appliquer le jitter
let baseLat = parseCoord(item.lat || item.latitude || (item.coordinates && item.coordinates[1]));
let baseLng = parseCoord(item.lng || item.longitude || (item.coordinates && item.coordinates[0]));

// Si les coordonnées récupérées sont proches de 0 ou absentes
if (!baseLat || !baseLng || Math.abs(baseLat) < 1) {
  const cached = geoCache.get(city.toLowerCase());
  if (cached) {
    baseLat = cached.lat;
    baseLng = cached.lng;
  } else {
    // Si la ville n'est pas trouvée, ne pas mettre 0
    baseLat = null;
    baseLng = null;
  }
}

// On applique le mini décalage seulement si les vraies coordonnées existent
if (baseLat && baseLng) {
  baseLat += (Math.random() - 0.5) * 0.003;
  baseLng += (Math.random() - 0.5) * 0.003;
}


     const processRace = (title, distVal, elevVal, dateVal, subObj = {}) => {
  const dist = parseFloat(String(distVal || 0).replace(',', '.'));
  const elev = parseInt(String(elevVal || 0), 10);
  const raceDate = formatDate(dateVal);
  const key = `${title.trim().toLowerCase()}_${dist}km_${raceDate}`;

  // Vérification stricte : les coordonnées doivent appartenir à la France (lat entre 41 et 52, lng entre -5 et 10)
  let finalLat = null;
  let finalLng = null;

  if (baseLat && baseLng && baseLat > 40 && baseLat < 53) {
    const jitterLat = (Math.random() - 0.5) * 0.003;
    const jitterLng = (Math.random() - 0.5) * 0.003;
    finalLat = baseLat + jitterLat;
    finalLng = baseLng + jitterLng;
  }

  if (!racesMap.has(key)) {
    racesMap.set(key, {
      title: title,
      category: dist > 42 ? 'Ultra Trail' : 'Trail',
      distance: dist,
      elevation: elev,
      location: city,
      region: region,
      lat: finalLat,
      lng: finalLng,
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

    console.log(`✅ ${uniqueRaces.length} épreuves insérées en un temps record !`);

  } catch (err) {
    console.error("❌ Erreur :", err.message);
    process.exit(1);
  }
}

runScraper();

