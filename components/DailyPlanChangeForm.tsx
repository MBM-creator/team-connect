'use client';

import { useMemo, useState } from 'react';
import type { DailyPlanApi, DailyPlanOutcomeApi } from '@/lib/daily-plan-shared';
import {
  CANCEL_OUTCOME_CONFIRM_BODY,
  CANCEL_OUTCOME_CONFIRM_TITLE,
  CHANGE_PLAN_CONFIRM_BODY,
  CHANGE_PLAN_CONFIRM_TITLE,
  DAILY_PLAN_CHANGE_REASON_CATEGORIES,
  DAILY_PLAN_CHANGE_TYPES,
  DAILY_PLAN_DECISION_MAKER_TYPES,
  changeReasonLabel,
  changeTypeLabel,
  decisionMakerTypeLabel,
  type DailyPlanChangeType,
  type DailyPlanDecisionMakerType,
} from '@/lib/daily-plan-execution';

type DailyPlanChangeFormProps = {
  orgSlug: string;
  jobId: string;
  plan: DailyPlanApi;
  /** Prefill cancel for a specific baseline outcome. */
  initialChangeType?: DailyPlanChangeType;
  initialAffectedOutcomeId?: string | null;
  onSubmitted: (plan: DailyPlanApi, successMessage: string) => void;
  onCancel: () => void;
  onConflict: () => void;
};

const cancellableOutcomes = (outcomes: DailyPlanOutcomeApi[]) =>
  outcomes.filter(
    (o) => o.executionStatus === 'planned' || o.executionStatus === 'in_progress'
  );

export function DailyPlanChangeForm({
  orgSlug,
  jobId,
  plan,
  initialChangeType = 'change_crew_allocation',
  initialAffectedOutcomeId = null,
  onSubmitted,
  onCancel,
  onConflict,
}: DailyPlanChangeFormProps) {
  const [changeType, setChangeType] = useState<DailyPlanChangeType>(initialChangeType);
  const [reasonCategory, setReasonCategory] =
    useState<(typeof DAILY_PLAN_CHANGE_REASON_CATEGORIES)[number]>('supervisor_decision');
  const [whatChanged, setWhatChanged] = useState('');
  const [whyChanged, setWhyChanged] = useState('');
  const [affectedOutcomeId, setAffectedOutcomeId] = useState(initialAffectedOutcomeId ?? '');
  const [decisionMakerType, setDecisionMakerType] =
    useState<DailyPlanDecisionMakerType>('current_supervisor');
  const [decisionMakerLabel, setDecisionMakerLabel] = useState('');
  const [impactToday, setImpactToday] = useState('');
  const [programmeImpact, setProgrammeImpact] = useState('');
  const [replacementDescription, setReplacementDescription] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cancelTargets = useMemo(() => cancellableOutcomes(plan.outcomes), [plan.outcomes]);

  const showAffectedOutcome =
    changeType === 'cancel_planned_outcome' || changeType === 'change_work_sequence';
  const showReplacement =
    changeType === 'cancel_planned_outcome' ||
    changeType === 'add_replacement_outcome' ||
    changeType === 'change_due_to_site_condition' ||
    changeType === 'other';
  const replacementRequired = changeType === 'add_replacement_outcome';
  const needsDecisionLabel =
    decisionMakerType === 'staff_profile' ||
    decisionMakerType === 'management' ||
    decisionMakerType === 'client' ||
    decisionMakerType === 'external_party' ||
    decisionMakerType === 'other';

  const confirmTitle =
    changeType === 'cancel_planned_outcome'
      ? CANCEL_OUTCOME_CONFIRM_TITLE
      : CHANGE_PLAN_CONFIRM_TITLE;
  const confirmBody =
    changeType === 'cancel_planned_outcome'
      ? CANCEL_OUTCOME_CONFIRM_BODY
      : CHANGE_PLAN_CONFIRM_BODY;

  async function handleSubmit() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/jobs/${jobId}/daily-plans/${plan.id}/changes?orgSlug=${encodeURIComponent(orgSlug)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            changeType,
            reasonCategory,
            whatChanged,
            whyChanged,
            affectedOutcomeId: affectedOutcomeId || null,
            decisionMakerType,
            decisionMakerStaffProfileId:
              decisionMakerType === 'current_supervisor'
                ? plan.supervisorStaffProfileId
                : null,
            decisionMakerLabel: decisionMakerLabel || null,
            impactToday,
            programmeImpact: programmeImpact || null,
            replacementDescription: replacementDescription || null,
          }),
        }
      );
      const data = (await res.json()) as {
        ok?: boolean;
        message?: string;
        plan?: DailyPlanApi;
        replacementOutcomeId?: string | null;
      };

      if (res.status === 409) {
        setError(
          typeof data.message === 'string'
            ? data.message
            : 'This Daily Plan was updated by another user. The latest plan has been reloaded.'
        );
        // Keep form fields so the supervisor can retry after reload.
        onConflict();
        return;
      }
      if (!res.ok || !data.ok || !data.plan) {
        throw new Error(typeof data.message === 'string' ? data.message : 'Failed to record plan change');
      }
      const successMessage = data.replacementOutcomeId
        ? 'Plan change recorded. Replacement work added.'
        : 'Plan change recorded.';
      onSubmitted(data.plan, successMessage);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record plan change');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="form"
      aria-labelledby="change-plan-heading"
      className="mt-4 space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-4"
    >
      <div>
        <h3 id="change-plan-heading" className="text-sm font-semibold text-gray-900">
          Change Plan
        </h3>
        <p className="mt-1 text-sm text-gray-600">
          Record a legitimate change without editing the original baseline.
        </p>
      </div>

      <div className="space-y-3">
        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Change type
          </span>
          <select
            className="mt-1 w-full min-h-[44px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-900"
            value={changeType}
            onChange={(e) => setChangeType(e.target.value as DailyPlanChangeType)}
          >
            {DAILY_PLAN_CHANGE_TYPES.map((type) => (
              <option key={type} value={type}>
                {changeTypeLabel(type)}
              </option>
            ))}
          </select>
        </label>

        {showAffectedOutcome && (
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
              {changeType === 'cancel_planned_outcome'
                ? 'Outcome to cancel'
                : 'Affected outcome (optional)'}
            </span>
            <select
              className="mt-1 w-full min-h-[44px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-900"
              value={affectedOutcomeId}
              onChange={(e) => setAffectedOutcomeId(e.target.value)}
            >
              <option value="">Select outcome…</option>
              {(changeType === 'cancel_planned_outcome' ? cancelTargets : plan.outcomes).map(
                (outcome) => (
                  <option key={outcome.id} value={outcome.id}>
                    {outcome.description}
                  </option>
                )
              )}
            </select>
          </label>
        )}

        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Reason category
          </span>
          <select
            className="mt-1 w-full min-h-[44px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-900"
            value={reasonCategory}
            onChange={(e) =>
              setReasonCategory(e.target.value as (typeof DAILY_PLAN_CHANGE_REASON_CATEGORIES)[number])
            }
          >
            {DAILY_PLAN_CHANGE_REASON_CATEGORIES.map((reason) => (
              <option key={reason} value={reason}>
                {changeReasonLabel(reason)}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
            What changed
          </span>
          <textarea
            className="mt-1 w-full min-h-[88px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-900"
            value={whatChanged}
            onChange={(e) => setWhatChanged(e.target.value)}
            rows={3}
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Why it changed
          </span>
          <textarea
            className="mt-1 w-full min-h-[88px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-900"
            value={whyChanged}
            onChange={(e) => setWhyChanged(e.target.value)}
            rows={3}
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Operational decision maker
          </span>
          <select
            className="mt-1 w-full min-h-[44px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-900"
            value={decisionMakerType}
            onChange={(e) => setDecisionMakerType(e.target.value as DailyPlanDecisionMakerType)}
          >
            {DAILY_PLAN_DECISION_MAKER_TYPES.map((type) => (
              <option key={type} value={type}>
                {decisionMakerTypeLabel(type)}
              </option>
            ))}
          </select>
        </label>

        {needsDecisionLabel && (
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
              Decision maker description
            </span>
            <input
              type="text"
              className="mt-1 w-full min-h-[44px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-900"
              value={decisionMakerLabel}
              onChange={(e) => setDecisionMakerLabel(e.target.value)}
              placeholder="e.g. Steve Mobbs, site supervisor, client, engineer"
            />
          </label>
        )}

        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
            {"Impact on today's work"}
          </span>
          <textarea
            className="mt-1 w-full min-h-[88px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-900"
            value={impactToday}
            onChange={(e) => setImpactToday(e.target.value)}
            rows={3}
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Programme impact (optional)
          </span>
          <textarea
            className="mt-1 w-full min-h-[72px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-900"
            value={programmeImpact}
            onChange={(e) => setProgrammeImpact(e.target.value)}
            rows={2}
          />
        </label>

        {showReplacement && (
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
              Replacement work {replacementRequired ? '' : '(optional)'}
            </span>
            <textarea
              className="mt-1 w-full min-h-[88px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-900"
              value={replacementDescription}
              onChange={(e) => setReplacementDescription(e.target.value)}
              rows={3}
              placeholder="Describe the replacement work for today"
            />
          </label>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {!confirming ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            disabled={submitting}
            onClick={onCancel}
            className="min-h-[44px] rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => setConfirming(true)}
            className="min-h-[44px] rounded-lg bg-[#698F00] px-4 py-3 text-sm font-medium text-white hover:bg-[#5a7d00] disabled:opacity-60"
          >
            Continue
          </button>
        </div>
      ) : (
        <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-3">
          <div>
            <p className="text-sm font-semibold text-gray-900">{confirmTitle}</p>
            <p className="mt-1 text-sm text-gray-700">{confirmBody}</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              disabled={submitting}
              onClick={() => setConfirming(false)}
              className="min-h-[44px] rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              Back
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => void handleSubmit()}
              className="min-h-[44px] rounded-lg bg-[#698F00] px-4 py-3 text-sm font-medium text-white hover:bg-[#5a7d00] disabled:opacity-60"
            >
              {submitting ? 'Submitting…' : 'Submit Change Plan'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
