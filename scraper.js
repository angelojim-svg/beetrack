import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const scraperApiKey = process.env.SCRAPER_API_KEY;

if (!supabaseUrl || !supabaseKey || !scraperApiKey) {
    console.error("❌ Erreur : Les clés Supabase ou la SCRAPER_API_KEY sont manquantes dans les variables d'environnement.");
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
    const currentYear = new Date().getFullYear();
    console.log(`📅 Date de référence (Aujourd'hui) : ${today}`);

    let rawRaces = [];
    try {
        const targetUrl = `https://www.betrail.run/api/events?after=${today}&before=2027-10-08&scope=calendar&predicted=1&length=full&offset=0&country=FR&forAddition=false&overseas=0`;
        const scraperApiUrl = `http://api.scraperapi.com?api_key=${scraperApiKey}&url=${encodeURIComponent(targetUrl)}`;

        console.log(`📡 Connexion à l'API BeTrail via ScraperAPI...`);
        const response = await fetch(scraperApiUrl);
        if (!response.ok) {
            throw new Error(`Erreur HTTP ScraperAPI: ${response.status}`);
        }

        const json = await response.json();
        const dataContainer = json.body || json;
        rawRaces = Array.isArray(dataContainer) ? dataContainer : (dataContainer.events || dataContainer.races || dataContainer.data || dataContainer.results || []);

        console.log(`🔍 ${rawRaces.length} événements bruts récupérés.`);
    } catch (e) {
        console.error("❌ Erreur lors de la récupération des données source :", e.message);
        return;
    }

    let savedCount = 0;

    for (const item of rawRaces) {
        const trailObj = (item.trail && Array.isArray(item.trail) && item.trail.length > 0) ? item.trail[0] :
                         (item.trail && typeof item.trail === 'object') ? item.trail : {};

        const location = trailObj.place || trailObj.location || item.place || item.location || item.city || 'France';
     
        let lat = Number(trailObj.geo_lat || trailObj.lat || item.geo_lat || item.lat || item.latitude) || null;
        let lng = Number(trailObj.geo_lon || trailObj.lng || item.geo_lon || item.lon || item.longitude) || null;

        if (!lat || !lng) {
            const coords = await getCachedCoordinates(location);
            lat = coords.lat;
            lng = coords.lng;
        }

        const subItems = (trailObj.races && Array.isArray(trailObj.races) && trailObj.races.length > 0) ? trailObj.races :
                         (trailObj.distances && Array.isArray(trailObj.distances) && trailObj.distances.length > 0) ? trailObj.distances :
                         (item.races && Array.isArray(item.races) && item.races.length > 0) ? item.races : [trailObj];

        for (const subItem of subItems) {
            const rawDate = subItem.date || subItem.raceDate || subItem.start_date || subItem.time || trailObj.date || item.date;
            let formattedRaceDate = parseFrenchDate(rawDate);
            let raceTitle = subItem.title || trailObj.title || item.event_name || item.title || 'Course sans nom';

            let directRegistrationUrl = item.registration_url || subItem.registration_url || trailObj.website || null;
            let formattedOpeningDate = null;
            let status = 'Open';

            if (item.predicted === true || item.prediction_status === 'predicted' || !formattedRaceDate || formattedRaceDate < today) {
                if (formattedRaceDate) {
                    const raceYear = parseInt(formattedRaceDate.split('-')[0]);
                    if (raceYear < currentYear) {
                        continue;
                    }
                    const parts = formattedRaceDate.split('-');
                    formattedRaceDate = `${currentYear + 1}-${parts[1]}-${parts[2]}`;
                } else {
                    formattedRaceDate = `${currentYear + 1}-08-01`;
                }
                raceTitle = raceTitle.replace(String(currentYear), String(currentYear + 1));
                status = 'TBD';
            } else {
                if (directRegistrationUrl || subItem.betrail_registration === 1) {
                    status = 'Open';
                } else {
                    status = 'Opening Soon';
                }
            }

            const extractedPrice = Number(
                subItem.price || subItem.tarif || subItem.registration_price || subItem.entry_fee || subItem.amount ||
                trailObj.price || trailObj.tarif || item.price || item.tarif || 0
            );

            const raceRecord = {
                title: raceTitle,
                category: subItem.category || trailObj.category || item.category || 'Trail',
                distance: Number(subItem.distance || subItem.length || subItem.km || 0),
                elevation: Number(subItem.elevation || subItem.denivele || subItem.dplus || 0),
                location: location,
                region: item.region || item.state || 'France',
                lat: lat,
                lng: lng,
                price: extractedPrice,
                ddi: Number(item.ddi || trailObj.ddi || subItem.ddi) || 3,
                opening_date: formattedOpeningDate || formattedRaceDate || today,
                race_date: formattedRaceDate || today,
                status: status,
                organizer_url: directRegistrationUrl || trailObj.website || (subItem.alias ? `https://www.betrail.run/race/${subItem.alias}` : '')
            };

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

    console.log(`✅ Fin du script ! ${savedCount} courses enregistrées dans Supabase.`);
}

runScraper().catch(err => {
    console.error("❌ Erreur fatale :", err);
    process.exit(1);
});
