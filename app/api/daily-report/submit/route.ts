import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { dailyReportPhotoStoragePath } from '@/lib/storage-paths';
import { randomUUID } from 'crypto';

export const runtime = 'nodejs';

const BUCKET = 'daily-reports';
const NOTIFY_EMAIL = 'steve@madebymobbs.com.au';

function jsonError(message: string, status = 400, requestId?: string) {
  const res = NextResponse.json({ ok: false, message }, { status });
  if (requestId) res.headers.set('x-request-id', requestId);
  return res;
}

function serverError(
  requestId: string,
  errorCode?: string,
  message = 'Internal server error'
) {
  const body: { ok: false; requestId: string; errorCode?: string; message: string } = {
    ok: false,
    requestId,
    message,
  };
  if (errorCode) body.errorCode = errorCode;
  const res = NextResponse.json(body, { status: 500 });
  res.headers.set('x-request-id', requestId);
  return res;
}

function normalizeSupabaseError(err: unknown): {
  code: string | null;
  message: string;
  details: string | null;
  hint: string | null;
} {
  if (err === null || err === undefined) {
    return { code: null, message: '', details: null, hint: null };
  }
  const o = err as Record<string, unknown>;
  return {
    code: typeof o.code === 'string' ? o.code : null,
    message: typeof o.message === 'string' ? o.message : String(err),
    details: typeof o.details === 'string' ? o.details : null,
    hint: typeof o.hint === 'string' ? o.hint : null,
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function POST(request: NextRequest) {
  const userAgent = request.headers.get('user-agent') ?? '';
  const contentType = request.headers.get('content-type') ?? '';
  const requestId = request.headers.get('x-vercel-id') ?? randomUUID().slice(0, 8);
  console.log('[daily-report/submit] Request:', {
    requestId,
    headers: { 'user-agent': userAgent.slice(0, 120), 'content-type': contentType.slice(0, 80) },
  });

  let body: {
    draftId?: string;
    orgSlug?: string;
    crewName?: string;
    siteNumber?: string;
    summary?: string;
    finishedPlan?: string;
    notFinishedWhy?: string;
    catchupPlan?: string;
    siteLeftClean?: string;
  };
  try {
    const raw = await request.json();
    body = typeof raw === 'object' && raw !== null ? raw : {};
  } catch {
    console.error('[daily-report/submit] Body parse failed:', { requestId });
    return serverError(requestId, 'BODY_PARSE', 'Invalid JSON body');
  }

  const draftId = String(body.draftId ?? '').trim();
  const orgSlug = String(body.orgSlug ?? '').trim();
  const crewName = String(body.crewName ?? '').trim();
  const siteNumber = String(body.siteNumber ?? '').trim();
  const summary = String(body.summary ?? '').trim();
  const finishedPlanRaw = String(body.finishedPlan ?? '').trim();
  const notFinishedWhy = String(body.notFinishedWhy ?? '').trim();
  const catchupPlan = String(body.catchupPlan ?? '').trim();
  const siteLeftCleanRaw = String(body.siteLeftClean ?? '').trim();

  if (!draftId) return jsonError('draftId is required', 400, requestId);
  if (!orgSlug) return jsonError('Organisation is required', 400, requestId);
  if (!crewName) return jsonError('Crew name is required', 400, requestId);
  if (!siteNumber) return jsonError('Site Number / Name is required', 400, requestId);
  if (!summary) return jsonError("Today's summary is required", 400, requestId);
  if (finishedPlanRaw !== 'true' && finishedPlanRaw !== 'false') {
    return jsonError('Please indicate if you finished everything planned today', 400, requestId);
  }
  const finishedPlanBool = finishedPlanRaw === 'true';
  if (!finishedPlanBool) {
    if (!notFinishedWhy) return jsonError('Please explain what was not finished and why', 400, requestId);
    if (!catchupPlan) return jsonError('Please provide a plan to make up the lost time', 400, requestId);
  }
  if (siteLeftCleanRaw !== 'true' && siteLeftCleanRaw !== 'false') {
    return jsonError('Please indicate if the site was left clean / tools in site box / materials under cover', 400, requestId);
  }
  const siteLeftCleanBool = siteLeftCleanRaw === 'true';

  const { data: draft, error: draftError } = await supabaseAdmin
    .from('daily_report_drafts')
    .select('id, organisation_id')
    .eq('id', draftId)
    .single();

  if (draftError || !draft) {
    console.error('[daily-report/submit] Draft not found:', { requestId, draftId });
    const res = NextResponse.json({ ok: false, requestId, message: 'Draft not found' }, { status: 404 });
    res.headers.set('x-request-id', requestId);
    return res;
  }

  const { data: org, error: orgError } = await supabaseAdmin
    .from('organisations')
    .select('id, slug')
    .eq('slug', orgSlug)
    .single();

  if (orgError || !org) {
    const supabaseErr = normalizeSupabaseError(orgError ?? null);
    console.error('[daily-report/submit] Org lookup failed:', { requestId, orgSlug, supabaseError: supabaseErr });
    const res = NextResponse.json(
      {
        ok: false,
        requestId,
        message: process.env.NODE_ENV === 'development' && orgError
          ? `Invalid organisation: ${orgError.message}`
          : 'Invalid organisation',
      },
      { status: 404 }
    );
    res.headers.set('x-request-id', requestId);
    return res;
  }

  if (org.id !== draft.organisation_id) {
    return jsonError('Organisation does not match draft', 400, requestId);
  }

  const { data: draftFiles, error: listError } = await supabaseAdmin.storage
    .from(BUCKET)
    .list('drafts/' + draftId, { limit: 20 });

  if (listError) {
    const supabaseErr = normalizeSupabaseError(listError);
    console.error('[daily-report/submit] List draft files failed:', { requestId, draftId, supabaseError: supabaseErr });
    return serverError(requestId, supabaseErr.code ?? 'DRAFT_LIST', 'Failed to list draft photos');
  }

  const fileList = Array.isArray(draftFiles) ? draftFiles : [];
  const fileNames = fileList.map((item) => (item as { name?: string }).name).filter(Boolean) as string[];
  if (fileNames.length < 3) {
    return jsonError('At least 3 photos are required', 400, requestId);
  }
  if (fileNames.length > 10) {
    return jsonError('Maximum 10 photos allowed', 400, requestId);
  }

  const { data: report, error: reportError } = await supabaseAdmin
    .from('daily_reports')
    .insert({
      organisation_id: draft.organisation_id,
      site_id: null,
      site_identifier: siteNumber,
      crew_name: crewName,
      summary,
      finished_plan: finishedPlanBool,
      not_finished_why: finishedPlanBool ? null : notFinishedWhy,
      catchup_plan: finishedPlanBool ? null : catchupPlan,
      site_left_clean_notes: siteLeftCleanBool ? 'Yes' : 'No',
    })
    .select('id, submitted_at')
    .single();

  if (reportError || !report) {
    const supabaseErr = normalizeSupabaseError(reportError ?? null);
    console.error('[daily-report/submit] Report insert failed:', { requestId, supabaseError: supabaseErr });
    return serverError(
      requestId,
      supabaseErr.code ?? 'REPORT_INSERT',
      'Failed to create report'
    );
  }

  const reportId = report.id;
  const copiedPaths: string[] = [];

  try {
    for (const fileName of fileNames) {
      const sourcePath = `drafts/${draftId}/${fileName}`;
      const destPath = dailyReportPhotoStoragePath(
        orgSlug,
        siteNumber,
        report.submitted_at,
        fileName
      );

      const { error: copyError } = await supabaseAdmin.storage
        .from(BUCKET)
        .copy(sourcePath, destPath);

      if (copyError) {
        const supabaseErr = normalizeSupabaseError(copyError);
        console.error('[daily-report/submit] Copy failed:', { requestId, sourcePath, destPath, supabaseError: supabaseErr });
        await supabaseAdmin.storage.from(BUCKET).remove(copiedPaths);
        await supabaseAdmin.from('daily_reports').delete().eq('id', reportId);
        return serverError(
          requestId,
          supabaseErr.code ?? 'PHOTO_COPY',
          'Failed to attach photos to report'
        );
      }
      copiedPaths.push(destPath);

      const { error: photoError } = await supabaseAdmin
        .from('daily_report_photos')
        .insert({ report_id: reportId, storage_path: destPath });

      if (photoError) {
        const supabaseErr = normalizeSupabaseError(photoError);
        console.error('[daily-report/submit] Photo record insert failed:', { requestId, supabaseError: supabaseErr });
        await supabaseAdmin.storage.from(BUCKET).remove(copiedPaths);
        await supabaseAdmin.from('daily_reports').delete().eq('id', reportId);
        return serverError(
          requestId,
          supabaseErr.code ?? 'PHOTO_RECORDS',
          'Failed to save photo records'
        );
      }

      const { error: removeError } = await supabaseAdmin.storage.from(BUCKET).remove([sourcePath]);
      if (removeError) {
        console.warn('[daily-report/submit] Failed to remove draft file:', { requestId, sourcePath, removeError });
      }
    }
  } catch (err) {
    const errPayload = err instanceof Error ? { message: err.message, stack: err.stack } : { error: String(err) };
    console.error('[daily-report/submit] Unexpected error during copy:', { requestId, ...errPayload });
    await supabaseAdmin.storage.from(BUCKET).remove(copiedPaths);
    await supabaseAdmin.from('daily_reports').delete().eq('id', reportId);
    return serverError(requestId, 'UNEXPECTED', 'Internal server error');
  }

  const { error: deleteDraftError } = await supabaseAdmin
    .from('daily_report_drafts')
    .delete()
    .eq('id', draftId);

  if (deleteDraftError) {
    console.warn('[daily-report/submit] Failed to delete draft row:', { requestId, draftId, deleteDraftError });
  }

  const signedUrlExpiry = 60 * 60 * 24 * 7;
  const photoLinks: string[] = [];
  for (const path of copiedPaths) {
    const { data: signed } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(path, signedUrlExpiry);
    if (signed?.signedUrl) photoLinks.push(signed.signedUrl);
  }

  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'Site Connect <onboarding@resend.dev>';
  let emailSent = false;
  let emailError: string | null = null;

  if (!apiKey) {
    console.warn('[daily-report/submit] RESEND_API_KEY not set; skipping notification email.');
  } else {
    const resend = new Resend(apiKey);
    const photoListHtml =
      photoLinks.length > 0
        ? '<p><strong>Photos (' +
          photoLinks.length +
          '):</strong></p><ul>' +
          photoLinks.map((url, i) => '<li><a href="' + escapeHtml(url) + '">Photo ' + (i + 1) + '</a></li>').join('') +
          '</ul><p><em>Links expire in 7 days.</em></p>'
        : '<p><em>Report ID: ' + reportId + ' – ' + copiedPaths.length + ' photo(s) in storage.</em></p>';
    const html = [
      '<h2>New daily report submitted</h2>',
      '<p><strong>Organisation:</strong> ' + escapeHtml(orgSlug) + '</p>',
      '<p><strong>Crew:</strong> ' + escapeHtml(crewName) + '</p>',
      '<p><strong>Site:</strong> ' + escapeHtml(siteNumber) + '</p>',
      '<p><strong>Summary:</strong></p><p>' + escapeHtml(summary) + '</p>',
      '<p><strong>Finished everything planned?</strong> ' + (finishedPlanBool ? 'Yes' : 'No') + '</p>',
      ...(finishedPlanBool
        ? []
        : [
            '<p><strong>What was not finished and why:</strong></p><p>' + escapeHtml(notFinishedWhy) + '</p>',
            '<p><strong>Plan to make up time:</strong></p><p>' + escapeHtml(catchupPlan) + '</p>',
          ]),
      '<p><strong>Site left clean / tools in box / materials under cover?</strong> ' + (siteLeftCleanBool ? 'Yes' : 'No') + '</p>',
      photoListHtml,
      '<p><em>Report ID: ' + reportId + '</em></p>',
    ].join('');
    try {
      console.log('[daily-report/submit] Sending Resend email:', { requestId, to: NOTIFY_EMAIL });
      const result = await resend.emails.send({
        from: fromEmail,
        to: [NOTIFY_EMAIL],
        subject: `Daily Report: ${siteNumber} – ${crewName}`,
        html,
      });
      if (result.error) {
        emailError =
          typeof result.error === 'object' && result.error !== null && 'message' in result.error
            ? String((result.error as { message: unknown }).message)
            : JSON.stringify(result.error);
        console.error('[daily-report/submit] Resend email error:', { requestId, error: result.error });
      } else {
        emailSent = true;
        console.log('[daily-report/submit] Resend email sent:', { requestId });
      }
    } catch (err) {
      emailError = err instanceof Error ? err.message : String(err);
      console.error('[daily-report/submit] Failed to send notification email:', { requestId, err });
    }
  }

  console.log('[daily-report/submit] Success:', { requestId, reportId, photoCount: copiedPaths.length });
  const res = NextResponse.json({
    ok: true,
    reportId,
    emailSent,
    ...(emailError && { emailError }),
  });
  res.headers.set('x-request-id', requestId);
  return res;
}
