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
        console.log(`📦 Cache de géocodage chargé : ${Object.keys(geoCache).length} lieux connus.`);
    } catch (e) {
        geoCache = {};
    }
}

function saveGeoCache() {
    try {
        fs.writeFileSync(CACHE_FILE, JSON.stringify(geoCache, null, 2));
    } catch (e) {
        console.error("⚠️ Impossible de sauvegarder le cache :", e.message);
    }
}

// Fonction de parsing robuste des dates
function parseFrenchDate(dateStr) {
    if (!dateStr) return null;
    if (dateStr instanceof Date) return dateStr.toISOString().split('T')[0];
    if (typeof dateStr === 'number') return new Date(dateStr).toISOString().split('T')[0];

    let str = String(dateStr).trim();

    // Format JJ/MM/AAAA ou JJ-MM-AAAA
    const dmyMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (dmyMatch) {
        return `${dmyMatch[3]}-${dmyMatch[2].padStart(2, '0')}-${dmyMatch[1].padStart(2, '0')}`;
    }

    // Format ISO ou YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
        return str.substring(0, 10);
    }

    // Format textuel français
    const months = {
        'janv': '01', 'janvier': '01', 'jan': '01',
        'févr': '02', 'février': '02', 'fev': '02',
        'mars': '03', 'mar': '03',
        'avr': '04', 'avril': '04',
        'mai': '05',
        'juin': '06',
        'juil': '07', 'juillet': '07',
        'août': '08', 'aout': '08',
        'sept': '09', 'septembre': '09',
        'oct': '10', 'octobre': '10',
        'nov': '11', 'novembre': '11',
        'déc': '12', 'décembre': '12', 'dec': '12'
    };

    const cleanStr = str.toLowerCase().replace(/\./g, '').trim();
    const parts = cleanStr.split(/\s+/);

    if (parts.length >= 3) {
        const day = parts[0].padStart(2, '0');
        const monthKey = Object.keys(months).find(m => parts[1].startsWith(m));
        const year = parts[2];
        if (monthKey && year) {
            return `${year}-${months[monthKey]}-${day}`;
        }
    }

    return null;
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
    } catch (err) {
        console.error(`Erreur géocodage pour "${locationName}" :`, err.message);
    }
    return { lat: null, lng: null };
}

async function runScraper() {
    console.log("🚀 Démarrage du scraper PacePulse...");
   
    const today = new Date().toISOString().split('T')[0];
    console.log(`📅 Date de référence (Aujourd'hui) : ${today}`);

    let rawRaces = [];
    try {
        // ==========================================
        // 👇 METS TON URL SOURCE ICI 👇
        const targetUrl = "https://www.betrail.run/api/events-drizzle?after=2026-10-07&before=2027-10-08&scope=calendar&predicted=1&length=full&offset=0&country=FR&forAddition=false&overseas=0";
        // ==========================================

        const response = await fetch(targetUrl);
        const json = response.ok ? await response.json() : null;

        // Extraction intelligente du tableau (peu importe si le JSON est un tableau direct ou enveloppé)
        if (Array.isArray(json)) {
            rawRaces = json;
        } else if (json) {
            rawRaces = json.races || json.data || json.results || json.items || [];
        }

        console.log(`🔍 ${rawRaces.length} événements bruts récupérés.`);
        if (rawRaces.length > 0) {
            console.log("📦 Aperçu du premier élément brut :", JSON.stringify(rawRaces[0]));
        } else {
            console.warn("⚠️ Attention : Aucun événement trouvé ou structure JSON non reconnue.");
        }
    } catch (e) {
        console.error("❌ Erreur lors de la récupération des données source :", e.message);
        return;
    }

    let savedCount = 0;
    let skippedPastCount = 0;

    for (const item of rawRaces) {
        // Tolérance sur les noms de clés (ex: title ou name ou nom)
        const title = item.title || item.name || item.nom;
        const rawDate = item.raceDate || item.date || item.date_start || item.start_date;
        const rawOpening = item.openingDate || item.opening_date || item.date_ouverture;
        const location = item.location || item.city || item.ville || item.lieu;

        const formattedRaceDate = parseFrenchDate(rawDate);

        // Filtre strict : Ignore si la date est passée ou invalide
        if (!formattedRaceDate || formattedRaceDate < today) {
            skippedPastCount++;
            continue;
        }

        const formattedOpeningDate = parseFrenchDate(rawOpening);

        let status = item.status || 'Upcoming';
        if (formattedOpeningDate) {
            status = formattedOpeningDate > today ? 'Opening Soon' : 'Open';
        }

        const coords = await getCachedCoordinates(location);

        const raceRecord = {
            title: title || 'Course sans nom',
            category: item.category || item.type || 'Trail',
            distance: Number(item.distance) || 0,
            elevation: Number(item.elevation || item.denivele) || 0,
            location: location || 'France',
            region: item.region || 'France',
            lat: coords.lat,
            lng: coords.lng,
            price: Number(item.price || item.tarif) || 0,
            ddi: Number(item.ddi) || 3,
            opening_date: formattedOpeningDate,
            race_date: formattedRaceDate,
            status: status,
            organizer_url: item.url || item.link || ''
        };

        const { error } = await supabase
            .from('races')
            .upsert(raceRecord, { onConflict: 'title,race_date' });

        if (error) {
            console.error(`Erreur d'insertion pour "${title}" :`, error.message);
        } else {
            savedCount++;
        }
    }

    console.log(`✅ Fin du script ! ${savedCount} courses futures enregistrées/mises à jour. (${skippedPastCount} courses passées ignorées).`);
}

runScraper().catch(err => {
    console.error("❌ Erreur fatale :", err);
    process.exit(1);
});
