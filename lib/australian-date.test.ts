import { describe, expect, it } from 'vitest';
import {
  formatAustralianCalendarDate,
  formatAustralianDate,
  formatAustralianDateTime,
} from '@/lib/australian-date';

describe('Australian date formatting', () => {
  it('formats calendar dates as DD/MM/YYYY', () => {
    expect(formatAustralianCalendarDate('2026-09-23')).toBe('23/09/2026');
  });

  it('formats timestamps using the Melbourne calendar date', () => {
    expect(formatAustralianDate('2026-09-22T15:30:00.000Z')).toBe('23/09/2026');
    expect(formatAustralianDateTime('2026-09-22T15:30:00.000Z')).toBe('23/09/2026, 1:30 am');
  });

  it('returns the supplied fallback for invalid timestamps', () => {
    expect(formatAustralianDate('invalid', '—')).toBe('—');
    expect(formatAustralianDateTime('invalid', '—')).toBe('—');
  });
});
