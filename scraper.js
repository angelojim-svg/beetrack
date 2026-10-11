import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("❌ Erreur : Les clés Supabase sont manquantes dans les variables d'environnement.");
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

async function fetchRacesFromUI() {
    console.log("🌐 Lancement de Chrome Stealth...");
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled'
        ]
    });

    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36');

        console.log("🔑 Navigation vers le calendrier public BeTrail...");
        await page.goto('https://www.betrail.run/calendar', { waitUntil: 'networkidle2', timeout: 60000 });

        // Attendre que les éléments dynamiques se chargent
        await new Promise(resolve => setTimeout(resolve, 6000));

        console.log("📦 Extraction des courses depuis l'interface...");
        const races = await page.evaluate(() => {
            const items = [];
            // Recherche tous les liens pointant vers des courses ou des événements
            const links = document.querySelectorAll('a[href*="/race/"], a[href*="/event/"], div[class*="event"], article');
           
            links.forEach(el => {
                const title = el.innerText ? el.innerText.split('\n')[0].trim() : '';
                const href = el.href || el.querySelector('a')?.href || '';
                if (title && title.length > 3 && !items.some(i => i.title === title)) {
                    items.push({
                        title: title,
                        organizer_url: href.startsWith('http') ? href : `https://www.betrail.run${href}`,
                        location: 'France',
                        race_date: new Date().toISOString().split('T')[0]
                    });
                }
            });
            return items;
        });

        await browser.close();
        return races;
    } catch (err) {
        await browser.close();
        throw new Error(`Échec Puppeteer UI: ${err.message}`);
    }
}


async function runScraper() {
    console.log("🚀 Démarrage du scraper PacePulse (Extraction UI Puppeteer)...");
 
    const today = new Date().toISOString().split('T')[0];
    const currentYear = new Date().getFullYear();
    console.log(`📅 Date de référence (Aujourd'hui) : ${today}`);

    let rawRaces = [];
    try {
        rawRaces = await fetchRacesFromUI();
        console.log(`🔍 ${rawRaces.length} éléments extraits de la page.`);
    } catch (e) {
        console.error("❌ Erreur lors de la récupération des données source :", e.message);
        return;
    }

    let savedCount = 0;

    for (const item of rawRaces) {
        let lat = null;
        let lng = null;

        const coords = await getCachedCoordinates(item.location);
        lat = coords.lat;
        lng = coords.lng;

        const raceRecord = {
            title: item.title,
            category: 'Trail',
            distance: 15,
            elevation: 500,
            location: item.location,
            region: 'France',
            lat: lat,
            lng: lng,
            price: 0,
            ddi: 3,
            opening_date: today,
            race_date: item.race_date,
            status: 'Open',
            organizer_url: item.organizer_url
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

    console.log(`✅ Fin du script ! ${savedCount} courses enregistrées dans Supabase.`);
}

runScraper().catch(err => {
    console.error("❌ Erreur fatale :", err);
    process.exit(1);
});
