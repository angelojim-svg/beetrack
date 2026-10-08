import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

// Configuration __dirname pour les ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration Supabase depuis les variables d'environnement GitHub Actions
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
        console.warn("⚠️ Erreur lors de la lecture du cache, réinitialisation.");
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

// Fonction de parsing robuste pour tous les formats de date possibles
function parseFrenchDate(dateStr) {
    if (!dateStr) return null;
   
    // Si c'est déjà un objet Date valide
    if (dateStr instanceof Date) {
        return dateStr.toISOString().split('T')[0];
    }

    let str = String(dateStr).trim();

    // 1. Si format ISO ou YYYY-MM-DD (ex: "2027-06-15T00:00:00.000Z" ou "2027-06-15")
    if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
        return str.substring(0, 10);
    }

    // 2. Format textuel français (ex: "27 févr. 2026")
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

// Fonction de géocodage optimisée avec cache (Nominatim / OpenStreetMap)
async function getCachedCoordinates(locationName) {
    if (!locationName) return { lat: null, lng: null };
    const cleanLocation = locationName.trim().toLowerCase();

    if (geoCache[cleanLocation]) {
        return geoCache[cleanLocation];
    }

    try {
        const encodedQuery = encodeURIComponent(locationName + ", France");
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodedQuery}&limit=1`, {
            headers: { 'User-Agent': 'PacePulseScraper/1.0' }
        });
        const data = await response.json();

        if (data && data.length > 0) {
            const coords = {
                lat: parseFloat(data[0].lat),
                lng: parseFloat(data[0].lon)
            };
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
        // Remplace ici par ta logique de récupération de données brutes (fetch de ton site source)
        // const response = await fetch("TON_URL_HTTPS");
        // rawRaces = await response.json();

        console.log(`🔍 ${rawRaces.length} événements bruts récupérés.`);
    } catch (e) {
        console.error("❌ Erreur lors de la récupération des données source :", e.message);
        return;
    }

    let savedCount = 0;
    let skippedPastCount = 0;

    for (const race of rawRaces) {
        const formattedRaceDate = parseFrenchDate(race.raceDate);

        // 1. FILTRE STRICT : Ignore si la date est passée ou invalide
        if (!formattedRaceDate || formattedRaceDate < today) {
            skippedPastCount++;
            continue;
        }

        const formattedOpeningDate = parseFrenchDate(race.openingDate);

        // 2. Détermination dynamique du statut / alerte d'inscription
        let status = race.status || 'Upcoming';
        if (formattedOpeningDate) {
            if (formattedOpeningDate > today) {
                status = 'Opening Soon'; // Inscriptions bientôt ouvertes (alerte)
            } else {
                status = 'Open'; // Inscriptions ouvertes
            }
        }

        // 3. GÉOCODAGE (via le cache ou l'API)
        const coords = await getCachedCoordinates(race.location);

        // 4. PRÉPARATION DE L'OBJET POUR SUPABASE
        const raceRecord = {
            title: race.title,
            category: race.category || 'Trail',
            distance: Number(race.distance) || 0,
            elevation: Number(race.elevation) || 0,
            location: race.location || 'France',
            region: race.region || 'France',
            lat: coords.lat,
            lng: coords.lng,
            price: Number(race.price) || 0,
            ddi: Number(race.ddi) || 3,
            opening_date: formattedOpeningDate,
            race_date: formattedRaceDate,
            status: status,
            organizer_url: race.url || ''
        };

        // 5. INSERTION DANS SUPABASE
        const { error } = await supabase
            .from('races')
            .upsert(raceRecord, { onConflict: 'title,race_date' });

        if (error) {
            console.error(`Erreur d'insertion pour "${race.title}" :`, error.message);
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
