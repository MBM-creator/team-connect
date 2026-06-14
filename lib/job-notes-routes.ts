import { isValidReportDate, todayReportDate } from '@/lib/report-date';

export type JobNotesMode = 'capture' | 'archive';

export function validateReturnTo(orgSlug: string, returnTo: string | null | undefined): string | null {
  if (!returnTo?.trim()) return null;
  const path = returnTo.trim();
  if (!path.startsWith(`/t/${orgSlug}/`)) return null;
  if (path.includes('://')) return null;
  if (path.startsWith('//')) return null;
  return path;
}

export function buildJobNotesHref(
  orgSlug: string,
  jobId: string,
  options: {
    mode: JobNotesMode;
    returnTo: string;
    reportDate?: string;
    stageId?: string | null;
  }
): string {
  const params = new URLSearchParams();
  params.set('mode', options.mode);
  params.set('returnTo', options.returnTo);
  if (options.mode === 'capture') {
    params.set('date', options.reportDate ?? todayReportDate());
    if (options.stageId) params.set('stageId', options.stageId);
  }
  return `/t/${orgSlug}/jobs/${jobId}/notes?${params.toString()}`;
}

export function parseJobNotesMode(value: string | null | undefined): JobNotesMode {
  return value === 'capture' ? 'capture' : 'archive';
}

export function parseJobNotesReportDate(value: string | null | undefined): string {
  if (value && isValidReportDate(value)) return value;
  return todayReportDate();
}
