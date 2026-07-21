/** Default reporting timezone for Daily Site Updates and other QA daily filing. */
export const DEFAULT_REPORT_TIMEZONE = 'Australia/Melbourne';

export function resolveReportTimezone(orgTimezone?: string | null): string {
  const trimmed = orgTimezone?.trim();
  return trimmed || DEFAULT_REPORT_TIMEZONE;
}

/** Calendar date (YYYY-MM-DD) in the given IANA timezone. */
export function formatReportDateInTimezone(
  submittedAt: Date | string,
  timeZone: string = DEFAULT_REPORT_TIMEZONE
): string {
  const d = typeof submittedAt === 'string' ? new Date(submittedAt) : submittedAt;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function todayReportDate(timeZone: string = DEFAULT_REPORT_TIMEZONE): string {
  return formatReportDateInTimezone(new Date(), timeZone);
}

export function isValidReportDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Next calendar date (YYYY-MM-DD) after `workDate`.
 * Uses pure calendar arithmetic (no timezone shift) so Melbourne work dates
 * advance by one civil day without UTC boundary drift.
 * Weekends and public holidays remain selectable.
 */
export function nextCalendarDate(workDate: string): string | null {
  if (!isValidReportDate(workDate)) return null;
  const [y, m, d] = workDate.split('-').map(Number);
  const utc = new Date(Date.UTC(y!, m! - 1, d!));
  utc.setUTCDate(utc.getUTCDate() + 1);
  const yy = utc.getUTCFullYear();
  const mm = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(utc.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}
