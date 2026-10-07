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

// Cache mémoire des villes déjà géocodées pour limiter les requêtes
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

function parseCoordinate(val) {
  if (val === undefined || val === null || val === '') return null;
  const num = parseFloat(String(val).replace(',', '.'));
  return isNaN(num) || num === 0 ? null : num;
}

// Géocodage dynamique via l'API adresse.data.gouv.fr / Nominatim
async function getRealCoordinates(cityName, regionName) {
  const query = `${cityName || ''} ${regionName || ''}`.trim();
  if (!query || query === 'France') return { lat: 46.6, lng: 1.8 };

  if (geoCache.has(query.toLowerCase())) {
    return geoCache.get(query.toLowerCase());
  }

  try {
    // 1. Essai via l'API BAN (France)
    const banUrl = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(query)}&limit=1`;
    const res = await axios.get(banUrl, { timeout: 3000 });

    if (res.data?.features?.length > 0) {
      const [lng, lat] = res.data.features[0].geometry.coordinates;
      const result = { lat, lng };
      geoCache.set(query.toLowerCase(), result);
      return result;
    }
  } catch (e) {
    // Fallback silencieux si timeout
  }

  try {
    // 2. Essai via Nominatim pour les villes hors France (ex: Belgique)
    const nomUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
    const res = await axios.get(nomUrl, { 
      headers: { 'User-Agent': 'PacePulse-App/1.0' },
      timeout: 3000 
    });

    if (res.data?.length > 0) {
      const result = { 
        lat: parseFloat(res.data[0].lat), 
        lng: parseFloat(res.data[0].lon) 
      };
      geoCache.set(query.toLowerCase(), result);
      return result;
    }
  } catch (e) {
    // Fallback silencieux
  }

  // Par défaut centre France si introuvable
  return { lat: 46.6, lng: 1.8 };
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
      const location = item.city || item.location || item.town || '';
      const region = item.region || item.department_name || '';

      // Extraction des coordonnées directes si elles existent dans l'API
      let directLat = parseCoordinate(item.lat || item.latitude || item.geo_lat || (item.coordinates && item.coordinates[1]));
      let directLng = parseCoordinate(item.lng || item.longitude || item.lon || item.geo_lng || (item.coordinates && item.coordinates[0]));

      let coords = { lat: directLat, lng: directLng };

      // Si pas de coordonnées précises fournies par Betrail, on géocode la ville
      if (!coords.lat || !coords.lng) {
        coords = await getRealCoordinates(location, region);
      }

      if (Array.isArray(subRaces) && subRaces.length > 0) {
        for (const sub of subRaces) {
          const subTitle = sub.name || sub.title || `${eventName} - ${sub.distance || sub.length || ''}km`;
          const dist = parseFloat(String(sub.distance || sub.distance_km || sub.length || sub.dist || 0).replace(',', '.'));
          const elev = parseInt(String(sub.elevation || sub.positive_elevation || sub.denivele || sub.ascent || sub.dplus || 0), 10);
          const raceDate = formatDate(sub.date || sub.start_date || item.date || item.start_date);

          const key = `${subTitle.trim().toLowerCase()}_${raceDate}`;

          if (!racesMap.has(key)) {
            racesMap.set(key, {
              title: subTitle,
              category: dist > 42 ? 'Ultra Trail' : 'Trail',
              distance: dist,
              elevation: elev,
              location: location || sub.city || 'France',
              region: region || 'France',
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

        const key = `${eventName.trim().toLowerCase()}_${raceDate}`;

        if (!racesMap.has(key)) {
          racesMap.set(key, {
            title: eventName,
            category: dist > 42 ? 'Ultra Trail' : 'Trail',
            distance: dist,
            elevation: elev,
            location: location || 'France',
            region: region || 'France',
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

    // Nettoyage préalable
    await supabase.from('races').delete().neq('id', '00000000-0000-0000-0000-000000000000');

    const { error } = await supabase
      .from('races')
      .upsert(uniqueRaces);

    if (error) {
      console.error("❌ Erreur Supabase :", error.message);
      process.exit(1);
    }

    console.log(`✅ ${uniqueRaces.length} épreuves géocodées et insérées aux vrais emplacements !`);

  } catch (err) {
    console.error("❌ Erreur :", err.message);
    process.exit(1);
  }
}

runScraper();

