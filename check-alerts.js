import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

async function checkAndSendAlerts() {
    const now = new Date().toISOString();

    const { data: races } = await supabase
        .from('races')
        .select('*')
        .lte('opening_date', now)
        .eq('status', 'Closed');

    if (!races || races.length === 0) return;

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
