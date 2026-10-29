import { describe, expect, it } from 'vitest';
import { resolveDailyReportValues, type DailyReportFormValues } from './daily-report-form-values';
import { parseDailySiteUpdatePostBody, type DailySiteUpdateApiRow } from './daily-site-update-shared';

const empty: DailyReportFormValues = {
  progressToday: '', issuesFaced: '', issuesFacedNone: true,
  problemsResolved: '', problemsResolvedNone: true, preventionPlan: '',
  preventionPlanNone: true, onTrackStatus: 'on_track', onTrackNotes: '',
};
const saved: DailySiteUpdateApiRow = {
  id: 'update', jobId: 'job', stageId: null, stageName: null,
  authorStaffProfileId: 'staff', authorName: 'Steve', reportDate: '2026-10-29',
  reportTimezone: 'Australia/Melbourne', submittedAt: '2026-10-29T08:00:00Z',
  createdAt: '2026-10-29T08:00:00Z', ...empty,
  progressToday: 'Verification completed', issuesFacedNone: false,
  issuesFaced: 'Delivery delayed', onTrackStatus: 'at_risk',
  onTrackNotes: 'Waiting on delivery', plannedHoursSnapshot: null,
  hoursUsedSnapshot: null, hoursRemainingSnapshot: null, hoursSource: null,
  voidedAt: null, voidReason: null, canVoid: true, dailyPlanId: null,
  notesForTomorrow: null, isDayCompletion: false, submissionStatus: 'submitted',
};
const context = { jobId: 'job', reportDate: '2026-10-29', formValues: empty,
  draft: null, latestSubmittedUpdate: saved };

describe('daily report progress after submission and reload', () => {
  it('reuses submitted answers after the update form is cleared', () => {
    const result = resolveDailyReportValues(context);
    expect(result.source).toBe('submitted');
    expect(result.values).toMatchObject({ progressToday: saved.progressToday,
      issuesFacedNone: false, issuesFaced: 'Delivery delayed',
      onTrackStatus: 'at_risk', onTrackNotes: 'Waiting on delivery' });
    expect(parseDailySiteUpdatePostBody(result.values, 'Australia/Melbourne', () => context.reportDate).ok).toBe(true);
    expect(result.values).not.toHaveProperty('id');
  });
  it('restores draft answers after reload, ahead of a mid-day update', () => {
    const result = resolveDailyReportValues({ ...context,
      draft: { ...saved, submissionStatus: 'draft', progressToday: 'Saved report progress' } });
    expect(result.source).toBe('draft');
    expect(result.values.progressToday).toBe('Saved report progress');
  });
  it('uses current edits ahead of saved answers', () => {
    const formValues = { ...empty, progressToday: 'Revised progress' };
    expect(resolveDailyReportValues({ ...context, formValues }).values).toEqual(formValues);
  });
  it.each([
    { jobId: 'another-job' }, { reportDate: '2026-10-28' },
    { voidedAt: '2026-10-29T09:00:00Z' }, { submissionStatus: 'draft' as const },
  ])('rejects an unrelated, voided or unsubmitted fallback: %j', (changes) => {
    expect(resolveDailyReportValues({ ...context,
      latestSubmittedUpdate: { ...saved, ...changes } }).values).toEqual(empty);
  });
  it('retains required-progress validation when no saved update exists', () => {
    const result = resolveDailyReportValues({ ...context, latestSubmittedUpdate: null });
    expect(parseDailySiteUpdatePostBody(result.values, 'Australia/Melbourne', () => context.reportDate))
      .toMatchObject({ ok: false, message: 'What progress was made today is required' });
  });
});
