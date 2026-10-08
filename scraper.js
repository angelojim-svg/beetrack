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
            console.log("📦 Structure d'un événement brut Betrail (Diagnostic) :", JSON.stringify(rawRaces[0], null, 2));
        }

    } catch (e) {
        console.error("❌ Erreur lors de la récupération des données source :", e.message);
        return;
    }

    let savedCount = 0;
    let skippedPastCount = 0;

    for (const item of rawRaces) {
        const subItem = (item.races && item.races.length > 0) ? item.races[0] :
                        (item.distances && item.distances.length > 0) ? item.distances[0] : {};

        const rawDate = subItem.raceDate || subItem.date || item.raceDate || item.date || item.date_start;
        const formattedRaceDate = parseFrenchDate(rawDate);

        if (formattedRaceDate && formattedRaceDate < today) {
            skippedPastCount++;
            continue;
        }

        const rawOpening = item.openingDate || item.opening_date || subItem.openingDate;
        const formattedOpeningDate = parseFrenchDate(rawOpening);

        let status = item.status || subItem.status || 'Upcoming';
        if (formattedOpeningDate) {
            status = formattedOpeningDate > today ? 'Opening Soon' : 'Open';
        }

        // Recherche approfondie de la localisation (ville, département, lieu-dit)
        const location = item.location || item.city || item.town || item.place || item.address || item.venue || item.commune || item.department || subItem.location || subItem.city || subItem.place || 'France';

        // Recherche élargie des coordonnées (lat/lng directes)
        let lat = Number(subItem.lat || subItem.latitude || item.lat || item.latitude || item.y || (item.coordinates && item.coordinates[1]) || (item.latlng && item.latlng[0])) || null;
        let lng = Number(subItem.lng || subItem.longitude || item.lng || item.longitude || item.lon || item.x || (item.coordinates && item.coordinates[0]) || (item.latlng && item.latlng[1])) || null;

        // Si pas de coordonnées directes, on tente de géocoder le lieu trouvé
        if (!lat || !lng) {
            const coords = await getCachedCoordinates(location);
            lat = coords.lat;
            lng = coords.lng;
        }

        const raceRecord = {
            title: item.title || item.name || item.event_name || subItem.title || 'Course sans nom',
            category: item.category || subItem.category || item.type || 'Trail',
            distance: Number(subItem.distance || subItem.length || item.distance || item.length || item.km || item.dist) || 0,
            elevation: Number(subItem.elevation || subItem.denivele || item.elevation || item.denivele || item.dplus || item.gain || item.deniv) || 0,
            location: location,
            region: item.region || item.state || 'France',
            lat: lat,
            lng: lng,
            price: Number(subItem.price || subItem.tarif || item.price || item.tarif || item.cost || item.amount) || 0,
            ddi: Number(item.ddi || subItem.ddi) || 3,
            opening_date: formattedOpeningDate || formattedRaceDate || today,
            race_date: formattedRaceDate || rawDate || today,
            status: status,
            organizer_url: item.url || item.link || subItem.url || ''
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

    console.log(`✅ Fin du script ! ${savedCount} courses enregistrées. (${skippedPastCount} passées ignorées).`);
}

runScraper().catch(err => {
    console.error("❌ Erreur fatale :", err);
    process.exit(1);
});
