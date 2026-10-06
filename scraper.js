import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Exemple d'interrogation d'une API/Source de calendrier
async function importFranceRaces() {
    console.log("🚀 Lancement de l'importation nationale...");

    // Exemple de requête vers un endpoint JSON de calendrier
    const response = await fetch('URL_DU_FLUX_OU_API_CALENDRIER');
    const racesFromApi = await response.json();

    const formattedRaces = racesFromApi.map(race => ({
        title: race.nom_epreuve,
        category: race.distance > 42 ? 'Ultra Trail' : 'Trail',
        distance: race.distance,
        elevation: race.denivele || 0,
        location: race.ville,
        region: race.region,
        lat: race.latitude,
        lng: race.longitude,
        price: race.tarif || 0,
        ddi: race.ddi_estime || 3,
        opening_date: race.date_ouverture,
        race_date: race.date_epreuve,
        status: 'Closed',
        organizer_url: race.site_web
    }));

    // Insertion par lots (batch) dans Supabase pour gérer des milliers de lignes
    const { error } = await supabase
        .from('races')
        .upsert(formattedRaces, { onConflict: 'title, race_date' });

    if (error) {
        console.error("Erreur lors de l'importation :", error.message);
    } else {
        console.log("✅ Importation nationale terminée avec succès !");
    }
}

importFranceRaces();

import axios from 'axios';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ ERREUR : Identifiants Supabase manquants.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function scrapeBetrailApi() {
  console.log("🚀 Lancement du scraping via l'API Betrail...");

  try {
    // 1. Colle ici l'URL complète copiée depuis l'onglet En-têtes (URL De Requête)
    const API_URL = 'https://www.betrail.run/api/events-drizzle?after=2026-10-05&before=2027-10-06&scope=calendar&predicted=1&length=full&offset=0&country=all&forAddition=false';

    // 2. Appel direct de l'API JSON
    const response = await axios.get(API_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Referer': 'https://www.betrail.run/'
      }
    });

    // Selon la structure renvoyée par Betrail, les courses sont soit dans response.data, soit response.data.events/data
    const events = Array.isArray(response.data) ? response.data : (response.data.data || response.data.events || []);

    console.log(`📊 ${events.length} épreuves brutes récupérées.`);

    // 3. Transformation des données pour correspondre aux colonnes Supabase
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
      // 4. Insertion dans Supabase
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
    console.error("❌ Erreur de récupération API :", err.message);
    process.exit(1);
  }
}

scrapeBetrailApi();

