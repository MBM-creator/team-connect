/**
 * Supabase Storage path helpers (bucket: daily-reports).
 * Daily report folders use Australia/Sydney calendar date for grouping.
 */

import { randomUUID } from 'crypto';

const SITE_SLUG_MAX = 80;

/**
 * Object key suffix for uploaded photos. Browser `File` names are often unusable
 * (e.g. "blob" with no real extension). Use `.jpg` keys and set `Content-Type` on upload.
 */
export function newImageStorageFileName(): string {
  return `${randomUUID()}.jpg`;
}

export function videoFileExtension(mimeType: string, fileName = ''): 'mp4' | 'mov' | 'webm' {
  const lowerName = fileName.toLowerCase();
  const lowerType = mimeType.toLowerCase();
  if (lowerType === 'video/quicktime' || lowerName.endsWith('.mov')) return 'mov';
  if (lowerType === 'video/webm' || lowerName.endsWith('.webm')) return 'webm';
  return 'mp4';
}

export function newVideoStorageFileName(mimeType: string, fileName = ''): string {
  return `${randomUUID()}.${videoFileExtension(mimeType, fileName)}`;
}

/** Calendar date in Australia/Sydney (YYYY-MM-DD) for report filing day. */
export function formatReportDate(submittedAt: Date | string): string {
  const d = typeof submittedAt === 'string' ? new Date(submittedAt) : submittedAt;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** Safe single path segment for storage keys (lowercase, hyphens, max length). */
export function slugifyPathSegment(raw: string, maxLen = SITE_SLUG_MAX): string {
  const s = raw
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
    .slice(0, maxLen)
    .replace(/-+$/g, '');
  return s || 'unknown';
}

/**
 * Final path for a daily report photo after submit (or legacy upload).
 * e.g. madebymobbs/2026-04-16/north-site-024/a1b2c3d4-....jpg
 */
export function dailyReportPhotoStoragePath(
  orgSlug: string,
  siteIdentifier: string,
  submittedAt: Date | string,
  fileName: string
): string {
  const date = formatReportDate(submittedAt);
  const siteSlug = slugifyPathSegment(siteIdentifier);
  return `${orgSlug}/${date}/${siteSlug}/${fileName}`;
}

/**
 * Pre-commencement photo path. jobId disambiguates duplicate or renamed job titles.
 */
export function jobPreCommencementStoragePath(
  jobId: string,
  jobName: string,
  fileName: string
): string {
  const short = jobId.replace(/-/g, '').slice(0, 8);
  const nameSlug = slugifyPathSegment(jobName);
  return `jobs/${nameSlug}__${short}/pre-commencement/${fileName}`;
}

/** Single stable segment for QA paths: slug + short job id (matches pre-commencement style). */
export function jobSlugOrIdSegment(jobId: string, jobName: string): string {
  const short = jobId.replace(/-/g, '').slice(0, 8);
  const nameSlug = slugifyPathSegment(jobName);
  return `${nameSlug}__${short}`;
}

/**
 * Paving QA evidence photos — bucket `daily-reports`, QA-only prefix.
 * jobs/{jobSlugOrId}/qa/{runId}/{sectionCode}/{itemKey}/{uuid}.jpg
 */
export function pavingQaPhotoStoragePath(
  jobId: string,
  jobName: string,
  runId: string,
  sectionCode: string,
  itemKey: string,
  fileName: string
): string {
  const seg = jobSlugOrIdSegment(jobId, jobName);
  const sec = slugifyPathSegment(sectionCode, 64);
  const item = slugifyPathSegment(itemKey, 64);
  return `jobs/${seg}/qa/${runId}/${sec}/${item}/${fileName}`;
}

/**
 * QA evidence photos with an explicit QA type segment.
 * jobs/{jobSlugOrId}/qa/{qaType}/{runId}/{sectionCode}/{itemKey}/{uuid}.jpg
 */
export function qaEvidencePhotoStoragePath(
  qaType: 'paving' | 'irrigation' | 'fencing' | 'sign_off',
  jobId: string,
  jobName: string,
  runId: string,
  sectionCode: string,
  itemKey: string,
  fileName: string
): string {
  const seg = jobSlugOrIdSegment(jobId, jobName);
  const type = slugifyPathSegment(qaType, 32);
  const sec = slugifyPathSegment(sectionCode, 64);
  const item = slugifyPathSegment(itemKey, 64);
  return `jobs/${seg}/qa/${type}/${runId}/${sec}/${item}/${fileName}`;
}

export function qaSignOffVideoStoragePath(
  jobId: string,
  jobName: string,
  runId: string,
  sectionCode: string,
  itemKey: string,
  mimeType: string,
  fileName = 'video'
): string {
  return qaEvidencePhotoStoragePath(
    'sign_off',
    jobId,
    jobName,
    runId,
    sectionCode,
    itemKey,
    newVideoStorageFileName(mimeType, fileName)
  );
}
export function jobNoteVideoStoragePath(
  jobId: string,
  jobName: string,
  noteId: string,
  fileName: string
): string {
  const seg = jobSlugOrIdSegment(jobId, jobName);
  return `jobs/${seg}/notes/${noteId}/videos/${fileName}`;
}

export function jobNoteImageStoragePath(
  jobId: string,
  jobName: string,
  noteId: string,
  fileName: string
): string {
  const seg = jobSlugOrIdSegment(jobId, jobName);
  return `jobs/${seg}/notes/${noteId}/images/${fileName}`;
}

export function planFileExtension(mimeType: string, fileName = ''): string {
  const lowerName = fileName.toLowerCase();
  const lowerType = mimeType.toLowerCase();
  if (lowerType === 'application/pdf' || lowerName.endsWith('.pdf')) return 'pdf';
  if (lowerType === 'image/png' || lowerName.endsWith('.png')) return 'png';
  if (lowerType === 'image/webp' || lowerName.endsWith('.webp')) return 'webp';
  return 'jpg';
}

export function newPlanStorageFileName(mimeType: string, fileName = ''): string {
  return `${randomUUID()}.${planFileExtension(mimeType, fileName)}`;
}

/** Job plan / drawing documents — bucket `daily-reports`. */
export function jobPlanStoragePath(
  jobId: string,
  jobName: string,
  fileName: string
): string {
  const seg = jobSlugOrIdSegment(jobId, jobName);
  return `jobs/${seg}/plans/${fileName}`;
}

/** Job-level media library images (not pre-commencement, not note attachments). */
export function jobMediaImageStoragePath(
  jobId: string,
  jobName: string,
  fileName: string
): string {
  const seg = jobSlugOrIdSegment(jobId, jobName);
  return `jobs/${seg}/media/images/${fileName}`;
}

/** Job-level media library videos. */
export function jobMediaVideoStoragePath(
  jobId: string,
  jobName: string,
  fileName: string
): string {
  const seg = jobSlugOrIdSegment(jobId, jobName);
  return `jobs/${seg}/media/videos/${fileName}`;
}
