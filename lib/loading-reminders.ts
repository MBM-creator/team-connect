import type { SupabaseClient } from '@supabase/supabase-js';
import { loadingListUrl, reminderSubject } from '@/lib/loading-list';
import { sendChecklistQueue } from '@/lib/morning-checklist-delivery';

export async function deliverLoadingReminders(
  db: SupabaseClient, workDate: string, origin: string, slot: string, morning: boolean,
) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) throw new Error('Checklist email service is not configured');
  // Lists remain outstanding across dates until their creator confirms them.
  let query = db.from('morning_checklist_emails').select('*').is('loaded_at', null)
    .lte('work_date', workDate).order('created_at').limit(1000);
  if (morning) query = query.lt('work_date', workDate); // today's list has its initial 06:15 email
  const lists = await query;
  if (lists.error || lists.data?.length === 1000) throw new Error('Outstanding checklist lookup failed');
  for (const list of lists.data ?? []) {
    const staff = await db.from('staff_profiles').select('id,email,active,organisations(slug)')
      .eq('id', list.staff_profile_id).maybeSingle();
    if (staff.error) throw new Error('Reminder recipient lookup failed');
    const org = staff.data?.organisations as unknown as { slug: string } | null;
    if (!staff.data?.active || staff.data.email.trim() !== list.recipient || !org?.slug) continue;
    const url = list.confirmation_url ?? loadingListUrl(origin, org.slug, list.id);
    const queued = await db.from('loading_checklist_reminders').upsert({
      checklist_email_id: list.id, staff_profile_id: list.staff_profile_id, slot,
      recipient: list.recipient, sender: list.sender, confirmation_url: url,
      subject: reminderSubject(list.subject, workDate),
      body_text: `This list has not been marked as loaded.\n\n${list.body_text}\n\nConfirm this list is loaded: ${url}`,
    }, { onConflict: 'checklist_email_id,slot', ignoreDuplicates: true });
    if (queued.error) throw new Error(`Reminder queue failed: ${queued.error.code}`);
  }
  const pending = await db.from('loading_checklist_reminders').select('*').eq('slot', slot).neq('status', 'sent');
  if (pending.error) throw new Error('Reminder queue lookup failed');
  return sendChecklistQueue(db, 'loading_checklist_reminders', pending.data ?? [], apiKey);
}
