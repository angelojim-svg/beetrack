import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { createClient } from '@supabase/supabase-js';

puppeteer.use(StealthPlugin());

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ ERREUR : Identifiants Supabase manquants.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function scrapeWithNetworkInterception() {
  console.log("🚀 Lancement du navigateur Stealth...");

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled'
    ]
  });

  try {
    const page = await browser.newPage();
    let capturedEvents = null;

    // Écoute de toutes les réponses réseau du navigateur
    page.on('response', async (response) => {
      const url = response.url();
      // On vérifie si la réponse provient de l'API des événements / Drizzle / Betrail API
      if (url.includes('events') || url.includes('drizzle') || url.includes('api')) {
        try {
          const contentType = response.headers()['content-type'] || '';
          if (contentType.includes('application/json')) {
            const data = await response.json();
            const events = Array.isArray(data) ? data : (data.data || data.events || []);
            if (events.length > 0) {
              capturedEvents = events;
              console.log(`🎯 Flux JSON intercepté depuis : ${url}`);
            }
          }
        } catch (e) {
          // Ignorer les réponses non JSON
        }
      }
    });

    console.log("📡 Navigation vers la page calendrier de Betrail...");
    await page.goto('https://www.betrail.run/calendar', {
      waitUntil: 'networkidle2',
      timeout: 90000
    });

    // Attendre 10 secondes pour laisser charger tous les appels réseau
    await new Promise(resolve => setTimeout(resolve, 10000));

    if (!capturedEvents) {
      console.error("❌ Impossible d'intercepter le flux JSON. Cloudflare bloque toujours le chargement de la page.");
      process.exit(1);
    }

    console.log(`📊 ${capturedEvents.length} épreuves brutes récupérées !`);

    const races = capturedEvents.map(event => ({
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
    }

  } catch (err) {
    console.error("❌ Erreur :", err.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

scrapeWithNetworkInterception();
