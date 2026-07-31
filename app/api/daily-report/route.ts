import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { dailyReportPhotoStoragePath, newImageStorageFileName } from '@/lib/storage-paths';
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

// Legacy single-POST endpoint (form + all photos). Prefer draft + per-image upload + submit flow.
// If client sends a very large body, Vercel may return 413 before we run; 413 here usually means
// "old client sent all photos in one request — user should refresh to get draft-first flow".
const PAYLOAD_TOO_LARGE_THRESHOLD = 4_000_000; // bytes; Vercel body limit ~4.5 MB

export async function POST(request: NextRequest) {
  const userAgent = request.headers.get('user-agent') ?? '';
  const contentType = request.headers.get('content-type') ?? '';
  const requestId = request.headers.get('x-vercel-id') ?? randomUUID().slice(0, 8);
  const bodyKind = contentType.includes('application/json') ? 'json' : 'multipart';
  console.log('[daily-report] Request:', {
    requestId,
    headers: { 'user-agent': userAgent.slice(0, 120), 'content-type': contentType.slice(0, 80) },
    bodyKind,
  });

  // If Content-Length is over threshold, return a clear "refresh" message instead of risking 413 or parse failure.
  const contentLength = request.headers.get('content-length');
  if (contentLength) {
    const size = parseInt(contentLength, 10);
    if (!Number.isNaN(size) && size > PAYLOAD_TOO_LARGE_THRESHOLD) {
      console.warn('[daily-report] Request body too large:', { requestId, contentLength: size });
      const res = NextResponse.json(
        {
          ok: false,
          requestId,
          message: 'Request too large. Please refresh the page to get the latest version and try again.',
          errorCode: 'REFRESH_REQUIRED',
        },
        { status: 400 }
      );
      res.headers.set('x-request-id', requestId);
      return res;
    }
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (parseError) {
    console.error('[daily-report] Body parse failed:', { requestId, error: parseError });
    return serverError(requestId, 'BODY_PARSE', 'Failed to parse request body');
  }

  // Body keys and file metadata (no body values or file contents)
  const bodyKeys = [...formData.keys()];
  const photos = (formData.getAll('photos') as File[]).filter(
    (f) => f instanceof File && f.size > 0
  );
  const fileMetadata = photos.map((f) => ({ type: f.type, size: f.size, name: f.name }));
  console.log('[daily-report] Request body:', {
    requestId,
    bodyKeys,
    fileCount: photos.length,
    files: fileMetadata,
  });

  // Deprecate legacy flow: multipart with photos should use draft + submit. Return clear "refresh" so old cached clients get a helpful message.
  if (bodyKind === 'multipart' && photos.length > 0) {
    console.warn('[daily-report] Legacy multipart with photos rejected:', { requestId, fileCount: photos.length });
    const res = NextResponse.json(
      {
        ok: false,
        requestId,
        message: 'Please refresh the page to use the latest report form.',
        errorCode: 'USE_DRAFT_FLOW',
      },
      { status: 400 }
    );
    res.headers.set('x-request-id', requestId);
    return res;
  }

  try {
    // Fields
    const orgSlug = String(formData.get('orgSlug') ?? '').trim();
    const crewName = String(formData.get('crewName') ?? '').trim();
    const siteNumber = String(formData.get('siteNumber') ?? '').trim();
    const summary = String(formData.get('summary') ?? '').trim();
    const finishedPlanRaw = String(formData.get('finishedPlan') ?? '').trim();
    const notFinishedWhy = String(formData.get('notFinishedWhy') ?? '').trim();
    const catchupPlan = String(formData.get('catchupPlan') ?? '').trim();
    const siteLeftCleanRaw = String(formData.get('siteLeftClean') ?? '').trim();

    // Validation
    if (!orgSlug) {
      console.warn('[daily-report] Validation failed:', { requestId, reason: 'Organisation is required' });
      return jsonError('Organisation is required', 400, requestId);
    }
    if (!crewName) {
      console.warn('[daily-report] Validation failed:', { requestId, reason: 'Crew name is required' });
      return jsonError('Crew name is required', 400, requestId);
    }
    if (!siteNumber) {
      console.warn('[daily-report] Validation failed:', { requestId, reason: 'Site Number / Name is required' });
      return jsonError('Site Number / Name is required', 400, requestId);
    }
    if (!summary) {
      console.warn('[daily-report] Validation failed:', { requestId, reason: "Today's summary is required" });
      return jsonError("Today's summary is required", 400, requestId);
    }

    if (finishedPlanRaw !== 'true' && finishedPlanRaw !== 'false') {
      console.warn('[daily-report] Validation failed:', { requestId, reason: 'finishedPlan invalid' });
      return jsonError('Please indicate if you finished everything planned today', 400, requestId);
    }
    const finishedPlanBool = finishedPlanRaw === 'true';

    if (!finishedPlanBool) {
      if (!notFinishedWhy) {
        console.warn('[daily-report] Validation failed:', { requestId, reason: 'notFinishedWhy required' });
        return jsonError('Please explain what was not finished and why', 400, requestId);
      }
      if (!catchupPlan) {
        console.warn('[daily-report] Validation failed:', { requestId, reason: 'catchupPlan required' });
        return jsonError('Please provide a plan to make up the lost time', 400, requestId);
      }
    }

    if (siteLeftCleanRaw !== 'true' && siteLeftCleanRaw !== 'false') {
      console.warn('[daily-report] Validation failed:', { requestId, reason: 'siteLeftClean invalid' });
      return jsonError('Please indicate if the site was left clean / tools in site box / materials under cover', 400, requestId);
    }
    const siteLeftCleanBool = siteLeftCleanRaw === 'true';

    if (photos.length < 3 || photos.length > 10) {
      console.warn('[daily-report] Validation failed:', { requestId, photoCount: photos.length });
      return jsonError('Must upload between 3 and 10 photos', 400, requestId);
    }

    // Validate organisation exists
    const { data: org, error: orgError } = await supabaseAdmin
      .from('organisations')
      .select('id')
      .eq('slug', orgSlug)
      .single();

    if (orgError || !org) {
      const supabaseErr = normalizeSupabaseError(orgError ?? null);
      console.error('[daily-report] Org lookup failed:', {
        requestId,
        orgSlug,
        supabaseError: supabaseErr,
      });
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

    // Site Number/Name is free text (no lookup); later can link to Client Connect / sites
    // Create daily report
    const { data: report, error: reportError } = await supabaseAdmin
      .from('daily_reports')
      .insert({
        organisation_id: org.id,
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
      console.error('[daily-report] Error creating report:', {
        requestId,
        supabaseError: supabaseErr,
      });
      return serverError(
        requestId,
        supabaseErr.code ?? 'REPORT_INSERT',
        'Failed to create report'
      );
    }

    // Upload photos (require ALL selected photos succeed)
    const uploadedPaths: string[] = [];

    for (const photo of photos) {
      const fileName = newImageStorageFileName();
      const storagePath = dailyReportPhotoStoragePath(
        orgSlug,
        siteNumber,
        report.submitted_at,
        fileName
      );

      const arrayBuffer = await photo.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const { error: uploadError } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(storagePath, buffer, {
          contentType: photo.type || 'image/jpeg',
          upsert: false,
        });

      if (uploadError) {
        const supabaseErr = normalizeSupabaseError(uploadError);
        console.error('[daily-report] Error uploading photo:', {
          requestId,
          supabaseError: supabaseErr,
        });

        // Cleanup anything uploaded so far + rollback report
        for (const path of uploadedPaths) {
          await supabaseAdmin.storage.from(BUCKET).remove([path]);
        }
        await supabaseAdmin.from('daily_reports').delete().eq('id', report.id);

        return serverError(
          requestId,
          supabaseErr.code ?? 'PHOTO_UPLOAD',
          'Failed to upload all photos. Please try again.'
        );
      }

      uploadedPaths.push(storagePath);
    }

    // Create photo records
    const photoRecords = uploadedPaths.map((path) => ({
      report_id: report.id,
      storage_path: path,
    }));

    const { error: photosError } = await supabaseAdmin
      .from('daily_report_photos')
      .insert(photoRecords);

    if (photosError) {
      const supabaseErr = normalizeSupabaseError(photosError);
      console.error('[daily-report] Error creating photo records:', {
        requestId,
        supabaseError: supabaseErr,
      });

      // Cleanup storage + rollback report to avoid orphaned files
      await supabaseAdmin.storage.from(BUCKET).remove(uploadedPaths);
      await supabaseAdmin.from('daily_reports').delete().eq('id', report.id);

      return serverError(
        requestId,
        supabaseErr.code ?? 'PHOTO_RECORDS',
        'Failed to save photo records. Please try again.'
      );
    }

    const isSafari = /Safari/i.test(userAgent) && !/Chrome/i.test(userAgent);
    console.log('[daily-report] Success:', { requestId, reportId: report.id, isSafari, photoCount: photos.length });

    // Build photo links (signed URLs, valid 7 days, so they work for private buckets)
    const signedUrlExpiry = 60 * 60 * 24 * 7; // 7 days
    const photoLinks: string[] = [];
    for (const path of uploadedPaths) {
      const { data: signed } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(path, signedUrlExpiry);
      if (signed?.signedUrl) photoLinks.push(signed.signedUrl);
    }

    // Send notification email via Resend (non-blocking; report already saved)
    const apiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'Team Connect <onboarding@resend.dev>';
    let emailSent = false;
    let emailError: string | null = null;

    if (!apiKey) {
      console.warn('[daily-report] RESEND_API_KEY not set; skipping notification email. Set it in Vercel (Production) → Settings → Environment Variables.');
    } else {
      const resend = new Resend(apiKey);
      const photoListHtml =
        photoLinks.length > 0
          ? '<p><strong>Photos (' +
            photoLinks.length +
            '):</strong></p><ul>' +
            photoLinks.map((url, i) => '<li><a href="' + escapeHtml(url) + '">Photo ' + (i + 1) + '</a></li>').join('') +
            '</ul><p><em>Links expire in 7 days.</em></p>'
          : '<p><em>Report ID: ' + report.id + ' – ' + photos.length + ' photo(s) in storage (links could not be generated).</em></p>';
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
        '<p><em>Report ID: ' + report.id + '</em></p>',
      ].join('');
      try {
        console.log('[daily-report] Sending Resend email:', { requestId, to: NOTIFY_EMAIL, from: fromEmail });
        const result = await resend.emails.send({
          from: fromEmail,
          to: [NOTIFY_EMAIL],
          subject: `Daily Report: ${siteNumber} – ${crewName}`,
          html,
        });
        if (result.error) {
          emailError = typeof result.error === 'object' && result.error !== null && 'message' in result.error ? String((result.error as { message: unknown }).message) : JSON.stringify(result.error);
          console.error('[daily-report] Resend email error:', { requestId, error: result.error });
        } else {
          emailSent = true;
          console.log('[daily-report] Resend email sent successfully:', { requestId, id: (result as { data?: { id?: string } }).data?.id });
        }
      } catch (err) {
        emailError = err instanceof Error ? err.message : String(err);
        console.error('[daily-report] Failed to send notification email:', { requestId, err });
      }
    }

    const successRes = NextResponse.json({
      ok: true,
      reportId: report.id,
      emailSent,
      ...(emailError && { emailError }),
    });
    successRes.headers.set('x-request-id', requestId);
    return successRes;
  } catch (error) {
    const errPayload =
      error instanceof Error
        ? { message: error.message, name: error.name, stack: error.stack }
        : { error: String(error) };
    console.error('[daily-report] Unexpected error:', { requestId, ...errPayload });
    return serverError(requestId, 'UNEXPECTED', 'Internal server error');
  }
}
