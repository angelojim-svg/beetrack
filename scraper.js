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

async function fetchWithRetry(url, retries = 3, delay = 3000) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url);
            if (response.ok) {
                return await response.json();
            }
            console.warn(`⚠️ Tentative ${i + 1}/${retries} échouée (Statut ${response.status}). Nouvelle tentative...`);
        } catch (err) {
            console.warn(`⚠️ Tentative ${i + 1}/${retries} erreur réseau : ${err.message}`);
        }
        if (i < retries - 1) {
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    throw new Error("❌ Échec de la récupération après plusieurs tentatives (ScraperAPI 500).");
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
        const json = await fetchWithRetry(scraperApiUrl);
        
        const dataContainer = json.body || json;
        rawRaces = Array.isArray(dataContainer) ? dataContainer : (dataContainer.events || dataContainer.races || dataContainer.data || dataContainer.results || []);

        console.log(`🔍 ${rawRaces.length} événements bruts récupérés.`);
    } catch (e) {
        console.error("❌ Erreur lors de la récupération des données source :", e.message);
        return;
    }

    let savedCount = 0;
    let skippedPastCount = 0;

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
            // Date de la course spécifique au sous-élément
            const rawDate = subItem.date || subItem.raceDate || subItem.start_date || subItem.time || trailObj.date || item.date;
            const formattedRaceDate = parseFrenchDate(rawDate);

            if (formattedRaceDate && formattedRaceDate < today) {
                skippedPastCount++;
                continue; 
            }

            // Extraction robuste de la date d'ouverture depuis betrail_registration (si c'est un objet ou une valeur brute)
            let regRaw = subItem.betrail_registration || trailObj.betrail_registration || item.betrail_registration;
            let regDateRaw = null;
            if (regRaw) {
                if (typeof regRaw === 'object') {
                    regDateRaw = regRaw.openingDate || regRaw.date || regRaw.opens_at || regRaw.opening_date;
                } else {
                    regDateRaw = regRaw;
                }
            }

            const formattedOpeningDate = parseFrenchDate(regDateRaw);

            let status = subItem.status || trailObj.status || item.status || 'Upcoming';
            if (formattedOpeningDate) {
                status = formattedOpeningDate > today ? 'Opening Soon' : 'Open';
            }

            const raceRecord = {
                title: subItem.title || trailObj.title || item.event_name || item.title || 'Course sans nom',
                category: subItem.category || trailObj.category || item.category || 'Trail',
                distance: Number(subItem.distance || subItem.length || subItem.km || 0),
                elevation: Number(subItem.elevation || subItem.denivele || subItem.dplus || 0),
                location: location,
                region: item.region || item.state || 'France',
                lat: lat,
                lng: lng,
                price: Number(subItem.price || subItem.tarif || 0),
                ddi: Number(item.ddi || trailObj.ddi || subItem.ddi) || 3,
                // Si la date d'ouverture existe, on la met. Sinon, on met la date de la course ou aujourd'hui pour respecter la contrainte NOT NULL de Supabase.
                opening_date: formattedOpeningDate || formattedRaceDate || today,
                race_date: formattedRaceDate || rawDate || today, 
                status: status,
                organizer_url: trailObj.website || item.url || subItem.url || ''
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

    console.log(`✅ Fin du script ! ${savedCount} courses enregistrées. (${skippedPastCount} passées ignorées).`);
}

runScraper().catch(err => {
    console.error("❌ Erreur fatale :", err);
    process.exit(1);
});
