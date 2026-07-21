'use client';

import { useState } from 'react';
import type {
  DailyPlanApi,
  DailyPlanChangeApi,
  DailyPlanOutcomeApi,
  DailyPlanReplacementOutcomeApi,
} from '@/lib/daily-plan-shared';
import {
  DAILY_PLAN_NOT_COMPLETED_REASON_CATEGORIES,
  NOT_COMPLETED_CONFIRM_BODY,
  NOT_COMPLETED_CONFIRM_TITLE,
  changeReasonLabel,
  changeTypeLabel,
  decisionMakerTypeLabel,
  notCompletedReasonLabel,
  outcomeExecutionStatusLabel,
  type DailyPlanChangeType,
  type DailyPlanNotCompletedReasonCategory,
  type DailyPlanOrdinaryStatusTarget,
} from '@/lib/daily-plan-execution';
import { DailyPlanChangeForm } from '@/components/DailyPlanChangeForm';

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-AU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

type ExecutionCallbacks = {
  orgSlug: string;
  jobId: string;
  plan: DailyPlanApi;
  onPlanUpdated: (plan: DailyPlanApi) => void;
  onConflict: () => void;
};

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'in_progress':
      return 'bg-sky-50 text-sky-900 border-sky-200';
    case 'completed':
      return 'bg-[#698F00]/10 text-[#4f6f00] border-[#698F00]/25';
    case 'not_completed':
      return 'bg-amber-50 text-amber-950 border-amber-200';
    case 'cancelled':
      return 'bg-gray-100 text-gray-700 border-gray-300';
    default:
      return 'bg-white text-gray-800 border-gray-200';
  }
}

function OutcomeStatusDetails({
  outcome,
}: {
  outcome: Pick<
    DailyPlanOutcomeApi,
    | 'executionStatus'
    | 'completionNote'
    | 'completedByName'
    | 'completedAt'
    | 'notCompletedReasonCategory'
    | 'notCompletedExplanation'
    | 'statusUpdatedByName'
    | 'statusUpdatedAt'
  >;
}) {
  if (outcome.executionStatus === 'completed') {
    return (
      <div className="mt-2 space-y-1 text-sm text-gray-700">
        {outcome.completionNote && (
          <p>
            <span className="font-medium">Note:</span> {outcome.completionNote}
          </p>
        )}
        <p className="text-xs text-gray-500">
          Completed by {outcome.completedByName ?? 'Unknown'}
          {outcome.completedAt ? ` · ${formatTimestamp(outcome.completedAt)}` : ''}
        </p>
      </div>
    );
  }
  if (outcome.executionStatus === 'not_completed') {
    return (
      <div className="mt-2 space-y-1 text-sm text-gray-700">
        {outcome.notCompletedReasonCategory && (
          <p>
            <span className="font-medium">Reason:</span>{' '}
            {notCompletedReasonLabel(outcome.notCompletedReasonCategory)}
          </p>
        )}
        {outcome.notCompletedExplanation && (
          <p className="whitespace-pre-wrap">{outcome.notCompletedExplanation}</p>
        )}
        <p className="text-xs text-gray-500">
          Updated by {outcome.statusUpdatedByName ?? 'Unknown'}
          {outcome.statusUpdatedAt
            ? ` · ${formatTimestamp(outcome.statusUpdatedAt)}`
            : ''}
        </p>
      </div>
    );
  }
  if (outcome.executionStatus === 'in_progress' && outcome.statusUpdatedAt) {
    return (
      <p className="mt-2 text-xs text-gray-500">
        Started by {outcome.statusUpdatedByName ?? 'Unknown'} ·{' '}
        {formatTimestamp(outcome.statusUpdatedAt)}
      </p>
    );
  }
  if (outcome.executionStatus === 'cancelled' && outcome.statusUpdatedAt) {
    return (
      <p className="mt-2 text-xs text-gray-500">
        Cancelled by {outcome.statusUpdatedByName ?? 'Unknown'} ·{' '}
        {formatTimestamp(outcome.statusUpdatedAt)}
      </p>
    );
  }
  return null;
}

function StatusActionButtons({
  canAct,
  status,
  onStart,
  onComplete,
  onNotCompleted,
  onChangePlan,
  busy,
}: {
  canAct: boolean;
  status: string;
  onStart: () => void;
  onComplete: () => void;
  onNotCompleted: () => void;
  onChangePlan?: () => void;
  busy: boolean;
}) {
  if (!canAct) return null;
  if (status === 'completed' || status === 'not_completed' || status === 'cancelled') {
    return null;
  }

  return (
    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
      {status === 'planned' && (
        <button
          type="button"
          disabled={busy}
          onClick={onStart}
          className="min-h-[44px] rounded-lg bg-[#698F00] px-4 py-3 text-sm font-medium text-white hover:bg-[#5a7d00] disabled:opacity-60"
        >
          Start
        </button>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={onComplete}
        className="min-h-[44px] rounded-lg border border-[#698F00]/30 px-4 py-3 text-sm font-medium text-[#698F00] hover:bg-[#698F00]/5 disabled:opacity-60"
      >
        Mark complete
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={onNotCompleted}
        className="min-h-[44px] rounded-lg border border-amber-300 px-4 py-3 text-sm font-medium text-amber-900 hover:bg-amber-50 disabled:opacity-60"
      >
        Not completed
      </button>
      {onChangePlan && (
        <button
          type="button"
          disabled={busy}
          onClick={onChangePlan}
          className="min-h-[44px] rounded-lg border border-gray-300 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
        >
          Change Plan / Cancel
        </button>
      )}
    </div>
  );
}

function useOutcomeStatusUpdate(props: ExecutionCallbacks & { isReplacement: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [mode, setMode] = useState<'idle' | 'complete' | 'not_completed'>('idle');
  const [completionNote, setCompletionNote] = useState('');
  const [reasonCategory, setReasonCategory] =
    useState<DailyPlanNotCompletedReasonCategory>('unexpected_site_condition');
  const [explanation, setExplanation] = useState('');

  async function postStatus(
    outcomeId: string,
    expectedFromStatus: string,
    toStatus: DailyPlanOrdinaryStatusTarget,
    extras?: {
      completionNote?: string | null;
      notCompletedReasonCategory?: string | null;
      notCompletedExplanation?: string | null;
    }
  ) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const path = props.isReplacement
        ? `/api/jobs/${props.jobId}/daily-plans/${props.plan.id}/replacement-outcomes/${outcomeId}/status`
        : `/api/jobs/${props.jobId}/daily-plans/${props.plan.id}/outcomes/${outcomeId}/status`;
      const res = await fetch(`${path}?orgSlug=${encodeURIComponent(props.orgSlug)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedFromStatus,
          toStatus,
          completionNote: extras?.completionNote ?? null,
          notCompletedReasonCategory: extras?.notCompletedReasonCategory ?? null,
          notCompletedExplanation: extras?.notCompletedExplanation ?? null,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        message?: string;
        plan?: DailyPlanApi;
      };
      if (res.status === 409) {
        setError(
          typeof data.message === 'string'
            ? data.message
            : 'This outcome was updated by another user. The latest plan has been reloaded.'
        );
        props.onConflict();
        return;
      }
      if (!res.ok || !data.ok || !data.plan) {
        throw new Error(typeof data.message === 'string' ? data.message : 'Failed to update status');
      }
      setMode('idle');
      setCompletionNote('');
      setExplanation('');
      setSuccess('Outcome updated.');
      props.onPlanUpdated(data.plan);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status');
    } finally {
      setBusy(false);
    }
  }

  return {
    busy,
    error,
    success,
    mode,
    setMode,
    completionNote,
    setCompletionNote,
    reasonCategory,
    setReasonCategory,
    explanation,
    setExplanation,
    postStatus,
    clearError: () => setError(null),
  };
}

function CompletePrompt({
  note,
  setNote,
  busy,
  onCancel,
  onConfirm,
}: {
  note: string;
  setNote: (v: string) => void;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="mt-3 space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
      <label className="block">
        <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
          Completion note (optional)
        </span>
        <input
          type="text"
          className="mt-1 w-full min-h-[44px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-base"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Completed and ready for inspection"
        />
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="min-h-[44px] rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-700"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className="min-h-[44px] rounded-lg bg-[#698F00] px-4 py-3 text-sm font-medium text-white hover:bg-[#5a7d00] disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'Confirm complete'}
        </button>
      </div>
    </div>
  );
}

function NotCompletedPrompt({
  reasonCategory,
  setReasonCategory,
  explanation,
  setExplanation,
  busy,
  onCancel,
  onConfirm,
}: {
  reasonCategory: DailyPlanNotCompletedReasonCategory;
  setReasonCategory: (v: DailyPlanNotCompletedReasonCategory) => void;
  explanation: string;
  setExplanation: (v: string) => void;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="mt-3 space-y-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
      <div>
        <p className="text-sm font-semibold text-amber-950">{NOT_COMPLETED_CONFIRM_TITLE}</p>
        <p className="mt-1 text-sm text-amber-900">{NOT_COMPLETED_CONFIRM_BODY}</p>
      </div>
      <label className="block">
        <span className="text-xs font-medium uppercase tracking-wide text-amber-800">
          Reason category
        </span>
        <select
          className="mt-1 w-full min-h-[44px] rounded-lg border border-amber-200 bg-white px-3 py-2 text-base"
          value={reasonCategory}
          onChange={(e) =>
            setReasonCategory(e.target.value as DailyPlanNotCompletedReasonCategory)
          }
        >
          {DAILY_PLAN_NOT_COMPLETED_REASON_CATEGORIES.map((reason) => (
            <option key={reason} value={reason}>
              {notCompletedReasonLabel(reason)}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-medium uppercase tracking-wide text-amber-800">
          Explanation
        </span>
        <textarea
          className="mt-1 w-full min-h-[88px] rounded-lg border border-amber-200 bg-white px-3 py-2 text-base"
          value={explanation}
          onChange={(e) => setExplanation(e.target.value)}
          rows={3}
        />
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="min-h-[44px] rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-700"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className="min-h-[44px] rounded-lg bg-amber-800 px-4 py-3 text-sm font-medium text-white hover:bg-amber-900 disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'Confirm not completed'}
        </button>
      </div>
    </div>
  );
}

function BaselineOutcomeCard({
  outcome,
  changeForCancel,
  ...callbacks
}: ExecutionCallbacks & {
  outcome: DailyPlanOutcomeApi;
  changeForCancel: () => void;
}) {
  const status = useOutcomeStatusUpdate({ ...callbacks, isReplacement: false });
  const canAct = callbacks.plan.canUpdateExecution;

  return (
    <li className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Original plan
          </p>
          <p className="mt-1 whitespace-pre-wrap break-words text-gray-900">{outcome.description}</p>
        </div>
        <span
          className={`shrink-0 rounded-md border px-2 py-1 text-xs font-medium ${statusBadgeClass(outcome.executionStatus)}`}
        >
          {outcomeExecutionStatusLabel(outcome.executionStatus)}
        </span>
      </div>
      <OutcomeStatusDetails outcome={outcome} />
      {outcome.executionStatus === 'cancelled' && (
        <p className="mt-2 text-xs text-gray-500">
          See Change history for the related Change Plan entry.
        </p>
      )}
      {status.mode === 'idle' && (
        <StatusActionButtons
          canAct={canAct}
          status={outcome.executionStatus}
          busy={status.busy}
          onStart={() =>
            void status.postStatus(outcome.id, outcome.executionStatus, 'in_progress')
          }
          onComplete={() => status.setMode('complete')}
          onNotCompleted={() => status.setMode('not_completed')}
          onChangePlan={changeForCancel}
        />
      )}
      {status.mode === 'complete' && (
        <CompletePrompt
          note={status.completionNote}
          setNote={status.setCompletionNote}
          busy={status.busy}
          onCancel={() => status.setMode('idle')}
          onConfirm={() =>
            void status.postStatus(outcome.id, outcome.executionStatus, 'completed', {
              completionNote: status.completionNote || null,
            })
          }
        />
      )}
      {status.mode === 'not_completed' && (
        <NotCompletedPrompt
          reasonCategory={status.reasonCategory}
          setReasonCategory={status.setReasonCategory}
          explanation={status.explanation}
          setExplanation={status.setExplanation}
          busy={status.busy}
          onCancel={() => status.setMode('idle')}
          onConfirm={() =>
            void status.postStatus(outcome.id, outcome.executionStatus, 'not_completed', {
              notCompletedReasonCategory: status.reasonCategory,
              notCompletedExplanation: status.explanation,
            })
          }
        />
      )}
      {status.error && (
        <div
          role="alert"
          className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {status.error}
        </div>
      )}
      {status.success && (
        <div
          role="status"
          aria-live="polite"
          className="mt-3 rounded-lg border border-[#698F00]/30 bg-[#698F00]/10 p-3 text-sm text-[#4f6f00]"
        >
          {status.success}
        </div>
      )}
    </li>
  );
}

function ReplacementOutcomeCard({
  outcome,
  ...callbacks
}: ExecutionCallbacks & { outcome: DailyPlanReplacementOutcomeApi }) {
  const status = useOutcomeStatusUpdate({ ...callbacks, isReplacement: true });
  const canAct = callbacks.plan.canUpdateExecution;

  return (
    <li className="rounded-lg border border-[#698F00]/25 bg-[#698F00]/5 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-[#4f6f00]">
            Replacement work · Added after Start Day
          </p>
          <p className="mt-1 whitespace-pre-wrap break-words text-gray-900">{outcome.description}</p>
        </div>
        <span
          className={`shrink-0 rounded-md border px-2 py-1 text-xs font-medium ${statusBadgeClass(outcome.executionStatus)}`}
        >
          {outcomeExecutionStatusLabel(outcome.executionStatus)}
        </span>
      </div>
      <OutcomeStatusDetails outcome={outcome} />
      {status.mode === 'idle' && (
        <StatusActionButtons
          canAct={canAct}
          status={outcome.executionStatus}
          busy={status.busy}
          onStart={() =>
            void status.postStatus(outcome.id, outcome.executionStatus, 'in_progress')
          }
          onComplete={() => status.setMode('complete')}
          onNotCompleted={() => status.setMode('not_completed')}
        />
      )}
      {status.mode === 'complete' && (
        <CompletePrompt
          note={status.completionNote}
          setNote={status.setCompletionNote}
          busy={status.busy}
          onCancel={() => status.setMode('idle')}
          onConfirm={() =>
            void status.postStatus(outcome.id, outcome.executionStatus, 'completed', {
              completionNote: status.completionNote || null,
            })
          }
        />
      )}
      {status.mode === 'not_completed' && (
        <NotCompletedPrompt
          reasonCategory={status.reasonCategory}
          setReasonCategory={status.setReasonCategory}
          explanation={status.explanation}
          setExplanation={status.setExplanation}
          busy={status.busy}
          onCancel={() => status.setMode('idle')}
          onConfirm={() =>
            void status.postStatus(outcome.id, outcome.executionStatus, 'not_completed', {
              notCompletedReasonCategory: status.reasonCategory,
              notCompletedExplanation: status.explanation,
            })
          }
        />
      )}
      {status.error && (
        <div
          role="alert"
          className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {status.error}
        </div>
      )}
      {status.success && (
        <div
          role="status"
          aria-live="polite"
          className="mt-3 rounded-lg border border-[#698F00]/30 bg-[#698F00]/10 p-3 text-sm text-[#4f6f00]"
        >
          {status.success}
        </div>
      )}
    </li>
  );
}

function ChangeHistoryEntry({
  change,
  outcomes,
  replacements,
}: {
  change: DailyPlanChangeApi;
  outcomes: DailyPlanOutcomeApi[];
  replacements: DailyPlanReplacementOutcomeApi[];
}) {
  const affected = change.affectedOutcomeId
    ? outcomes.find((o) => o.id === change.affectedOutcomeId)
    : null;
  const linkedReplacements = replacements.filter((r) =>
    change.replacementOutcomeIds.includes(r.id)
  );
  const decisionMaker =
    change.decisionMakerName ||
    change.decisionMakerLabel ||
    decisionMakerTypeLabel(change.decisionMakerType);

  return (
    <li className="rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-800">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium text-gray-900">{changeTypeLabel(change.changeType)}</p>
        <p className="text-xs text-gray-500">{formatTimestamp(change.createdAt)}</p>
      </div>
      <p className="mt-1 text-xs text-gray-500">
        Reason: {changeReasonLabel(change.reasonCategory)} · Decision: {decisionMaker}
      </p>
      {affected && (
        <p className="mt-2 text-sm">
          <span className="font-medium">Affected outcome:</span> {affected.description}
        </p>
      )}
      <p className="mt-2 whitespace-pre-wrap">
        <span className="font-medium">What changed:</span> {change.whatChanged}
      </p>
      <p className="mt-1 whitespace-pre-wrap">
        <span className="font-medium">Why:</span> {change.whyChanged}
      </p>
      <p className="mt-1 whitespace-pre-wrap">
        <span className="font-medium">Impact today:</span> {change.impactToday}
      </p>
      {change.programmeImpact && (
        <p className="mt-1 whitespace-pre-wrap">
          <span className="font-medium">Programme impact:</span> {change.programmeImpact}
        </p>
      )}
      {linkedReplacements.length > 0 && (
        <div className="mt-2">
          <p className="font-medium">Replacement work</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {linkedReplacements.map((r) => (
              <li key={r.id}>{r.description}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-2 text-xs text-gray-500">Recorded by {change.recordedByName}</p>
    </li>
  );
}

export function DailyPlanActiveExecution({
  orgSlug,
  jobId,
  plan,
  onPlanUpdated,
  onConflict,
}: ExecutionCallbacks) {
  const [showChangeForm, setShowChangeForm] = useState(false);
  const [changeSuccess, setChangeSuccess] = useState<string | null>(null);
  const [changePrefill, setChangePrefill] = useState<{
    changeType: DailyPlanChangeType;
    affectedOutcomeId: string | null;
  } | null>(null);

  const callbacks = { orgSlug, jobId, plan, onPlanUpdated, onConflict };

  function openChangePlan(changeType: DailyPlanChangeType, affectedOutcomeId: string | null) {
    setChangeSuccess(null);
    setChangePrefill({ changeType, affectedOutcomeId });
    setShowChangeForm(true);
  }

  return (
    <div className="mt-4 space-y-5">
      {changeSuccess && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-lg border border-[#698F00]/30 bg-[#698F00]/10 p-3 text-sm text-[#4f6f00]"
        >
          {changeSuccess}
        </div>
      )}
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
          Planned outcomes
        </p>
        <ol className="mt-2 space-y-3">
          {plan.outcomes.map((outcome) => (
            <BaselineOutcomeCard
              key={outcome.id}
              outcome={outcome}
              {...callbacks}
              changeForCancel={() =>
                openChangePlan('cancel_planned_outcome', outcome.id)
              }
            />
          ))}
        </ol>
      </div>

      {plan.replacementOutcomes.length > 0 && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Replacement work
          </p>
          <ul className="mt-2 space-y-3">
            {plan.replacementOutcomes.map((outcome) => (
              <ReplacementOutcomeCard key={outcome.id} outcome={outcome} {...callbacks} />
            ))}
          </ul>
        </div>
      )}

      {plan.canUpdateExecution && !showChangeForm && (
        <button
          type="button"
          onClick={() => openChangePlan('change_crew_allocation', null)}
          className="min-h-[44px] w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-800 hover:bg-gray-50 sm:w-auto"
        >
          Change Plan
        </button>
      )}

      {showChangeForm && plan.canUpdateExecution && (
        <DailyPlanChangeForm
          orgSlug={orgSlug}
          jobId={jobId}
          plan={plan}
          initialChangeType={changePrefill?.changeType}
          initialAffectedOutcomeId={changePrefill?.affectedOutcomeId}
          onSubmitted={(next, message) => {
            setShowChangeForm(false);
            setChangePrefill(null);
            setChangeSuccess(message);
            onPlanUpdated(next);
          }}
          onCancel={() => {
            setShowChangeForm(false);
            setChangePrefill(null);
          }}
          onConflict={onConflict}
        />
      )}

      {plan.changes.length > 0 && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Change history
          </p>
          <p className="mt-1 text-xs text-gray-500">Most recent first</p>
          <ul className="mt-2 space-y-3">
            {plan.changes.map((change) => (
              <ChangeHistoryEntry
                key={change.id}
                change={change}
                outcomes={plan.outcomes}
                replacements={plan.replacementOutcomes}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
