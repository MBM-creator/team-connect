import type { DailySiteUpdateApiRow } from './daily-site-update-shared';

export type DailyReportFormValues = Pick<DailySiteUpdateApiRow,
  'progressToday' | 'issuesFaced' | 'issuesFacedNone' |
  'problemsResolved' | 'problemsResolvedNone' | 'preventionPlan' |
  'preventionPlanNone' | 'onTrackStatus' | 'onTrackNotes'
>;

// Keep the update's answers together: mixing saved progress with blank form
// defaults would silently lose its issues, resolutions and schedule status.
export function resolveDailyReportValues(input: {
  formValues: DailyReportFormValues;
  draft: DailySiteUpdateApiRow | null;
  latestSubmittedUpdate: DailySiteUpdateApiRow | null;
  jobId: string;
  reportDate: string;
}): { source: 'form' | 'draft' | 'submitted'; values: DailyReportFormValues } {
  if (input.formValues.progressToday.trim()) {
    return { source: 'form', values: input.formValues };
  }
  for (const [source, row] of [
    ['draft', input.draft], ['submitted', input.latestSubmittedUpdate],
  ] as const) {
    if (!row || row.jobId !== input.jobId || row.reportDate !== input.reportDate ||
        row.voidedAt || !row.progressToday.trim() ||
        (source === 'draft' ? row.submissionStatus !== 'draft' : row.submissionStatus !== 'submitted')) continue;
    const { progressToday, issuesFaced, issuesFacedNone, problemsResolved,
      problemsResolvedNone, preventionPlan, preventionPlanNone, onTrackStatus,
      onTrackNotes } = row;
    return { source, values: { progressToday, issuesFaced, issuesFacedNone,
      problemsResolved, problemsResolvedNone, preventionPlan, preventionPlanNone,
      onTrackStatus, onTrackNotes } };
  }
  // The API retains its required-field validation when no saved progress exists.
  return { source: 'form', values: input.formValues };
}
