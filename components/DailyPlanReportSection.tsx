'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { DailyPlanApi } from '@/lib/daily-plan-shared';
import {
  DAILY_PLAN_UNRESOLVED_OUTCOMES_MESSAGE,
  DAILY_REPORT_COMPLETE_CONFIRM_BODY,
  DAILY_REPORT_COMPLETE_CONFIRM_TITLE,
} from '@/lib/daily-plan-shared';
import {
  changeReasonLabel,
  changeTypeLabel,
  notCompletedReasonLabel,
  outcomeExecutionStatusLabel,
} from '@/lib/daily-plan-execution';
import type {
  CarryForwardEligibleOutcome,
  DailyPlanReportMatch,
  DailyPlanReportSummary,
} from '@/lib/daily-plan-report';
import type { DailySiteUpdateApiRow } from '@/lib/daily-site-update-shared';
import { nextMelbourneWorkDate } from '@/lib/daily-plan-carry-forward-suggestions';

type CarryForwardFormRow = Record<
  string,
  { carryForward: boolean; note: string }
>;

type DailyPlanReportSectionProps = {
  orgSlug: string;
  jobId: string;
  reportDate: string;
  /** Mid-day DSU form values reused for day completion. */
  formValues: {
    progressToday: string;
    issuesFaced: string;
    issuesFacedNone: boolean;
    problemsResolved: string;
    problemsResolvedNone: boolean;
    preventionPlan: string;
    preventionPlanNone: boolean;
    onTrackStatus: string;
    onTrackNotes: string;
  };
  canCompleteDay: boolean;
  onPlanCompleted: (plan: DailyPlanApi | null) => void;
};

function statusBadge(status: string): string {
  switch (status) {
    case 'completed':
      return 'bg-[#698F00]/10 text-[#4f6f00] border-[#698F00]/25';
    case 'not_completed':
      return 'bg-amber-50 text-amber-950 border-amber-200';
    case 'cancelled':
      return 'bg-gray-100 text-gray-700 border-gray-300';
    case 'in_progress':
      return 'bg-sky-50 text-sky-900 border-sky-200';
    default:
      return 'bg-white text-gray-800 border-gray-200';
  }
}

export function DailyPlanReportSection({
  orgSlug,
  jobId,
  reportDate,
  formValues,
  canCompleteDay,
  onPlanCompleted,
}: DailyPlanReportSectionProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [planMatch, setPlanMatch] = useState<DailyPlanReportMatch | null>(null);
  const [summary, setSummary] = useState<DailyPlanReportSummary | null>(null);
  const [draft, setDraft] = useState<DailySiteUpdateApiRow | null>(null);
  const [notesForTomorrow, setNotesForTomorrow] = useState('');
  const [carryForwards, setCarryForwards] = useState<CarryForwardFormRow>({});
  const [confirming, setConfirming] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [apiCanCompleteDay, setApiCanCompleteDay] = useState(canCompleteDay);

  const planHref = `/t/${orgSlug}/jobs/${jobId}/daily-plan?workDate=${encodeURIComponent(reportDate)}`;
  const nextWorkDate = nextMelbourneWorkDate(reportDate);
  const nextPlanHref = nextWorkDate
    ? `/t/${orgSlug}/jobs/${jobId}/daily-plan?workDate=${encodeURIComponent(nextWorkDate)}`
    : null;

  const effectiveCanCompleteDay = apiCanCompleteDay;

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/jobs/${jobId}/daily-site-updates/day-completion?orgSlug=${encodeURIComponent(orgSlug)}&reportDate=${encodeURIComponent(reportDate)}`
      );
      const data = (await res.json()) as {
        ok?: boolean;
        message?: string;
        planMatch?: DailyPlanReportMatch;
        summary?: DailyPlanReportSummary | null;
        draft?: DailySiteUpdateApiRow | null;
        canCompleteDay?: boolean;
      };
      if (!res.ok || !data.ok || !data.planMatch) {
        throw new Error(typeof data.message === 'string' ? data.message : 'Failed to load plan summary');
      }
      setPlanMatch(data.planMatch);
      setSummary(data.summary ?? null);
      setDraft(data.draft ?? null);
      if (typeof data.canCompleteDay === 'boolean') {
        setApiCanCompleteDay(data.canCompleteDay);
      }
      if (data.draft?.notesForTomorrow) {
        setNotesForTomorrow(data.draft.notesForTomorrow);
      }
      const eligible =
        data.summary?.carryForwardEligible ??
        (data.planMatch.kind === 'active' || data.planMatch.kind === 'completed'
          ? data.planMatch.summary.carryForwardEligible
          : []);
      const next: CarryForwardFormRow = {};
      for (const item of eligible) {
        next[`${item.source}:${item.id}`] = { carryForward: true, note: '' };
      }
      if (data.planMatch.kind === 'completed') {
        for (const cf of data.planMatch.plan.carryForwards) {
          const key = cf.outcomeId
            ? `original:${cf.outcomeId}`
            : `replacement:${cf.replacementOutcomeId}`;
          next[key] = {
            carryForward: cf.carryForward,
            note: cf.note ?? '',
          };
        }
      }
      setCarryForwards(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load plan summary');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgSlug, jobId, reportDate]);

  const unresolved = summary?.unresolvedOutcomes ?? [];
  const eligible = useMemo(
    () => summary?.carryForwardEligible ?? [],
    [summary?.carryForwardEligible]
  );

  function buildCarryForwardPayload() {
    return eligible.map((item) => {
      const key = `${item.source}:${item.id}`;
      const row = carryForwards[key] ?? { carryForward: true, note: '' };
      return {
        outcomeId: item.source === 'original' ? item.id : null,
        replacementOutcomeId: item.source === 'replacement' ? item.id : null,
        carryForward: row.carryForward,
        note: row.note || null,
      };
    });
  }

  async function handleSaveDraft() {
    if (savingDraft || completing) return;
    setSavingDraft(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(
        `/api/jobs/${jobId}/daily-site-updates/day-completion?orgSlug=${encodeURIComponent(orgSlug)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...formValues,
            reportDate,
            notesForTomorrow,
            carryForwards: buildCarryForwardPayload(),
          }),
        }
      );
      const data = (await res.json()) as { ok?: boolean; message?: string; draft?: DailySiteUpdateApiRow };
      if (!res.ok || !data.ok) {
        throw new Error(typeof data.message === 'string' ? data.message : 'Failed to save draft');
      }
      setDraft(data.draft ?? null);
      setSuccess('Day-completion draft saved. The Daily Plan remains active.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save draft');
    } finally {
      setSavingDraft(false);
    }
  }

  async function handleComplete() {
    if (completing || savingDraft) return;
    setCompleting(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(
        `/api/jobs/${jobId}/daily-site-updates/day-completion?orgSlug=${encodeURIComponent(orgSlug)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...formValues,
            reportDate,
            notesForTomorrow,
            carryForwards: buildCarryForwardPayload(),
          }),
        }
      );
      const data = (await res.json()) as {
        ok?: boolean;
        message?: string;
        plan?: DailyPlanApi | null;
        planCompleted?: boolean;
        unresolvedOutcomes?: CarryForwardEligibleOutcome[];
      };
      if (!res.ok || !data.ok) {
        if (res.status === 400 && data.message === DAILY_PLAN_UNRESOLVED_OUTCOMES_MESSAGE) {
          await refresh();
        }
        throw new Error(typeof data.message === 'string' ? data.message : 'Failed to complete report');
      }
      setConfirming(false);
      setSuccess(
        data.planCompleted
          ? 'Daily Report completed. The Daily Plan is now read-only.'
          : 'Daily Report submitted.'
      );
      onPlanCompleted(data.plan ?? null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete report');
    } finally {
      setCompleting(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
        Loading Daily Plan summary…
      </div>
    );
  }

  if (!planMatch || planMatch.kind === 'none') {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
        {planMatch?.message ?? 'No Daily Plan was recorded for this date.'}
      </div>
    );
  }

  if (planMatch.kind === 'draft') {
    return (
      <div className="rounded-lg border border-amber-100 bg-amber-50/60 p-4 text-sm text-amber-950">
        <p className="font-medium">{planMatch.message}</p>
        <p className="mt-1">
          The Daily Report can still be submitted. The draft plan will not be marked completed.
        </p>
        <Link href={planHref} className="mt-2 inline-block text-sm font-medium text-[#698F00] hover:underline">
          Open Daily Plan →
        </Link>
      </div>
    );
  }

  const plan = planMatch.plan;
  const isCompleted = planMatch.kind === 'completed';
  const counts = planMatch.summary;

  return (
    <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">Daily Plan summary</h3>
        <p className="mt-1 text-xs text-gray-500">
          Status: {isCompleted ? 'Completed' : 'Active'}
          {plan.startedByName ? ` · Started by ${plan.startedByName}` : ''}
          {isCompleted && plan.completedByName ? ` · Completed by ${plan.completedByName}` : ''}
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-gray-700 sm:grid-cols-4">
          <p>Planned: {counts.originalPlannedCount}</p>
          <p>Completed: {counts.originalCompletedCount}</p>
          <p>Not completed: {counts.originalNotCompletedCount}</p>
          <p>Cancelled: {counts.originalCancelledCount}</p>
          <p>Unresolved: {counts.originalUnresolvedCount + counts.replacementUnresolvedCount}</p>
          <p>Replacements: {counts.replacementAddedCount}</p>
          <p>Changes: {counts.changePlanCount}</p>
        </div>
      </div>

      {!isCompleted && unresolved.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          <p className="font-semibold">{DAILY_PLAN_UNRESOLVED_OUTCOMES_MESSAGE}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {unresolved.map((item) => (
              <li key={`${item.source}-${item.id}`} className="break-words">
                {item.description}{' '}
                <span className="text-xs">({outcomeExecutionStatusLabel(item.executionStatus)})</span>
              </li>
            ))}
          </ul>
          <Link
            href={planHref}
            className="mt-3 inline-flex min-h-[44px] items-center rounded-lg bg-[#698F00] px-4 py-2 text-sm font-medium text-white hover:bg-[#5a7d00]"
          >
            Return to Daily Plan
          </Link>
        </div>
      )}

      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
          Planned versus actual
        </p>
        <ul className="mt-2 space-y-2">
          {plan.outcomes.map((outcome) => (
            <li key={outcome.id} className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="min-w-0 flex-1 break-words text-gray-900">{outcome.description}</p>
                <span
                  className={`shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium ${statusBadge(outcome.executionStatus)}`}
                >
                  {outcomeExecutionStatusLabel(outcome.executionStatus)}
                </span>
              </div>
              {outcome.completionNote && (
                <p className="mt-1 text-xs text-gray-600">Note: {outcome.completionNote}</p>
              )}
              {outcome.notCompletedReasonCategory && (
                <p className="mt-1 text-xs text-gray-600">
                  {notCompletedReasonLabel(outcome.notCompletedReasonCategory)}
                  {outcome.notCompletedExplanation ? ` — ${outcome.notCompletedExplanation}` : ''}
                </p>
              )}
            </li>
          ))}
        </ul>
      </div>

      {plan.replacementOutcomes.length > 0 && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Replacement work
          </p>
          <ul className="mt-2 space-y-2">
            {plan.replacementOutcomes.map((outcome) => (
              <li
                key={outcome.id}
                className="rounded-lg border border-[#698F00]/20 bg-[#698F00]/5 p-3 text-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 break-words">{outcome.description}</p>
                  <span
                    className={`shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium ${statusBadge(outcome.executionStatus)}`}
                  >
                    {outcomeExecutionStatusLabel(outcome.executionStatus)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {plan.changes.length > 0 && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Plan changes ({plan.changes.length}) · most recent first
          </p>
          <ul className="mt-2 space-y-2">
            {plan.changes.map((change) => (
              <li key={change.id} className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm">
                <p className="font-medium text-gray-900">{changeTypeLabel(change.changeType)}</p>
                <p className="text-xs text-gray-500">
                  {changeReasonLabel(change.reasonCategory)}
                </p>
                <p className="mt-1 break-words">{change.whatChanged}</p>
                <p className="mt-0.5 text-xs text-gray-600 break-words">Why: {change.whyChanged}</p>
                <p className="mt-0.5 text-xs text-gray-600 break-words">
                  Impact today: {change.impactToday}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!isCompleted && effectiveCanCompleteDay && eligible.length > 0 && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Carry forward</p>
          <p className="mt-1 text-xs text-gray-500">
            Mark unfinished work to carry forward. This does not create tomorrow’s plan.
          </p>
          <ul className="mt-2 space-y-3">
            {eligible.map((item) => {
              const key = `${item.source}:${item.id}`;
              const row = carryForwards[key] ?? { carryForward: true, note: '' };
              return (
                <li key={key} className="rounded-lg border border-gray-200 p-3">
                  <p className="text-sm break-words text-gray-900">{item.description}</p>
                  <label className="mt-2 flex min-h-[44px] items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={row.carryForward}
                      onChange={(e) =>
                        setCarryForwards((prev) => ({
                          ...prev,
                          [key]: { ...row, carryForward: e.target.checked },
                        }))
                      }
                      className="h-5 w-5"
                    />
                    Carry forward
                  </label>
                  <input
                    type="text"
                    className="mt-2 w-full min-h-[44px] rounded-lg border border-gray-300 px-3 py-2 text-base"
                    placeholder="Optional carry-forward note"
                    value={row.note}
                    onChange={(e) =>
                      setCarryForwards((prev) => ({
                        ...prev,
                        [key]: { ...row, note: e.target.value },
                      }))
                    }
                  />
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {isCompleted && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Link
            href={planHref}
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Open Daily Plan
          </Link>
          {nextPlanHref && (
            <Link
              href={nextPlanHref}
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-[#698F00] px-4 py-2 text-sm font-medium text-white hover:bg-[#5a7d00]"
            >
              {plan.carryForwards.some((cf) => cf.carryForward)
                ? 'Plan next workday'
                : 'Create next Daily Plan'}
            </Link>
          )}
        </div>
      )}

      {isCompleted && plan.carryForwards.length > 0 && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Carry-forward decisions
          </p>
          <ul className="mt-2 space-y-2 text-sm">
            {plan.carryForwards.map((cf) => (
              <li key={cf.id} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                <p>{cf.carryForward ? 'Carry forward' : 'Do not carry forward'}</p>
                {cf.note && <p className="mt-1 text-xs text-gray-600">{cf.note}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <label className="block">
        <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
          Notes for tomorrow
        </span>
        <textarea
          className="mt-1 w-full min-h-[88px] rounded-lg border border-gray-300 px-3 py-2 text-base disabled:bg-gray-50"
          value={
            isCompleted
              ? draft?.notesForTomorrow || notesForTomorrow
              : notesForTomorrow
          }
          onChange={(e) => setNotesForTomorrow(e.target.value)}
          disabled={isCompleted || !effectiveCanCompleteDay}
          rows={3}
          placeholder="Priorities, materials, access, inspections…"
        />
      </label>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-[#698F00]/20 bg-[#698F00]/5 p-3 text-sm text-[#4f6f00]">
          <p>{success}</p>
          {nextPlanHref && (
            <Link
              href={nextPlanHref}
              className="mt-2 inline-flex min-h-[44px] items-center text-sm font-medium text-[#698F00] hover:underline"
            >
              Create next Daily Plan →
            </Link>
          )}
        </div>
      )}

      {!isCompleted && effectiveCanCompleteDay && (
        <div className="space-y-3">
          {!confirming ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                disabled={savingDraft || completing}
                onClick={() => void handleSaveDraft()}
                className="min-h-[44px] rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                {savingDraft ? 'Saving…' : 'Save day-completion draft'}
              </button>
              <button
                type="button"
                disabled={savingDraft || completing || unresolved.length > 0}
                onClick={() => setConfirming(true)}
                className="min-h-[44px] rounded-lg bg-[#698F00] px-4 py-3 text-sm font-medium text-white hover:bg-[#5a7d00] disabled:opacity-60"
              >
                Complete Daily Report
              </button>
            </div>
          ) : (
            <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
              <div>
                <p className="text-sm font-semibold text-gray-900">
                  {DAILY_REPORT_COMPLETE_CONFIRM_TITLE}
                </p>
                <p className="mt-1 text-sm text-gray-700">{DAILY_REPORT_COMPLETE_CONFIRM_BODY}</p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  disabled={completing}
                  onClick={() => setConfirming(false)}
                  className="min-h-[44px] rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-700"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={completing}
                  onClick={() => void handleComplete()}
                  className="min-h-[44px] rounded-lg bg-[#698F00] px-4 py-3 text-sm font-medium text-white hover:bg-[#5a7d00] disabled:opacity-60"
                >
                  {completing ? 'Completing…' : 'Complete Daily Report'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
