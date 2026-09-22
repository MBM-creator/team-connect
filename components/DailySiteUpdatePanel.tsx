'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatAustralianDateTime } from '@/lib/australian-date';
import { ClientConnectJobSummary } from '@/components/ClientConnectJobSummary';
import { DailySiteUpdateHistory, type DailySiteUpdateApiRow } from '@/components/DailySiteUpdateHistory';
import type { CcProject } from '@/lib/cc-client';
import {
  DAILY_SITE_UPDATE_MAX_FIELD_LENGTH,
  NO_ACTIVE_STAGE_WARNING,
  type OnTrackStatus,
  type StaffRole,
} from '@/lib/daily-site-update-shared';
import { DailyPlanReportSection } from '@/components/DailyPlanReportSection';
import type { DailyPlanReportMatch } from '@/lib/daily-plan-report';

interface JobSummary {
  id: string;
  name: string;
  active_stage_id?: string | null;
  cc_project_id?: string | null;
  cc_quote_id?: string | null;
  cc_client_id?: string | null;
  cc_project_title_snapshot?: string | null;
  cc_client_name_snapshot?: string | null;
}

interface ActiveStageSummary {
  id: string;
  name: string;
  cc_section_trade: string | null;
}

interface ProgressContext {
  plannedHours: number | null;
  hoursUsed: number | null;
  hoursRemaining: number | null;
  hoursSource: string | null;
}

interface TodayBundle {
  ok?: boolean;
  job?: JobSummary;
  ccProject?: CcProject | null;
  activeStage?: ActiveStageSummary | null;
  noActiveStage?: boolean;
  noActiveStageWarning?: string | null;
  progressContext?: ProgressContext | null;
  qaEvidenceWarning?: { message: string; activeRunId: string; qaType?: string } | null;
  recentUpdates?: DailySiteUpdateApiRow[];
  reportDate?: string;
  viewerRole?: StaffRole;
  dailyPlanMatch?: DailyPlanReportMatch;
  message?: string;
}

interface DailySiteUpdatePanelProps {
  orgSlug: string;
  jobId: string;
  jobName: string;
  job: JobSummary;
  hideHeaderContext?: boolean;
  hideQaEvidenceWarning?: boolean;
  historyDefaultOpen?: boolean;
  compactTaskMode?: boolean;
  formDefaultOpen?: boolean;
}

const ON_TRACK_OPTIONS: { value: OnTrackStatus; label: string }[] = [
  { value: 'on_track', label: 'On track' },
  { value: 'at_risk', label: 'At risk' },
  { value: 'off_track', label: 'Off track' },
  { value: 'unknown', label: 'Unknown' },
];

const ON_TRACK_LABELS: Record<OnTrackStatus, string> = {
  on_track: 'On track',
  at_risk: 'At risk',
  off_track: 'Off track',
  unknown: 'Unknown',
};

const ON_TRACK_CLASSES: Record<OnTrackStatus, string> = {
  on_track: 'bg-sc-euca-tint text-sc-euca-hover border-sc-euca/20',
  at_risk: 'bg-amber-50 text-amber-800 border-amber-200',
  off_track: 'bg-red-50 text-red-800 border-red-200',
  unknown: 'bg-gray-100 text-gray-700 border-gray-200',
};

const EMPTY_FORM = {
  progressToday: '',
  issuesFaced: '',
  issuesFacedNone: true,
  problemsResolved: '',
  problemsResolvedNone: true,
  preventionPlan: '',
  preventionPlanNone: true,
  onTrackStatus: 'on_track' as OnTrackStatus,
  onTrackNotes: '',
};

function formatHours(value: number | null): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${value.toFixed(1)} h`;
}

function progressSnippet(text: string, max = 120): string {
  const line = text.trim().split('\n')[0] ?? '';
  if (line.length <= max) return line;
  return `${line.slice(0, max - 1)}…`;
}

function YesNoToggle({
  groupId,
  label,
  yesSelected,
  onChange,
}: {
  groupId: string;
  label: string;
  yesSelected: boolean;
  onChange: (yes: boolean) => void;
}) {
  const base =
    'flex-1 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors min-h-[44px]';
  const active = 'border-sc-euca bg-sc-euca-tint text-sc-euca-hover';
  const inactive = 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50';

  return (
    <div>
      <p id={groupId} className="text-sm font-medium text-gray-700">
        {label}
      </p>
      <div className="mt-2 flex gap-2" role="group" aria-labelledby={groupId}>
        <button
          type="button"
          aria-pressed={!yesSelected}
          onClick={() => onChange(false)}
          className={`${base} ${!yesSelected ? active : inactive}`}
        >
          No
        </button>
        <button
          type="button"
          aria-pressed={yesSelected}
          onClick={() => onChange(true)}
          className={`${base} ${yesSelected ? active : inactive}`}
        >
          Yes
        </button>
      </div>
    </div>
  );
}

export function DailySiteUpdatePanel({
  orgSlug,
  jobId,
  jobName,
  job,
  hideHeaderContext = false,
  hideQaEvidenceWarning = false,
  historyDefaultOpen = true,
  compactTaskMode = false,
  formDefaultOpen,
}: DailySiteUpdatePanelProps) {
  const resolvedFormDefaultOpen = formDefaultOpen ?? !compactTaskMode;
  const [bundle, setBundle] = useState<TodayBundle | null>(null);
  const [updates, setUpdates] = useState<DailySiteUpdateApiRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [showVoided, setShowVoided] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(historyDefaultOpen);
  const [formOpen, setFormOpen] = useState(resolvedFormDefaultOpen);
  const [form, setForm] = useState(EMPTY_FORM);

  const canViewVoided =
    bundle?.viewerRole === 'supervisor' || bundle?.viewerRole === 'admin';

  const loadBundle = useCallback(async () => {
    const res = await fetch(
      `/api/jobs/${jobId}/daily-site-updates/today?orgSlug=${encodeURIComponent(orgSlug)}`
    );
    const data = (await res.json()) as TodayBundle;
    if (!res.ok || !data.ok) {
      throw new Error(typeof data.message === 'string' ? data.message : 'Failed to load daily site update');
    }
    return data;
  }, [jobId, orgSlug]);

  const loadList = useCallback(
    async (includeVoided: boolean) => {
      const params = new URLSearchParams({ orgSlug, limit: '20' });
      if (includeVoided) params.set('includeVoided', '1');
      const res = await fetch(`/api/jobs/${jobId}/daily-site-updates?${params.toString()}`);
      const data = (await res.json()) as { ok?: boolean; updates?: DailySiteUpdateApiRow[]; message?: string };
      if (!res.ok || !data.ok) {
        throw new Error(typeof data.message === 'string' ? data.message : 'Failed to load history');
      }
      return data.updates ?? [];
    },
    [jobId, orgSlug]
  );

  const refresh = useCallback(async () => {
    const [todayData, listData] = await Promise.all([loadBundle(), loadList(showVoided)]);
    setBundle(todayData);
    setUpdates(listData);
  }, [loadBundle, loadList, showVoided]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    Promise.all([loadBundle(), loadList(false)])
      .then(([todayData, listData]) => {
        if (cancelled) return;
        setBundle(todayData);
        setUpdates(listData);
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Failed to load daily site update');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadBundle, loadList]);

  useEffect(() => {
    if (!canViewVoided) return;
    loadList(showVoided)
      .then(setUpdates)
      .catch(() => {});
  }, [canViewVoided, showVoided, loadList]);

  const reportDate = bundle?.reportDate ?? '';
  const todayUpdates = updates.filter((u) => u.reportDate === reportDate && !u.voidedAt);
  const submittedToday = todayUpdates.length > 0;
  const latestToday = submittedToday
    ? todayUpdates.reduce((latest, current) =>
        new Date(current.submittedAt) >= new Date(latest.submittedAt) ? current : latest
      )
    : null;

  const notesRequired =
    form.onTrackStatus === 'at_risk' ||
    form.onTrackStatus === 'off_track' ||
    form.onTrackStatus === 'unknown';

  const showOnTrackNotes =
    notesRequired || form.onTrackNotes.trim().length > 0;

  const showForm = !compactTaskMode || formOpen;

  function openForm() {
    setSubmitError(null);
    setFormOpen(true);
  }

  function hideForm() {
    setFormOpen(false);
    setSubmitError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setSubmitSuccess(null);
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/jobs/${jobId}/daily-site-updates?orgSlug=${encodeURIComponent(orgSlug)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            progressToday: form.progressToday,
            issuesFaced: form.issuesFaced,
            issuesFacedNone: form.issuesFacedNone,
            problemsResolved: form.problemsResolved,
            problemsResolvedNone: form.problemsResolvedNone,
            preventionPlan: form.preventionPlan,
            preventionPlanNone: form.preventionPlanNone,
            onTrackStatus: form.onTrackStatus,
            onTrackNotes: form.onTrackNotes,
          }),
        }
      );
      const data = (await res.json()) as {
        ok?: boolean;
        message?: string;
        savedAtJobLevelOnly?: boolean;
      };
      if (!res.ok || !data.ok) {
        throw new Error(typeof data.message === 'string' ? data.message : 'Failed to submit');
      }
      setForm(EMPTY_FORM);
      setSubmitSuccess(
        data.savedAtJobLevelOnly ? NO_ACTIVE_STAGE_WARNING : 'Daily site update submitted.'
      );
      if (compactTaskMode) {
        setFormOpen(false);
      }
      await refresh();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVoid(updateId: string, voidReason: string) {
    setVoidingId(updateId);
    try {
      const res = await fetch(
        `/api/jobs/${jobId}/daily-site-updates/${updateId}/void?orgSlug=${encodeURIComponent(orgSlug)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ voidReason }),
        }
      );
      const data = (await res.json()) as { ok?: boolean; message?: string };
      if (!res.ok || !data.ok) {
        throw new Error(typeof data.message === 'string' ? data.message : 'Failed to void update');
      }
      setSubmitSuccess(null);
      await refresh();
    } finally {
      setVoidingId(null);
    }
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <p className="text-sm text-gray-600">Loading daily site update…</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
        {loadError}
      </div>
    );
  }

  const activeStage = bundle?.activeStage ?? null;
  const progressContext = bundle?.progressContext ?? null;
  const qaWarning = bundle?.qaEvidenceWarning ?? null;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Daily site update</h2>

        {compactTaskMode && !formOpen && (
          <div className="mt-3 space-y-4">
            <p className="text-sm font-medium text-gray-900">
              {submittedToday ? 'Submitted today' : 'Not submitted today'}
            </p>

            {latestToday && (
              <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{latestToday.authorName}</p>
                    {latestToday.submittedAt && (
                      <p className="text-xs text-gray-500">{formatAustralianDateTime(latestToday.submittedAt)}</p>
                    )}
                  </div>
                  <span
                    className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${ON_TRACK_CLASSES[latestToday.onTrackStatus]}`}
                  >
                    {ON_TRACK_LABELS[latestToday.onTrackStatus]}
                  </span>
                </div>
                {latestToday.progressToday.trim() && (
                  <p className="text-sm text-gray-700">{progressSnippet(latestToday.progressToday)}</p>
                )}
              </div>
            )}

            {submitSuccess && submittedToday && (
              <p className="text-sm text-sc-euca">{submitSuccess}</p>
            )}

            <button
              type="button"
              onClick={openForm}
              className="block w-full rounded-lg bg-sc-euca px-4 py-3 text-center text-sm font-medium text-white transition-colors hover:bg-sc-euca-hover sm:w-auto"
            >
              {submittedToday ? 'Add another update' : 'Add daily update'}
            </button>

            {!historyOpen && (
              <button
                type="button"
                onClick={() => setHistoryOpen(true)}
                className="block py-2 text-sm font-medium text-sc-euca hover:underline"
              >
                Show daily update history
              </button>
            )}
          </div>
        )}

        {showForm && (
          <>
            {!hideHeaderContext && (
              <>
                <p className="mt-1 text-sm text-gray-600">{jobName}</p>
                <ClientConnectJobSummary
                  job={job}
                  compact
                  className="mt-1"
                />

                {activeStage ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className="text-sm font-medium text-sc-euca">{activeStage.name}</span>
                    {activeStage.cc_section_trade && (
                      <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                        {activeStage.cc_section_trade.replace(/_/g, ' ')}
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    {NO_ACTIVE_STAGE_WARNING}
                  </div>
                )}
              </>
            )}

            {progressContext && (
              <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Progress context
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  Read-only labour budget context from this stage. Actual time tracking is not integrated yet.
                </p>
                <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <dt className="text-xs text-gray-500">Planned</dt>
                    <dd className="font-medium text-gray-900">{formatHours(progressContext.plannedHours)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500">Used</dt>
                    <dd className="font-medium text-gray-900">{formatHours(progressContext.hoursUsed)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500">Remaining</dt>
                    <dd className="font-medium text-gray-900">{formatHours(progressContext.hoursRemaining)}</dd>
                  </div>
                </dl>
              </div>
            )}

            {qaWarning && !hideQaEvidenceWarning && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                {qaWarning.message}
              </div>
            )}

            {compactTaskMode && formOpen && (
              <button
                type="button"
                onClick={hideForm}
                className="mt-4 py-2 text-sm font-medium text-sc-euca hover:underline"
              >
                Hide form
              </button>
            )}

            <form onSubmit={handleSubmit} className="mt-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700" htmlFor="dsu-progress">
                  What progress was made today?
                </label>
                <textarea
                  id="dsu-progress"
                  required
                  rows={3}
                  maxLength={DAILY_SITE_UPDATE_MAX_FIELD_LENGTH}
                  value={form.progressToday}
                  onChange={(e) => setForm((prev) => ({ ...prev, progressToday: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>

              <div className="space-y-2">
                <YesNoToggle
                  groupId="dsu-issues-toggle"
                  label="Any issues today?"
                  yesSelected={!form.issuesFacedNone}
                  onChange={(yes) =>
                    setForm((prev) => ({
                      ...prev,
                      issuesFacedNone: !yes,
                      issuesFaced: yes ? prev.issuesFaced : '',
                    }))
                  }
                />
                {!form.issuesFacedNone && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700" htmlFor="dsu-issues">
                      What issues did you face?
                    </label>
                    <textarea
                      id="dsu-issues"
                      required
                      rows={2}
                      maxLength={DAILY_SITE_UPDATE_MAX_FIELD_LENGTH}
                      value={form.issuesFaced}
                      onChange={(e) => setForm((prev) => ({ ...prev, issuesFaced: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    />
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <YesNoToggle
                  groupId="dsu-resolved-toggle"
                  label="Any problems resolved today?"
                  yesSelected={!form.problemsResolvedNone}
                  onChange={(yes) =>
                    setForm((prev) => ({
                      ...prev,
                      problemsResolvedNone: !yes,
                      problemsResolved: yes ? prev.problemsResolved : '',
                    }))
                  }
                />
                {!form.problemsResolvedNone && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700" htmlFor="dsu-resolved">
                      What problems did you resolve?
                    </label>
                    <textarea
                      id="dsu-resolved"
                      required
                      rows={2}
                      maxLength={DAILY_SITE_UPDATE_MAX_FIELD_LENGTH}
                      value={form.problemsResolved}
                      onChange={(e) => setForm((prev) => ({ ...prev, problemsResolved: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    />
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <YesNoToggle
                  groupId="dsu-prevention-toggle"
                  label="Any prevention action required?"
                  yesSelected={!form.preventionPlanNone}
                  onChange={(yes) =>
                    setForm((prev) => ({
                      ...prev,
                      preventionPlanNone: !yes,
                      preventionPlan: yes ? prev.preventionPlan : '',
                    }))
                  }
                />
                {!form.preventionPlanNone && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700" htmlFor="dsu-prevention">
                      How can we eliminate/prevent those problems in future?
                    </label>
                    <textarea
                      id="dsu-prevention"
                      required
                      rows={2}
                      maxLength={DAILY_SITE_UPDATE_MAX_FIELD_LENGTH}
                      value={form.preventionPlan}
                      onChange={(e) => setForm((prev) => ({ ...prev, preventionPlan: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    />
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700" htmlFor="dsu-on-track">
                  Are we on track?
                </label>
                <select
                  id="dsu-on-track"
                  value={form.onTrackStatus}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      onTrackStatus: e.target.value as OnTrackStatus,
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                >
                  {ON_TRACK_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              {showOnTrackNotes && (
                <div>
                  <label className="block text-sm font-medium text-gray-700" htmlFor="dsu-on-track-notes">
                    On-track notes{notesRequired ? ' (required)' : ''}
                  </label>
                  <textarea
                    id="dsu-on-track-notes"
                    rows={2}
                    maxLength={DAILY_SITE_UPDATE_MAX_FIELD_LENGTH}
                    required={notesRequired}
                    value={form.onTrackNotes}
                    onChange={(e) => setForm((prev) => ({ ...prev, onTrackNotes: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
              )}

              {submitError && <p className="text-sm text-red-700">{submitError}</p>}
              {!compactTaskMode && submitSuccess && (
                <p className="text-sm text-sc-euca">{submitSuccess}</p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="block w-full rounded-lg bg-sc-euca px-4 py-3 text-sm font-medium text-white hover:bg-sc-euca-hover disabled:opacity-50 sm:w-auto"
              >
                {submitting ? 'Submitting…' : 'Submit daily site update'}
              </button>
            </form>
          </>
        )}
      </div>

      {bundle?.reportDate &&
        (bundle.viewerRole === 'supervisor' || bundle.viewerRole === 'admin') && (
          <DailyPlanReportSection
            orgSlug={orgSlug}
            jobId={jobId}
            reportDate={bundle.reportDate}
            formValues={form}
            canCompleteDay
            onPlanCompleted={() => {
              void refresh();
            }}
          />
        )}

      {(!compactTaskMode || historyOpen) &&
        (!historyOpen ? (
          !compactTaskMode && (
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              className="py-2 text-sm font-medium text-sc-euca hover:underline"
            >
              Show daily update history
            </button>
          )
        ) : (
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setHistoryOpen(false)}
              className="py-2 text-sm font-medium text-sc-euca hover:underline"
            >
              Hide daily update history
            </button>
            <DailySiteUpdateHistory
              orgSlug={orgSlug}
              jobId={jobId}
              updates={updates}
              showVoided={showVoided}
              onToggleShowVoided={() => setShowVoided((prev) => !prev)}
              canViewVoided={canViewVoided}
              onVoid={handleVoid}
              voidingId={voidingId}
            />
          </div>
        ))}
    </div>
  );
}
