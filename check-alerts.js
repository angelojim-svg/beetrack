import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const resendKey = process.env.RESEND_API_KEY;

if (!supabaseUrl || !supabaseKey || !resendKey) {
  console.error("❌ ERREUR : Des variables d'environnement manquent.");
  console.log("SUPABASE_URL défini ?", !!supabaseUrl);
  console.log("SUPABASE_SERVICE_ROLE_KEY défini ?", !!supabaseKey);
  console.log("RESEND_API_KEY défini ?", !!resendKey);
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const resend = new Resend(resendKey);

async function checkAndSendAlerts() {
  const now = new Date().toISOString();

  const { data: races, error } = await supabase
    .from('races')
    .select('*')
    .lte('opening_date', now)
    .eq('status', 'Closed');

  if (error) {
    console.error("Erreur lors de la récupération des courses :", error.message);
    return;
  }

  if (!races || races.length === 0) {
    console.log("Aucune ouverture de course détectée pour le moment.");
    return;
  }

  for (const race of races) {
    const { data: alerts } = await supabase
      .from('alerts')
      .select('*')
      .eq('race_id', race.id)
      .eq('is_notified', false);

    if (alerts && alerts.length > 0) {
      for (const alert of alerts) {
        await resend.emails.send({
          from: 'PacePulse <onboarding@resend.dev>',
          to: alert.email,
          subject: `🚨 Ouverture des inscriptions : ${race.title} !`,
          html: `<p>Les inscriptions pour <strong>${race.title}</strong> sont ouvertes !</p><p><a href="${race.organizer_url}">S'inscrire maintenant</a></p>`
        });

        await supabase.from('alerts').update({ is_notified: true }).eq('id', alert.id);
      }
    }
    await supabase.from('races').update({ status: 'Open' }).eq('id', race.id);
  }
}

checkAndSendAlerts();
