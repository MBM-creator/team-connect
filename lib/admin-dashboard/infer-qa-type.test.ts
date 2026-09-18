import { describe, expect, it } from 'vitest';
import { inferQaTypesFromStage } from '@/lib/admin-dashboard/infer-qa-type';

describe('inferQaTypesFromStage', () => {
  it('recognises the renamed Paling Fence checklist as fencing QA', () => {
    expect(
      inferQaTypesFromStage({
        name: 'Boundary works',
        templateName: 'Paling Fence',
      })
    ).toContain('fencing');
  });

  it('does not infer fencing QA from an unassigned custom fence stage', () => {
    expect(
      inferQaTypesFromStage({
        name: 'Brick Fence',
        templateName: null,
      })
    ).not.toContain('fencing');
  });
});
