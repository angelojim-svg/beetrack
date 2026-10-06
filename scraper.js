import puppeteer from 'puppeteer';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ ERREUR : Identifiants Supabase manquants.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function scrapeWithPuppeteer() {
  console.log("🚀 Lancement du navigateur Headless...");

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();

    // Définition d'un User-Agent réaliste
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36');

    // ⚠️ Remplace par l'URL exacte copiée depuis la console (events-drizzle)
    const API_URL = 'VOTRE_URL_EVENTS_DRIZZLE';

    console.log("📡 Envoi de la requête via Puppeteer...");
    
    // Visite initiale de Betrail pour valider le cookie Cloudflare
    await page.goto('https://www.betrail.run/calendar', { waitUntil: 'domcontentloaded' });

    // Exécution du fetch directement dans le contexte du navigateur
    const responseData = await page.evaluate(async (url) => {
      const res = await fetch(url);
      return await res.json();
    }, API_URL);

    const events = Array.isArray(responseData) ? responseData : (responseData.data || responseData.events || []);

    console.log(`📊 ${events.length} épreuves brutes récupérées !`);

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
      console.log("✅ Base de données mise à jour avec succès !");
    } else {
      console.log("⚠️ Aucun événement trouvé dans le JSON.");
    }

  } catch (err) {
    console.error("❌ Erreur de scraping :", err.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

scrapeWithPuppeteer();
