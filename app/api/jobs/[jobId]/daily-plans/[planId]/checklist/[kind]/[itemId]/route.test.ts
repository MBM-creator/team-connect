import { describe, expect, it } from 'vitest';
import { parseChecklistDecision } from '@/lib/checklist-decision';

describe('saved daily-plan checklist decisions', () => {
  it('accepts four statuses', () => {
    for (const status of ['pending', 'loaded', 'not_required']) {
      expect(parseChecklistDecision({ status })).toEqual({ ok: true, status, reason: null });
    }
    expect(parseChecklistDecision({
      status: 'not_required_for_job', reason: ' Supplied by subcontractor ',
    })).toEqual({
      ok: true, status: 'not_required_for_job', reason: 'Supplied by subcontractor',
    });
  });
  it('rejects missing reasons only for job-specific exclusions', () => {
    expect(parseChecklistDecision({ status: 'not_required_for_job' }).ok).toBe(false);
    expect(parseChecklistDecision({ status: 'not_required_for_job', reason: '  ' }).ok).toBe(false);
    expect(parseChecklistDecision({ status: 'garbage' }).ok).toBe(false);
    expect(parseChecklistDecision({ status: 'not_required_for_job', reason: 'x'.repeat(1001) }).ok).toBe(false);
  });
  it('does not retain job reasons when status changes', () => {
    expect(parseChecklistDecision({ status: 'loaded', reason: 'Was on site' }))
      .toEqual({ ok: true, status: 'loaded', reason: null });
  });
});
