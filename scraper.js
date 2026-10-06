import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ ERREUR : Clés Supabase manquantes.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false }
});

// Exemple de flux RSS / JSON de courses ou API partenaires
// Ici, on simule l'acquisition automatique de données d'un calendrier partenaires
async function fetchExternalRaces() {
  console.log("🔍 Recherche de nouvelles courses sur les flux partenaires...");

  // Exemples de données capturées par le scraper
  // Dans un cas réel, tu utilises `fetch()` sur une API ou un parser HTML (ex: Cheerio)
  const scrapedRaces = [
    {
      title: 'Trail des Maures 2027',
      category: 'Trail',
      distance: 45,
      elevation: 2600,
      location: 'Collobrières',
      region: 'PAC',
      lat: 43.2381,
      lng: 6.3094,
      price: 48,
      ddi: 3,
      opening_date: new Date(Date.now() + 86400000 * 5).toISOString(), // Dans 5 jours
      race_date: '2027-05-16',
      status: 'Closed',
      organizer_url: 'https://www.traildesmaures.com'
    },
    {
      title: 'Marathon du Mont-Blanc 2027',
      category: 'Trail',
      distance: 42,
      elevation: 2540,
      location: 'Chamonix',
      region: 'Auvergne-Rhône-Alpes',
      lat: 45.9237,
      lng: 6.8694,
      price: 75,
      ddi: 5,
      opening_date: new Date(Date.now() + 86400000 * 12).toISOString(),
      race_date: '2027-06-27',
      status: 'Closed',
      organizer_url: 'https://www.marathonmontblanc.fr'
    }
  ];

  let addedCount = 0;

  for (const race of scrapedRaces) {
    // 1. Vérifier si la course existe déjà dans Supabase
    const { data: existing } = await supabase
      .from('races')
      .select('id')
      .eq('title', race.title)
      .maybeSingle();

    // 2. Si elle n'existe pas, on l'insère
    if (!existing) {
      const { error } = await supabase.from('races').insert([race]);
      if (!error) {
        console.log(`✨ Nouvelle course ajoutée au catalogue : ${race.title}`);
        addedCount++;
      } else {
        console.error(`Erreur d'ajout pour ${race.title}:`, error.message);
      }
    } else {
      console.log(`ℹ️ La course "${race.title}" est déjà présente dans la base.`);
    }
  }

  console.log(`✅ Veille terminée : ${addedCount} nouvelle(s) course(s) ajoutée(s).`);
}

fetchExternalRaces();
