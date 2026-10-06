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
