const fs = require('fs');
const path = require('path');

// Fichiers de cache pour les coordonnées géographiques
const CACHE_FILE = path.join(__dirname, 'geocode_cache.json');
let geoCache = {};

// Charger le cache s'il existe
if (fs.existsSync(CACHE_FILE)) {
    try {
        geoCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        console.log(`📦 Cache de géocodage chargé : ${Object.keys(geoCache.length || geoCache).length} lieux connus.`);
    } catch (e) {
        geoCache = {};
    }
}

function saveGeoCache() {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(geoCache, null, 2));
}

// Fonction de géocodage avec cache
async function getCachedCoordinates(locationName) {
    if (!locationName) return { lat: null, lng: null };
    const cleanLocation = locationName.trim().toLowerCase();

    if (geoCache[cleanLocation]) {
        return geoCache[cleanLocation]; // Utilisation directe du cache !
    }

    // Sinon, on fait l'appel API de géocodage habituel
    const coords = await fetchCoordinatesFromAPI(locationName);
   
    if (coords && coords.lat && coords.lng) {
        geoCache[cleanLocation] = coords;
        saveGeoCache(); // Sauvegarde automatique du cache
    }

    return coords;
}
        
    } catch (err) {
        console.error(`Erreur géocodage pour "${locationName}" :`, err.message);
    }

    return { lat: null, lng: null };
}

async function runScraper() {
    console.log("🚀 Démarrage du scraper PacePulse...");
   
    // Date du jour au format YYYY-MM-DD pour ignorer le passé
    const today = new Date().toISOString().split('T')[0];
    console.log(`📅 Filtre actif : Suppression de toutes les courses antérieures au ${today}`);

    // --- REMplace CETTE PARTIE PAR TON EXTRACTION CIBLE (ton URL HTTPS mise à jour) ---
    // Exemple : Récupération des données brutes depuis ton site cible ou ton API source
    let rawRaces = [];
    try {
        // const targetUrl = "TON_URL_HTTPS_CIBLE";
        // const response = await fetch(targetUrl);
        // rawRaces = await response.json();
       
        console.log(`🔍 ${rawRaces.length} événements bruts récupérés.`);
    } catch (e) {
        console.error("❌ Erreur lors de la récupération des données source :", e.message);
        return;
    }

    let savedCount = 0;
    let skippedPastCount = 0;

    for (const race of rawRaces) {
        // 1. FILTRE STRICT : Ignore les courses passées
        if (race.raceDate && race.raceDate < today) {
            skippedPastCount++;
            continue;
        }

        // 2. GÉOCODAGE (via le cache ou l'API)
        const coords = await getCachedCoordinates(race.location);

        // 3. PRÉPARATION DE L'OBJET POUR SUPABASE
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
            opening_date: race.openingDate || null,
            race_date: race.raceDate,
            status: race.status || 'Upcoming',
            organizer_url: race.url || ''
        };

        // 4. INSERTION DANS SUPABASE
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
