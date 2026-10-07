import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { createClient } from '@supabase/supabase-js';

// Activation du plugin Stealth anti-bot
puppeteer.use(StealthPlugin());

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ ERREUR : Identifiants Supabase manquants.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function scrapeWithPuppeteer() {
  console.log("🚀 Lancement du navigateur Stealth...");

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

    // 1. Visiter d'abord le calendrier pour déclencher le cookie de session Cloudflare
    console.log("📡 Passage du challenge Cloudflare...");
    await page.goto('https://www.betrail.run/calendar', { 
      waitUntil: 'networkidle2',
      timeout: 60000 
    });

    // Pause de 5 secondes pour laisser Cloudflare valider la session
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 2. Récupérer l'API Drizzle
    const API_URL = 'https://www.betrail.run/api/events-drizzle?after=2026-10-05&before=2027-10-06&scope=calendar&predicted=1&length=full&offset=0&country=all&forAddition=false';
    console.log("📊 Récupération des données API...");

    const responseText = await page.evaluate(async (url) => {
      const res = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        }
      });
      return await res.text();
    }, API_URL);

    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch (e) {
      console.error("❌ Échec Cloudflare. Extrait de la réponse :");
      console.error(responseText.substring(0, 300));
      process.exit(1);
    }

    const events = Array.isArray(responseData) ? responseData : (responseData.data || responseData.events || []);
    console.log(`✅ ${events.length} épreuves récupérées !`);

    const races = events.map(event => ({
      title: event.name || event.title || 'Course sans nom',
      category: (event.distance || 0) > 42 ? 'Ultra Trail' : 'Trail',
      distance: parseFloat(event.distance) || 0,
      elevation: parseInt(event.elevation || event.positive_elevation || 0, 10),
      location: event.city || event.location || 'France',
      region: event.region || 'France',
      lat: parseFloat(event.latitude || event.lat || 46.6),
      lng: parseFloat(event.longitude || event.lng || 1.8),
      price: parseFloat(event.price) || 0,
      ddi: (event.distance || 0) > 80 ? 5 : 3,
      opening_date: new Date().toISOString().split('T')[0],
      race_date: event.date || event.start_date || new Date().toISOString().split('T')[0],
      status: 'Open',
      organizer_url: event.url || 'https://www.betrail.run'
    }));

    if (races.length > 0) {
      const { error } = await supabase
        .from('races')
        .upsert(races, { onConflict: 'title, race_date' });

      if (error) {
        console.error("❌ Erreur Supabase :", error.message);
        process.exit(1);
      }
      console.log("✅ Base de données mise à jour !");
    }

  } catch (err) {
    console.error("❌ Erreur :", err.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

scrapeWithPuppeteer();

