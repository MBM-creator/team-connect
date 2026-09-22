'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { nextCalendarDate, todayReportDate } from '@/lib/report-date';
import type {
  SiteOpsAction,
  SiteOpsAttentionState,
  SiteOpsJobRow,
  SiteOpsMetrics,
  SiteOpsPlanStatusKey,
} from '@/lib/site-operations';

type SupervisorOption = { id: string; name: string };

type SiteOpsResponse = {
  ok: boolean;
  message?: string;
  workDate: string;
  workTimezone: string;
  metrics: SiteOpsMetrics;
  jobs: SiteOpsJobRow[];
  supervisors: SupervisorOption[];
};

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-gray-900">{value}</p>
    </div>
  );
}

function attentionBadge(state: SiteOpsAttentionState): string {
  switch (state) {
    case 'needs_attention':
      return 'bg-red-50 text-red-800 border-red-200';
    case 'not_started':
      return 'bg-amber-50 text-amber-800 border-amber-200';
    case 'on_track':
      return 'bg-[#698F00]/10 text-[#4f6f00] border-[#698F00]/20';
    case 'complete':
      return 'bg-gray-100 text-gray-700 border-gray-200';
    default:
      return 'bg-gray-100 text-gray-700 border-gray-200';
  }
}

function planBadge(key: SiteOpsPlanStatusKey): string {
  switch (key) {
    case 'no_plan':
      return 'bg-red-50 text-red-800 border-red-200';
    case 'draft':
    case 'draft_not_started':
      return 'bg-amber-50 text-amber-800 border-amber-200';
    case 'active':
      return 'bg-blue-50 text-blue-800 border-blue-200';
    case 'completed':
      return 'bg-gray-100 text-gray-700 border-gray-200';
    default:
      return 'bg-gray-100 text-gray-700 border-gray-200';
  }
}

function outcomeSummary(row: SiteOpsJobRow): string {
  const c = row.outcomeCounts;
  if (row.planStatusKey === 'no_plan') return '—';
  const total = c.originalTotal;
  if (total === 0 && c.replacementAdded === 0) return 'No outcomes';
  const parts = [
    `${c.originalCompleted}/${total} done`,
  ];
  if (c.originalUnresolved + c.replacementUnresolved > 0) {
    parts.push(`${c.originalUnresolved + c.replacementUnresolved} open`);
  }
  if (c.originalNotCompleted + c.replacementNotCompleted > 0) {
    parts.push(`${c.originalNotCompleted + c.replacementNotCompleted} not completed`);
  }
  if (c.replacementAdded > 0) {
    parts.push(`+${c.replacementAdded} replacement`);
  }
  return parts.join(' · ');
}

function actionHref(
  orgSlug: string,
  row: SiteOpsJobRow,
  action: SiteOpsAction,
  workDate: string
): string {
  const base = `/t/${orgSlug}/jobs/${row.jobId}`;
  switch (action) {
    case 'open_today':
      return `${base}/today`;
    case 'create_plan':
      return `${base}/daily-plan?workDate=${encodeURIComponent(workDate)}`;
    case 'view_plan':
      return `${base}/daily-plan?workDate=${encodeURIComponent(workDate)}`;
    case 'complete_report':
      return `${base}/today#daily-site-update`;
    case 'view_report':
      return `${base}/today#daily-site-update`;
    case 'plan_next_day': {
      const next = nextCalendarDate(workDate);
      return `${base}/daily-plan?workDate=${encodeURIComponent(next ?? workDate)}`;
    }
    default:
      return base;
  }
}

function actionLabel(action: SiteOpsAction): string {
  switch (action) {
    case 'open_today':
      return 'Open Today';
    case 'create_plan':
      return 'Create Daily Plan';
    case 'view_plan':
      return 'View Daily Plan';
    case 'complete_report':
      return 'Complete Daily Report';
    case 'view_report':
      return 'View report';
    case 'plan_next_day':
      return 'Plan next day';
    default:
      return action;
  }
}

function primaryAction(row: SiteOpsJobRow): SiteOpsAction {
  if (row.actions.includes('create_plan')) return 'create_plan';
  if (row.actions.includes('complete_report')) return 'complete_report';
  if (row.actions.includes('view_report')) return 'view_report';
  if (row.actions.includes('view_plan')) return 'view_plan';
  return 'open_today';
}

export function SiteOperationsDashboard({ orgSlug }: { orgSlug: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const workDate = searchParams.get('workDate')?.trim() || todayReportDate();
  const planStatus = searchParams.get('planStatus')?.trim() || 'all';
  const attention = searchParams.get('attention')?.trim() || 'all';
  const supervisor = searchParams.get('supervisor')?.trim() || 'all';
  const q = searchParams.get('q')?.trim() || '';

  const [qDraft, setQDraft] = useState(q);
  const [data, setData] = useState<SiteOpsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setQDraft(q);
  }, [q]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ orgSlug, workDate });
    if (planStatus !== 'all') params.set('planStatus', planStatus);
    if (attention !== 'all') params.set('attention', attention);
    if (supervisor !== 'all') params.set('supervisor', supervisor);
    if (q) params.set('q', q);
    return params.toString();
  }, [orgSlug, workDate, planStatus, attention, supervisor, q]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/site-operations/daily?${queryString}`);
      const json = (await res.json()) as SiteOpsResponse;
      if (!res.ok || !json.ok) {
        setError(json.message || 'Failed to load Site Operations');
        setData(null);
        return;
      }
      setData(json);
    } catch {
      setError('Failed to load Site Operations');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    void load();
  }, [load]);

  function updateFilters(patch: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (!value || value === 'all') params.delete(key);
      else params.set(key, value);
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  function onSubmitSearch(e: React.FormEvent) {
    e.preventDefault();
    updateFilters({ q: qDraft.trim() });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <form
          className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end"
          onSubmit={onSubmitSearch}
        >
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-gray-700">Work date</span>
            <input
              type="date"
              value={workDate}
              onChange={(e) => updateFilters({ workDate: e.target.value })}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-gray-700">Plan status</span>
            <select
              value={planStatus}
              onChange={(e) => updateFilters({ planStatus: e.target.value })}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="all">All plans</option>
              <option value="no_plan">No plan</option>
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="completed">Completed</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-gray-700">Attention</span>
            <select
              value={attention}
              onChange={(e) => updateFilters({ attention: e.target.value })}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="all">All attention</option>
              <option value="needs_attention">Needs attention</option>
              <option value="not_started">Not started</option>
              <option value="on_track">On track</option>
              <option value="complete">Complete</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-gray-700">Supervisor</span>
            <select
              value={supervisor}
              onChange={(e) => updateFilters({ supervisor: e.target.value })}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm min-w-[10rem]"
            >
              <option value="all">All supervisors</option>
              {(data?.supervisors ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-sm">
            <span className="font-medium text-gray-700">Search</span>
            <input
              type="search"
              value={qDraft}
              onChange={(e) => setQDraft(e.target.value)}
              placeholder="Job or client name"
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
            >
              Refresh
            </button>
          </div>
        </form>
        <p className="mt-3 text-xs text-gray-500">
          Melbourne work date · operational jobs only.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
      )}

      {loading && <p className="text-gray-600">Loading Site Operations…</p>}

      {!loading && data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <MetricCard label="Operational jobs" value={data.metrics.operationalJobs} />
            <MetricCard label="No plan" value={data.metrics.noPlan} />
            <MetricCard label="Active" value={data.metrics.active} />
            <MetricCard label="Needs attention" value={data.metrics.needsAttention} />
            <MetricCard label="Completed" value={data.metrics.completed} />
          </div>

          {/* Desktop table */}
          <section className="hidden overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm md:block">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-3">Job</th>
                    <th className="px-4 py-3">Supervisor</th>
                    <th className="px-4 py-3">Plan</th>
                    <th className="px-4 py-3">Outcomes</th>
                    <th className="px-4 py-3">Changes</th>
                    <th className="px-4 py-3">Daily Report</th>
                    <th className="px-4 py-3">Attention</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.jobs.map((row) => (
                    <tr key={row.jobId} className="border-t border-gray-100 align-top">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{row.jobName}</div>
                        {(row.clientName || row.projectTitle) && (
                          <div className="text-xs text-gray-500">
                            {[row.clientName, row.projectTitle].filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-700">{row.supervisorName ?? '—'}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${planBadge(row.planStatusKey)}`}
                        >
                          {row.planStatusLabel}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{outcomeSummary(row)}</td>
                      <td className="px-4 py-3 text-gray-700">
                        {row.planStatusKey === 'no_plan'
                          ? '—'
                          : row.changeAwarenessLabel ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-700">{row.dailyReportLabel}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${attentionBadge(row.attentionState)}`}
                        >
                          {row.attentionLabel}
                        </span>
                        {row.attentionReasons.length > 0 && (
                          <ul className="mt-1 space-y-0.5 text-xs text-gray-500">
                            {row.attentionReasons.slice(0, 3).map((reason) => (
                              <li key={reason}>{reason}</li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          {row.actions.map((action) => (
                            <Link
                              key={action}
                              href={actionHref(orgSlug, row, action, workDate)}
                              className="text-[#698F00] hover:underline"
                            >
                              {actionLabel(action)}
                            </Link>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {data.jobs.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                        No operational jobs match these filters for {workDate}.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Mobile cards */}
          <div className="space-y-3 md:hidden">
            {data.jobs.length === 0 && (
              <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
                No operational jobs match these filters for {workDate}.
              </div>
            )}
            {data.jobs.map((row) => {
              const primary = primaryAction(row);
              return (
                <article
                  key={row.jobId}
                  className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-semibold text-gray-900">{row.jobName}</h3>
                      {(row.clientName || row.projectTitle) && (
                        <p className="text-xs text-gray-500">
                          {[row.clientName, row.projectTitle].filter(Boolean).join(' · ')}
                        </p>
                      )}
                    </div>
                    <span
                      className={`inline-flex shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${attentionBadge(row.attentionState)}`}
                    >
                      {row.attentionLabel}
                    </span>
                  </div>
                  <dl className="mt-3 space-y-1 text-sm text-gray-700">
                    <div className="flex justify-between gap-2">
                      <dt className="text-gray-500">Plan</dt>
                      <dd>{row.planStatusLabel}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-gray-500">Outcomes</dt>
                      <dd className="text-right">{outcomeSummary(row)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-gray-500">Daily Report</dt>
                      <dd className="text-right">{row.dailyReportLabel}</dd>
                    </div>
                    {row.changeAwarenessLabel && (
                      <div className="flex justify-between gap-2">
                        <dt className="text-gray-500">Changes</dt>
                        <dd>{row.changeAwarenessLabel}</dd>
                      </div>
                    )}
                    {row.supervisorName && (
                      <div className="flex justify-between gap-2">
                        <dt className="text-gray-500">Supervisor</dt>
                        <dd>{row.supervisorName}</dd>
                      </div>
                    )}
                  </dl>
                  {row.attentionReasons.length > 0 && (
                    <p className="mt-2 text-xs text-gray-500">{row.attentionReasons[0]}</p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-sm">
                    <Link
                      href={actionHref(orgSlug, row, primary, workDate)}
                      className="font-medium text-[#698F00] hover:underline"
                    >
                      {actionLabel(primary)}
                    </Link>
                    {row.actions
                      .filter((a) => a !== primary)
                      .slice(0, 2)
                      .map((action) => (
                        <Link
                          key={action}
                          href={actionHref(orgSlug, row, action, workDate)}
                          className="text-gray-600 hover:underline"
                        >
                          {actionLabel(action)}
                        </Link>
                      ))}
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
