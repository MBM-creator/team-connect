import type { SupabaseClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { buildMorningChecklists, previousWorkingDate, type ChecklistSource } from '@/lib/morning-checklist';

export async function loadMorningChecklists(db: SupabaseClient, workDate: string, origin: string) {
  const [plans, notes, staff] = await Promise.all([
    db.from('job_daily_plans').select('id,job_id,created_by_staff_profile_id,general_notes,job_daily_plan_equipment(description,display_order),job_daily_plan_materials(description,quantity,display_order)')
      .eq('work_date', workDate).neq('status', 'completed').order('id').limit(1000),
    db.from('job_daily_site_updates').select('id,job_id,author_staff_profile_id,notes_for_tomorrow,submitted_at')
      .eq('report_date', previousWorkingDate(workDate)).eq('submission_status', 'submitted')
      .is('voided_at', null).not('notes_for_tomorrow', 'is', null).order('submitted_at', { ascending: false }).limit(1000),
    db.from('staff_profiles').select('id,org_id,email,active').eq('active', true).limit(1000),
  ]);
  for (const result of [plans, notes, staff]) {
    if (result.error) throw new Error(`Checklist data lookup failed: ${result.error.code}`);
    if (result.data?.length === 1000) throw new Error('Checklist data exceeds page limit');
  }
  const jobIds = [...new Set([...(plans.data ?? []), ...(notes.data ?? [])].map(p => p.job_id as string))];
  if (!jobIds.length) return [];
  const jobs = await db.from('jobs').select('id,name,organisation_id,cc_job_number,organisations(slug)')
    .in('id', jobIds).is('hidden_from_qa_at', null);
  if (jobs.error) throw new Error(`Checklist jobs lookup failed: ${jobs.error.code}`);
  const sources: ChecklistSource[] = [];
  function context(jobId: string) {
    const job = jobs.data?.find(j => j.id === jobId);
    if (!job) return null;
    const org = job.organisations as unknown as { slug: string } | null;
    if (!org?.slug) return null;
    return { jobId, orgId: job.organisation_id as string, jobName: job.name as string,
      jobNumber: job.cc_job_number as string | null, orgSlug: org.slug };
  }
  for (const plan of plans.data ?? []) {
    const job = context(plan.job_id);
    if (!job) continue;
    sources.push({ ...job, creatorId: plan.created_by_staff_profile_id, kind: 'plan', notes: plan.general_notes,
      equipment: [...plan.job_daily_plan_equipment].sort((a, b) => a.display_order - b.display_order).map(e => e.description),
      materials: [...plan.job_daily_plan_materials].sort((a, b) => a.display_order - b.display_order)
        .map(m => `${m.description}${m.quantity ? ` (${m.quantity})` : ''}`),
    });
  }
  const seen = new Set<string>();
  for (const note of notes.data ?? []) {
    const job = context(note.job_id);
    const key = `${note.job_id}/${note.author_staff_profile_id}`;
    if (!job || seen.has(key)) continue;
    seen.add(key);
    sources.push({ ...job, creatorId: note.author_staff_profile_id, kind: 'tomorrow',
      notes: note.notes_for_tomorrow, equipment: [], materials: [] });
  }
  return buildMorningChecklists(sources, staff.data ?? [], workDate, origin);
}

/** Stored snapshots + an atomic claim + Resend idempotency protect concurrent calls and retries. */
export async function deliverMorningChecklists(db: SupabaseClient, workDate: string, origin: string) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!apiKey || !from) throw new Error('Checklist email service is not configured');
  const emails = await loadMorningChecklists(db, workDate, origin);
  if (emails.length) {
    const queued = await db.from('morning_checklist_emails').upsert(emails.map(email => ({
      staff_profile_id: email.staffId, work_date: workDate, recipient: email.to,
      sender: from, subject: email.subject, body_text: email.text,
    })), { onConflict: 'staff_profile_id,work_date', ignoreDuplicates: true });
    if (queued.error) throw new Error(`Checklist queue failed: ${queued.error.code}`);
  }
  const pending = await db.from('morning_checklist_emails').select('*')
    .eq('work_date', workDate).neq('status', 'sent');
  if (pending.error) throw new Error(`Checklist queue lookup failed: ${pending.error.code}`);
  let sent = 0;
  let failed = 0;
  const resend = new Resend(apiKey);
  for (const row of pending.data ?? []) {
    // Never retry outside the provider's 24-hour idempotency window.
    if (Date.now() - Date.parse(row.created_at) >= 23 * 60 * 60 * 1000) continue;
    if (row.status === 'sending' && Date.now() - Date.parse(row.updated_at) < 5 * 60 * 1000) continue;
    const staff = await db.from('staff_profiles').select('id,email,active').eq('id', row.staff_profile_id).maybeSingle();
    if (staff.error) throw new Error(`Checklist recipient check failed: ${staff.error.code}`);
    if (!staff.data?.active || staff.data.email.trim() !== row.recipient) continue;
    const claimedAt = new Date().toISOString();
    const claim = await db.from('morning_checklist_emails').update({ status: 'sending', updated_at: claimedAt })
      .eq('id', row.id).eq('status', row.status).eq('updated_at', row.updated_at).select('id').maybeSingle();
    if (claim.error) throw new Error(`Checklist claim failed: ${claim.error.code}`);
    if (!claim.data) continue;
    try {
      const result = await resend.emails.send({ from: row.sender, to: [row.recipient],
        subject: row.subject, text: row.body_text }, { idempotencyKey: `morning-checklist/${row.id}` });
      if (result.error || !result.data?.id) throw new Error('Email provider rejected checklist');
      const saved = await db.from('morning_checklist_emails').update({ status: 'sent',
        provider_email_id: result.data.id, sent_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq('id', row.id).eq('updated_at', claimedAt);
      if (saved.error) throw new Error('Checklist delivery recording failed');
      sent++;
    } catch {
      failed++;
      // Retain the exact snapshot so an ambiguous provider timeout can be retried safely.
      const saved = await db.from('morning_checklist_emails').update({ status: 'failed', updated_at: new Date().toISOString() })
        .eq('id', row.id).eq('updated_at', claimedAt);
      if (saved.error) throw new Error('Checklist failure recording failed');
      console.error('[morning-checklist] Email failed', { queueId: row.id });
    }
  }
  return { queued: emails.length, sent, failed };
}
