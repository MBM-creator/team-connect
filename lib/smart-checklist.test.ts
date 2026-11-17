import { describe, expect, it } from 'vitest';
import {
  applyChecklistDecision, checklistIsResolved, shouldSuggestOnJob,
  suggestChecklistItems, unresolvedItems, type SmartChecklistItem,
} from './smart-checklist';

const pending: SmartChecklistItem = {
  id: 'one', jobId: 'job-304', description: 'Wet saw', category: 'tool',
  status: 'pending', reason: null,
};

describe('Smart Checklist pilot', () => {
  it('requires an explanation for job-specific not-required items', () => {
    expect(() => applyChecklistDecision(pending, { status: 'not_required_for_job' })).toThrow(/Explain why/);
    expect(() => applyChecklistDecision(pending, { status: 'not_required_for_job', reason: '  ' })).toThrow(/Explain why/);
    expect(applyChecklistDecision(pending, {
      status: 'not_required_for_job', reason: '  Already on site ',
    })).toMatchObject({ status: 'not_required_for_job', reason: 'Already on site' });
  });

  it('supports all four statuses and clears stale reasons on changes', () => {
    const jobOnly = applyChecklistDecision(pending, {
      status: 'not_required_for_job', reason: 'Supplier provides machine',
    });
    expect(applyChecklistDecision(jobOnly, { status: 'pending' }).reason).toBeNull();
    expect(applyChecklistDecision(jobOnly, { status: 'loaded' }).reason).toBeNull();
    expect(applyChecklistDecision(jobOnly, { status: 'not_required' }).reason).toBeNull();
  });

  it('stops reminders only when no item is pending', () => {
    const a = applyChecklistDecision(pending, { status: 'loaded' });
    const b = applyChecklistDecision({ ...pending, id: 'two' }, { status: 'not_required' });
    const c = applyChecklistDecision({ ...pending, id: 'three' }, {
      status: 'not_required_for_job', reason: 'Different method used',
    });
    expect(checklistIsResolved([a, b, c])).toBe(true);
    expect(checklistIsResolved([a, pending])).toBe(false);
    expect(unresolvedItems([a, pending])).toEqual([pending]);
    expect(checklistIsResolved([])).toBe(true);
  });

  it('does not generalise job-only exclusions to different jobs', () => {
    const decision = applyChecklistDecision(pending, {
      status: 'not_required_for_job', reason: 'Already on site',
    });
    expect(shouldSuggestOnJob(decision, 'job-304')).toBe(false);
    expect(shouldSuggestOnJob(decision, 'job-305')).toBe(true);
  });

  it('suggests relevant missing items without duplicates', () => {
    const suggestions = suggestChecklistItems('Lay bluestone paving', ['Wet saw']);
    expect(suggestions.map((s) => s.description)).toEqual(['5 mm spacers', 'Stone adhesive']);
    expect(suggestChecklistItems('Install irrigation', []).map((s) => s.description))
      .toContain('Irrigation connectors');
    expect(suggestChecklistItems('General site inspection', [])).toEqual([]);
  });
});
