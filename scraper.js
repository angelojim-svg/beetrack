import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("❌ Erreur : Les clés Supabase sont manquantes dans les variables d'environnement.");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// --- GESTION DU CACHE DE GÉOCODAGE ---
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

// Fonction de parsing souple
function parseFrenchDate(dateStr) {
    if (!dateStr) return null;
    let str = String(dateStr).trim();

    // Si c'est déjà au format YYYY-MM-DD ou ISO
    if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
        return str.substring(0, 10);
    }

    // Format JJ/MM/AAAA
    const dmyMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (dmyMatch) {
        return `${dmyMatch[3]}-${dmyMatch[2].padStart(2, '0')}-${dmyMatch[1].padStart(2, '0')}`;
    }

    return null; // Si non reconnu, on renvoie null mais on ne bloque pas la ligne
}

async function getCachedCoordinates(locationName) {
    if (!locationName) return { lat: null, lng: null };
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
    console.log("🚀 Démarrage du scraper PacePulse...");
   
    const today = new Date().toISOString().split('T')[0];

    let rawRaces = [];
    try {
        // ==========================================
        // 👇 TON URL SOURCE ICI 👇
        const targetUrl = "https://www.betrail.run/api/events-drizzle?after=2026-10-07&before=2027-10-08&scope=calendar&predicted=1&length=full&offset=0&country=FR&forAddition=false&overseas=0";
        // ==========================================

        const response = await fetch(targetUrl);
        const json = await response.json();
        rawRaces = Array.isArray(json) ? json : (json.races || json.data || json.results || []);

        console.log(`🔍 ${rawRaces.length} événements bruts récupérés.`);
    } catch (e) {
        console.error("❌ Erreur de récupération :", e.message);
        return;
    }

    let savedCount = 0;
    let skippedPastCount = 0;

    for (const item of rawRaces) {
        const rawDate = item.raceDate || item.date || item.date_start;
        const formattedRaceDate = parseFrenchDate(rawDate);

        // FILTRE SOUPLE : On ne saute la ligne que si on est 100% sûr que la date est passée
        if (formattedRaceDate && formattedRaceDate < today) {
            skippedPastCount++;
            continue;
        }

        const rawOpening = item.openingDate || item.opening_date;
        const formattedOpeningDate = parseFrenchDate(rawOpening);

        let status = item.status || 'Upcoming';
        if (formattedOpeningDate) {
            status = formattedOpeningDate > today ? 'Opening Soon' : 'Open';
        }

        const location = item.location || item.city || item.ville;
        const coords = await getCachedCoordinates(location);

        const raceRecord = {
            title: item.title || item.name || 'Course sans nom',
            category: item.category || 'Trail',
            distance: Number(item.distance) || 0,
            elevation: Number(item.elevation || item.denivele) || 0,
            location: location || 'France',
            region: item.region || 'France',
            lat: coords.lat,
            lng: coords.lng,
            price: Number(item.price || item.tarif) || 0,
            ddi: Number(item.ddi) || 3,
            opening_date: formattedOpeningDate,
            // Si la date formatée n'a pas pu être convertie, on remet la date brute pour ne pas perdre la ligne
            race_date: formattedRaceDate || rawDate || today,
            status: status,
            organizer_url: item.url || item.link || ''
        };

        const { error } = await supabase
            .from('races')
            .upsert(raceRecord, { onConflict: 'title,race_date' });

        if (!error) {
            savedCount++;
        }
    }

    console.log(`✅ Fin du script ! ${savedCount} courses enregistrées. (${skippedPastCount} passées ignorées).`);
}

runScraper().catch(err => console.error("❌ Erreur :", err));
 
