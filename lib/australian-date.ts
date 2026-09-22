import { DEFAULT_REPORT_TIMEZONE } from '@/lib/report-date';

const AUSTRALIAN_DATE_FORMATTER = new Intl.DateTimeFormat('en-AU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: DEFAULT_REPORT_TIMEZONE,
});

const AUSTRALIAN_DATE_TIME_FORMATTER = new Intl.DateTimeFormat('en-AU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: DEFAULT_REPORT_TIMEZONE,
});

/** Format an instant as DD/MM/YYYY in Melbourne time. */
export function formatAustralianDate(value: string | Date, fallback = ''): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? fallback : AUSTRALIAN_DATE_FORMATTER.format(date);
}

/** Format an instant as DD/MM/YYYY plus the local Melbourne time. */
export function formatAustralianDateTime(value: string | Date, fallback = ''): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? fallback : AUSTRALIAN_DATE_TIME_FORMATTER.format(date);
}

/** Format a calendar date without applying a timezone conversion. */
export function formatAustralianCalendarDate(value: string | null | undefined, fallback = ''): string {
  if (!value) return fallback;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return fallback || value;
  return `${match[3]}/${match[2]}/${match[1]}`;
}
