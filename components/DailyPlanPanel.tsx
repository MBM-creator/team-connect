'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DailyPlanApi } from '@/lib/daily-plan-shared';
import {
  DAILY_PLAN_EMPTY_MESSAGE,
  DAILY_PLAN_DAY_STARTED_MESSAGE,
  DAILY_PLAN_START_CONFIRM_BODY,
  DAILY_PLAN_START_CONFIRM_TITLE,
  getDailyPlanUiState,
} from '@/lib/daily-plan-shared';
import { outcomeExecutionStatusLabel } from '@/lib/daily-plan-execution';
import { todayReportDate } from '@/lib/report-date';
import { DailyPlanActiveExecution } from '@/components/DailyPlanExecution';
import { nextMelbourneWorkDate } from '@/lib/daily-plan-carry-forward-suggestions';

type DailyPlanPanelProps = {
  orgSlug: string;
  jobId: string;
  jobName: string;
  /** When true, emphasises this as the supervisor plan entry point on the job home page. */
  highlightOnJobHome?: boolean;
};

type DailyPlanViewProps = {
  plan: DailyPlanApi;
  orgSlug?: string;
  jobId?: string;
  onPlanUpdated?: (plan: DailyPlanApi) => void;
  onConflict?: () => void;
};

function formatWorkDateLabel(workDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) return workDate;
  const [y, m, d] = workDate.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

export function formatDailyPlanStartedAt(startedAt: string): string {
  const date = new Date(startedAt);
  if (Number.isNaN(date.getTime())) return startedAt;
  return date.toLocaleString('en-AU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function DailyPlanView({
  plan,
  orgSlug,
  jobId,
  onPlanUpdated,
  onConflict,
}: DailyPlanViewProps) {
  const ui = getDailyPlanUiState({
    status: plan.status,
    workDate: plan.workDate,
    canEditRole: plan.canEdit || plan.canStartDay,
  });
  const showActiveExecution =
    (plan.status === 'active' || plan.status === 'completed') &&
    Boolean(orgSlug && jobId && onPlanUpdated && onConflict);
  const nextWorkDate =
    plan.status === 'completed' ? nextMelbourneWorkDate(plan.workDate) : null;
  const nextPlanHref =
    nextWorkDate && orgSlug && jobId
      ? `/t/${orgSlug}/jobs/${jobId}/daily-plan?workDate=${encodeURIComponent(nextWorkDate)}`
      : null;

  return (
    <div className="mt-4 space-y-4 text-sm text-gray-800">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Status</p>
          <p className="mt-0.5 font-medium text-gray-900">{ui.statusLabel}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Work date</p>
          <p className="mt-0.5 font-medium text-gray-900">{formatWorkDateLabel(plan.workDate)}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Supervisor</p>
          <p className="mt-0.5 font-medium text-gray-900">{plan.supervisorName}</p>
        </div>
        {plan.status === 'active' && (
          <>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Started by</p>
              <p className="mt-0.5 font-medium text-gray-900">
                {plan.startedByName ?? 'Unknown staff member'}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Started at</p>
              <p className="mt-0.5 font-medium text-gray-900">
                {plan.startedAt ? formatDailyPlanStartedAt(plan.startedAt) : '—'}
              </p>
            </div>
          </>
        )}
        {plan.status === 'completed' && (
          <>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Started by</p>
              <p className="mt-0.5 font-medium text-gray-900">
                {plan.startedByName ?? 'Unknown staff member'}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Completed by</p>
              <p className="mt-0.5 font-medium text-gray-900">
                {plan.completedByName ?? 'Unknown staff member'}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Completed at</p>
              <p className="mt-0.5 font-medium text-gray-900">
                {plan.completedAt ? formatDailyPlanStartedAt(plan.completedAt) : '—'}
              </p>
            </div>
          </>
        )}
      </div>

      {ui.supportingMessage && (
        <div
          className={
            ui.isBaselineLocked
              ? 'rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700'
              : 'rounded-lg border border-amber-100 bg-amber-50/60 p-3 text-sm text-amber-950'
          }
        >
          {ui.supportingMessage}
        </div>
      )}

      {nextPlanHref && (
        <Link
          href={nextPlanHref}
          className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-sc-euca px-4 py-2 text-sm font-medium text-white hover:bg-sc-euca-hover sm:w-auto"
        >
          Plan next workday
        </Link>
      )}

      {plan.status === 'active' && orgSlug && jobId && (
        <p className="text-sm text-gray-700">
          Next: record progress in the{' '}
          <a href="#daily-site-update" className="font-medium text-sc-euca hover:underline">
            Daily Site Update
          </a>
          , then complete the Daily Report when outcomes are resolved.
        </p>
      )}

      {showActiveExecution ? (
        <DailyPlanActiveExecution
          orgSlug={orgSlug!}
          jobId={jobId!}
          plan={plan}
          onPlanUpdated={onPlanUpdated!}
          onConflict={onConflict!}
        />
      ) : (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Planned outcomes
          </p>
          <ol className="mt-1 list-decimal space-y-2 pl-5">
            {plan.outcomes.map((outcome) => (
              <li key={outcome.id} className="whitespace-pre-wrap break-words">
                {outcome.description}
                {plan.status === 'active' && (
                  <span className="ml-2 text-xs text-gray-500">
                    ({outcomeExecutionStatusLabel(outcome.executionStatus)})
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      {plan.crewResponsibilities.length > 0 && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Crew responsibilities
          </p>
          <p className="mt-0.5 text-xs text-gray-500">Original baseline</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {plan.crewResponsibilities.map((row) => (
              <li key={row.id}>
                <span className="font-medium">{row.crewMemberName}</span>
                {' — '}
                {row.responsibility}
              </li>
            ))}
          </ul>
        </div>
      )}

      {plan.materials.length > 0 && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Materials required
          </p>
          <p className="mt-0.5 text-xs text-gray-500">Original baseline</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {plan.materials.map((row) => (
              <li key={row.id}>
                {row.description}
                {row.quantity ? ` — ${row.quantity}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      {plan.equipment.length > 0 && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Equipment required
          </p>
          <p className="mt-0.5 text-xs text-gray-500">Original baseline</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {plan.equipment.map((row) => (
              <li key={row.id}>{row.description}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-amber-100 bg-amber-50/60 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-amber-800">
            Risks or constraints
          </p>
          <p className="mt-1 whitespace-pre-wrap text-amber-950">
            {plan.risksConstraints?.trim() || 'None recorded'}
          </p>
        </div>
        <div className="rounded-lg border border-sc-euca/20 bg-sc-euca-tint p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-sc-euca-hover">
            Contingency plan
          </p>
          <p className="mt-1 whitespace-pre-wrap text-gray-900">
            {plan.contingencyPlan?.trim() || 'None recorded'}
          </p>
        </div>
      </div>

      {plan.generalNotes?.trim() && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">General notes</p>
          <p className="mt-1 whitespace-pre-wrap">{plan.generalNotes}</p>
        </div>
      )}

      {!showActiveExecution && plan.status === 'active' && plan.replacementOutcomes.length > 0 && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Replacement work
          </p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {plan.replacementOutcomes.map((row) => (
              <li key={row.id} className="whitespace-pre-wrap break-words">
                {row.description}{' '}
                <span className="text-xs text-gray-500">
                  ({outcomeExecutionStatusLabel(row.executionStatus)})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!showActiveExecution && plan.status === 'active' && plan.changes.length > 0 && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Change history
          </p>
          <p className="mt-1 text-xs text-gray-500">Most recent first</p>
          <ul className="mt-2 space-y-2">
            {plan.changes.map((change) => (
              <li
                key={change.id}
                className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800"
              >
                <p className="font-medium text-gray-900">{change.whatChanged}</p>
                <p className="mt-1 text-xs text-gray-500">
                  {formatDailyPlanStartedAt(change.createdAt)} · {change.recordedByName}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

type DailyPlanStartDayControlsProps = {
  orgSlug: string;
  jobId: string;
  plan: DailyPlanApi;
  onStarted: (plan: DailyPlanApi) => void;
  onConflict: () => void;
};

export function DailyPlanStartDayControls({
  orgSlug,
  jobId,
  plan,
  onStarted,
  onConflict,
}: DailyPlanStartDayControlsProps) {
  const [confirming, setConfirming] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!plan.canStartDay) return null;

  async function handleStartDay() {
    if (starting) return;
    setStarting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/jobs/${jobId}/daily-plans/${plan.id}/start?orgSlug=${encodeURIComponent(orgSlug)}`,
        { method: 'POST' }
      );
      const data = (await res.json()) as {
        ok?: boolean;
        message?: string;
        plan?: DailyPlanApi;
      };

      if (res.status === 409) {
        setError(typeof data.message === 'string' ? data.message : 'Daily Plan already started');
        onConflict();
        return;
      }

      if (!res.ok || !data.ok || !data.plan) {
        throw new Error(typeof data.message === 'string' ? data.message : 'Failed to start day');
      }

      setConfirming(false);
      onStarted(data.plan);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start day');
    } finally {
      setStarting(false);
    }
  }

  if (!confirming) {
    return (
      <div className="mt-4 space-y-2">
        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          >
            {error}
          </div>
        )}
        <button
          type="button"
          disabled={starting}
          onClick={() => setConfirming(true)}
          className="block w-full min-h-[44px] rounded-lg bg-sc-euca px-4 py-3 text-center text-sm font-medium text-white transition-colors hover:bg-sc-euca-hover disabled:cursor-not-allowed disabled:opacity-60 sm:inline-block sm:w-auto"
        >
          Start Day
        </button>
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-labelledby="start-day-confirm-title"
      className="mt-4 space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4"
    >
      <div>
        <p id="start-day-confirm-title" className="text-sm font-semibold text-gray-900">
          {DAILY_PLAN_START_CONFIRM_TITLE}
        </p>
        <p className="mt-1 text-sm text-gray-700">{DAILY_PLAN_START_CONFIRM_BODY}</p>
      </div>
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </div>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button
          type="button"
          disabled={starting}
          onClick={() => {
            if (starting) return;
            setConfirming(false);
            setError(null);
          }}
          className="min-h-[44px] rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={starting}
          onClick={() => void handleStartDay()}
          className="min-h-[44px] rounded-lg bg-sc-euca px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-sc-euca-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {starting ? 'Starting…' : 'Start Day'}
        </button>
      </div>
    </div>
  );
}

export function DailyPlanPanel({
  orgSlug,
  jobId,
  jobName,
  highlightOnJobHome = false,
}: DailyPlanPanelProps) {
  const [workDate, setWorkDate] = useState(() => todayReportDate());
  const [plan, setPlan] = useState<DailyPlanApi | null>(null);
  const [canEditRole, setCanEditRole] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgSlug || !jobId || !workDate) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/jobs/${jobId}/daily-plans?orgSlug=${encodeURIComponent(orgSlug)}&workDate=${encodeURIComponent(workDate)}`
      );
      const data = (await res.json()) as {
        ok?: boolean;
        message?: string;
        plan?: DailyPlanApi | null;
        canEdit?: boolean;
      };
      if (!res.ok || !data.ok) {
        throw new Error(typeof data.message === 'string' ? data.message : 'Failed to load Daily Plan');
      }
      setPlan(data.plan ?? null);
      setCanEditRole(Boolean(data.canEdit));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Daily Plan');
      setPlan(null);
    } finally {
      setLoading(false);
    }
  }, [orgSlug, jobId, workDate]);

  useEffect(() => {
    void load();
  }, [load]);

  const ui = useMemo(() => {
    if (!plan) return null;
    return getDailyPlanUiState({
      status: plan.status,
      workDate: plan.workDate,
      canEditRole: canEditRole || plan.canEdit || plan.canStartDay,
    });
  }, [plan, canEditRole]);

  const formHref = `/t/${orgSlug}/jobs/${jobId}/daily-plan?workDate=${encodeURIComponent(workDate)}`;
  const editHref = plan
    ? `/t/${orgSlug}/jobs/${jobId}/daily-plan?workDate=${encodeURIComponent(workDate)}&planId=${encodeURIComponent(plan.id)}`
    : formHref;

  const showEdit = Boolean(ui?.showEdit || plan?.canEdit);
  const showStartDay = Boolean(ui?.showStartDay || plan?.canStartDay);

  return (
    <div
      id={highlightOnJobHome ? 'supervisor-daily-plan' : undefined}
      className={`rounded-lg border bg-white p-5 shadow-sm ${
        highlightOnJobHome ? 'border-sc-euca/40' : 'border-gray-200'
      }`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            {highlightOnJobHome ? 'Supervisor Daily Plan' : 'Daily Plan'}
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            {highlightOnJobHome
              ? 'Site supervisors add today\'s plan here — outcomes, crew, materials and risks.'
              : jobName}
          </p>
        </div>
        <div className="w-full sm:w-auto">
          <label htmlFor="daily-plan-work-date" className="block text-xs font-medium text-gray-600">
            Work date
          </label>
          <input
            id="daily-plan-work-date"
            type="date"
            className="mt-1 w-full min-h-[44px] rounded-lg border border-gray-300 px-3 py-2 text-base text-gray-900 sm:w-auto"
            value={workDate}
            onChange={(e) => setWorkDate(e.target.value)}
          />
        </div>
      </div>

      {loading && <p className="mt-4 text-sm text-gray-600">Loading Daily Plan…</p>}

      {!loading && error && (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </div>
      )}

      {success && (
        <div
          role="status"
          aria-live="polite"
          className="mt-4 rounded-lg border border-sc-euca/30 bg-sc-euca-tint p-3 text-sm text-sc-euca-hover"
        >
          {success}
        </div>
      )}

      {!loading && !error && !plan && (
        <div className="mt-4 space-y-4">
          <p className="text-sm text-gray-700">{DAILY_PLAN_EMPTY_MESSAGE}</p>
          {canEditRole ? (
            <Link
              href={formHref}
              className="block w-full min-h-[44px] rounded-lg bg-sc-euca px-4 py-3 text-center text-sm font-medium text-white transition-colors hover:bg-sc-euca-hover sm:inline-block sm:w-auto"
            >
              Create Daily Plan
            </Link>
          ) : (
            <p className="text-sm text-gray-500">Ask a supervisor to create the Daily Plan.</p>
          )}
        </div>
      )}

      {!loading && !error && plan && (
        <>
          <DailyPlanView
            plan={plan}
            orgSlug={orgSlug}
            jobId={jobId}
            onPlanUpdated={(next) => {
              setSuccess(null);
              setPlan(next);
            }}
            onConflict={() => void load()}
          />
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start">
            {showEdit && (
              <Link
                href={editHref}
                className="block w-full min-h-[44px] rounded-lg border border-sc-euca/30 px-4 py-3 text-center text-sm font-medium text-sc-euca transition-colors hover:bg-sc-euca-tint sm:inline-block sm:w-auto"
              >
                Edit Daily Plan
              </Link>
            )}
          </div>
          {showStartDay && (
            <DailyPlanStartDayControls
              orgSlug={orgSlug}
              jobId={jobId}
              plan={plan}
              onStarted={(next) => {
                setPlan(next);
                setSuccess(DAILY_PLAN_DAY_STARTED_MESSAGE);
              }}
              onConflict={() => void load()}
            />
          )}
        </>
      )}
    </div>
  );
}
