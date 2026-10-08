import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const scraperApiKey = process.env.SCRAPER_API_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("❌ Erreur : Les clés Supabase sont manquantes dans les variables d'environnement.");
    process.exit(1);
}

if (!scraperApiKey) {
    console.error("❌ Erreur : La clé SCRAPER_API_KEY est manquante dans les secrets GitHub.");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const CACHE_FILE = path.join(__dirname, 'geocode_cache.json');
let geoCache = {};

if (fs.existsSync(CACHE_FILE)) {
    try {
        geoCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    } catch (e) {
        geoCache = {};
    }
}

function saveGeoCache() {
    try {
        fs.writeFileSync(CACHE_FILE, JSON.stringify(geoCache, null, 2));
    } catch (e) {}
}

function parseFrenchDate(dateStr) {
    if (!dateStr) return null;
   
    if (typeof dateStr === 'number' || /^\d{10,13}$/.test(dateStr)) {
        const timestamp = Number(dateStr) > 1e11 ? Number(dateStr) : Number(dateStr) * 1000;
        const d = new Date(timestamp);
        if (!isNaN(d.getTime())) {
            return d.toISOString().split('T')[0];
        }
    }

    let str = String(dateStr).trim();

    if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
        return str.substring(0, 10);
    }

    const dmyMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (dmyMatch) {
        return `${dmyMatch[3]}-${dmyMatch[2].padStart(2, '0')}-${dmyMatch[1].padStart(2, '0')}`;
    }

    return null;
}

async function getCachedCoordinates(locationName) {
    if (!locationName || locationName === 'France') return { lat: null, lng: null };
    const cleanLocation = locationName.trim().toLowerCase();

    if (geoCache[cleanLocation]) return geoCache[cleanLocation];

    try {
        const encodedQuery = encodeURIComponent(locationName + ", France");
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodedQuery}&limit=1`, {
            headers: { 'User-Agent': 'PacePulseScraper/1.0' }
        });
        const data = await response.json();

        if (data && data.length > 0) {
            const coords = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
            geoCache[cleanLocation] = coords;
            saveGeoCache();
            await new Promise(resolve => setTimeout(resolve, 1000));
            return coords;
        }
    } catch (err) {}
    return { lat: null, lng: null };
}

async function runScraper() {
    console.log("🚀 Démarrage du scraper PacePulse via ScraperAPI...");
   
    const today = new Date().toISOString().split('T')[0];
    console.log(`📅 Date de référence (Aujourd'hui) : ${today}`);

    let rawRaces = [];
    try {
        const targetUrl = `https://www.betrail.run/api/events-drizzle?after=${today}&before=2027-10-08&scope=calendar&predicted=18&length=full&offset=0&country=FR&forAddition=false&overseas=0`;

        const scraperApiUrl = `https://api.scraperapi.com?api_key=${scraperApiKey}&render=false&country_code=fr&timeout=60000&url=${encodeURIComponent(targetUrl)}`;

        console.log(`📡 Connexion à l'API via ScraperAPI...`);

        const response = await fetch(scraperApiUrl);

        if (!response.ok) {
            throw new Error(`Erreur HTTP ScraperAPI ! statut : ${response.status}`);
        }

        const json = await response.json();
       
        const dataContainer = json.body || json;
        rawRaces = Array.isArray(dataContainer) ? dataContainer : (dataContainer.events || dataContainer.races || dataContainer.data || dataContainer.results || []);

        console.log(`🔍 ${rawRaces.length} événements bruts récupérés.`);

        if (rawRaces.length > 0) {
            console.log("📦 Structure complète du 1er événement :", JSON.stringify(rawRaces[0], null, 2));
        }
    } catch (e) {
        console.error("❌ Erreur lors de la récupération des données source :", e.message);
        return;
    }

    let savedCount = 0;
    let skippedPastCount = 0;
    let loggedCount = 0;

    for (const item of rawRaces) {
        const trails = (item.trail && Array.isArray(item.trail) && item.trail.length > 0) ? item.trail : [item];

        for (const trailItem of trails) {
            const location = trailItem.place || trailItem.location || item.location || item.city || 'France';
           
            let lat = Number(trailItem.geo_lat || trailItem.lat || trailItem.latitude || item.lat || item.latitude) || null;
            let lng = Number(trailItem.geo_lon || trailItem.lng || trailItem.longitude || item.lng || item.longitude) || null;

            if (!lat || !lng) {
                const coords = await getCachedCoordinates(location);
                lat = coords.lat;
                lng = coords.lng;
            }

            const subItems = (trailItem.races && Array.isArray(trailItem.races) && trailItem.races.length > 0) ? trailItem.races :
                             (trailItem.distances && Array.isArray(trailItem.distances) && trailItem.distances.length > 0) ? trailItem.distances :
                             (item.races && Array.isArray(item.races) && item.races.length > 0) ? item.races : [trailItem];

            for (const subItem of subItems) {
                const rawDate = subItem.raceDate || subItem.date || trailItem.date || item.date;
                const formattedRaceDate = parseFrenchDate(rawDate);

                if (formattedRaceDate && formattedRaceDate < today) {
                    skippedPastCount++;
                    continue;
                }

                const rawOpening = item.openingDate || item.opening_date || trailItem.openingDate || subItem.openingDate;
                const formattedOpeningDate = parseFrenchDate(rawOpening);

                let status = item.status || trailItem.status || subItem.status || 'Upcoming';
                if (formattedOpeningDate) {
                    status = formattedOpeningDate > today ? 'Opening Soon' : 'Open';
                }

                const raceRecord = {
                    title: subItem.title || trailItem.title || item.event_name || item.title || 'Course sans nom',
                    category: subItem.category || trailItem.category || item.category || 'Trail',
                    distance: Number(subItem.distance || subItem.length || subItem.km || 0),
                    elevation: Number(subItem.elevation || subItem.denivele || subItem.dplus || 0),
                    location: location,
                    region: item.region || item.state || 'France',
                    lat: lat,
                    lng: lng,
                    price: Number(subItem.price || subItem.tarif || 0),
                    ddi: Number(item.ddi || trailItem.ddi || subItem.ddi) || 3,
                    opening_date: formattedOpeningDate || formattedRaceDate || today,
                    race_date: formattedRaceDate || rawDate || today,
                    status: status,
                    organizer_url: trailItem.website || item.url || subItem.url || ''
                };

                // Log les 3 premiers enregistrements pour analyser ce qu'on essaie d'insérer
                if (loggedCount < 3) {
                    console.log(`🛠️ [DEBUG Enregistrement ${loggedCount + 1}]`, {
                        title: raceRecord.title,
                        location: raceRecord.location,
                        lat: raceRecord.lat,
                        lng: raceRecord.lng,
                        trailItemPlace: trailItem.place,
                        trailItemGeoLat: trailItem.geo_lat,
                        trailItemGeoLon: trailItem.geo_lon
                    });
                    loggedCount++;
                }

                const { error } = await supabase
                    .from('races')
                    .upsert(raceRecord, { onConflict: 'title,race_date' });

                if (!error) {
                    savedCount++;
                } else {
                    console.error(`Erreur d'insertion pour "${raceRecord.title}" :`, error.message);
                }
            }
        }
    }

    console.log(`✅ Fin du script ! ${savedCount} courses enregistrées. (${skippedPastCount} passées ignorées).`);
}

runScraper().catch(err => {
    console.error("❌ Erreur fatale :", err);
    process.exit(1);
});
