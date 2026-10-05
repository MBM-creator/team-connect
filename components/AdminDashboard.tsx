'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatAustralianDateTime } from '@/lib/australian-date';
import type {
  ActivityFeedItem,
  AdminDashboardData,
  DashboardDateRange,
  DashboardStatusFilter,
  JobAttentionRow,
  SupervisorActivityRow,
  SupervisorActivityStatus,
} from '@/lib/admin-dashboard/types';

const QA_TYPES = [
  { value: 'all', label: 'All QA types' },
  { value: 'paving', label: 'Paving' },
  { value: 'irrigation', label: 'Irrigation' },
  { value: 'fencing', label: 'Fencing' },
  { value: 'sign_off', label: 'Sign-off' },
] as const;

const STATUS_FILTERS: Array<{ value: DashboardStatusFilter; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'needs_review', label: 'Needs review' },
  { value: 'missing_evidence', label: 'Missing evidence' },
  { value: 'complete', label: 'Complete' },
];

const RANGES: Array<{ value: DashboardDateRange; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
];

function statusBadge(status: SupervisorActivityStatus): string {
  switch (status) {
    case 'good':
      return 'bg-[#698F00]/10 text-[#4f6f00] border-[#698F00]/20';
    case 'behind':
      return 'bg-amber-50 text-amber-800 border-amber-200';
    case 'needs_review':
      return 'bg-red-50 text-red-800 border-red-200';
    default:
      return 'bg-gray-100 text-gray-700 border-gray-200';
  }
}

function formatWhen(iso: string | null): string {
  if (!iso) return '—';
  return formatAustralianDateTime(iso, '—');
}

function Card({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-gray-900">{value}</p>
    </div>
  );
}

export function AdminDashboard({ orgSlug }: { orgSlug: string }) {
  const [qaType, setQaType] = useState('all');
  const [supervisorId, setSupervisorId] = useState('all');
  const [status, setStatus] = useState<DashboardStatusFilter>('all');
  const [range, setRange] = useState<DashboardDateRange>('7d');
  const [search, setSearch] = useState('');
  const [searchDraft, setSearchDraft] = useState('');

  const [data, setData] = useState<AdminDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams({ orgSlug });
    params.set('qaType', qaType);
    params.set('supervisorId', supervisorId);
    params.set('status', status);
    params.set('range', range);
    if (search.trim()) params.set('search', search.trim());
    return params.toString();
  }, [orgSlug, qaType, supervisorId, status, range, search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/dashboard?${query}`);
      const json = await res.json();
      if (!res.ok) {
        setError(typeof json?.message === 'string' ? json.message : 'Failed to load dashboard');
        return;
      }
      setData(json as AdminDashboardData);
    } catch {
      setError('Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    load();
  }, [load]);

  const supervisorsForFilter = data?.supervisors ?? [];

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-gray-600">QA type</span>
            <select
              className="w-full rounded border border-gray-300 px-3 py-2"
              value={qaType}
              onChange={(e) => setQaType(e.target.value)}
            >
              {QA_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-gray-600">Supervisor</span>
            <select
              className="w-full rounded border border-gray-300 px-3 py-2"
              value={supervisorId}
              onChange={(e) => setSupervisorId(e.target.value)}
            >
              <option value="all">All supervisors</option>
              {supervisorsForFilter.map((s) => (
                <option key={s.staffId} value={s.staffId}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-gray-600">Status</span>
            <select
              className="w-full rounded border border-gray-300 px-3 py-2"
              value={status}
              onChange={(e) => setStatus(e.target.value as DashboardStatusFilter)}
            >
              {STATUS_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-gray-600">Date range</span>
            <select
              className="w-full rounded border border-gray-300 px-3 py-2"
              value={range}
              onChange={(e) => setRange(e.target.value as DashboardDateRange)}
            >
              {RANGES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <form
            className="text-sm"
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(searchDraft);
            }}
          >
            <span className="mb-1 block text-xs text-gray-600">Search job/client/project</span>
            <div className="flex gap-2">
              <input
                className="w-full rounded border border-gray-300 px-3 py-2"
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                placeholder="Search…"
              />
              <button type="submit" className="rounded bg-[#698F00] px-3 py-2 text-white">
                Go
              </button>
            </div>
          </form>
        </div>
        <p className="mt-3 text-xs text-gray-500">
          Default scope: active QA runs plus activity from the selected date range.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
      )}

      {loading && <p className="text-gray-600">Loading dashboard…</p>}

      {!loading && data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
            <Card label="Active QA runs" value={data.cards.activeQaRuns} />
            <Card label="Jobs needing attention" value={data.cards.jobsNeedingAttention} />
            <Card label="Unresolved QA issues" value={data.cards.unresolvedQaIssues} />
            <Card label="Sections awaiting review" value={data.cards.sectionsAwaitingReview} />
            <Card label="Jobs missing evidence" value={data.cards.jobsMissingEvidence} />
            <Card label="Completed runs this week" value={data.cards.completedQaRunsThisWeek} />
            <Card label="Supervisors active today" value={data.cards.supervisorsActiveToday} />
          </div>

          <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 px-4 py-3">
              <h2 className="text-lg font-semibold text-gray-900">{data.supervisorActivityLabel}</h2>
              <p className="text-xs text-gray-500">
                Activity-based metrics only — not full assignment compliance.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-3">Supervisor</th>
                    <th className="px-4 py-3">Runs today</th>
                    <th className="px-4 py-3">Runs in range</th>
                    <th className="px-4 py-3">Sections submitted</th>
                    <th className="px-4 py-3">Sections cleared</th>
                    <th className="px-4 py-3">Open issues</th>
                    <th className="px-4 py-3">Photos</th>
                    <th className="px-4 py-3">Last activity</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.supervisors.map((row: SupervisorActivityRow) => (
                    <tr key={row.staffId} className="border-t border-gray-100">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{row.name}</div>
                        <div className="text-xs text-gray-500">{row.email}</div>
                      </td>
                      <td className="px-4 py-3">{row.qaRunsTouchedToday}</td>
                      <td className="px-4 py-3">{row.qaRunsTouchedInRange}</td>
                      <td className="px-4 py-3">{row.sectionsSubmittedInRange}</td>
                      <td className="px-4 py-3">{row.sectionsClearedInRange}</td>
                      <td className="px-4 py-3">{row.openIssuesCount}</td>
                      <td className="px-4 py-3">{row.photoCountInRange}</td>
                      <td className="px-4 py-3">{formatWhen(row.lastQaActivityAt)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${statusBadge(row.status)}`}>
                          {row.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {data.supervisors.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-4 py-6 text-gray-500">
                        No supervisor activity in this range.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 px-4 py-3">
              <h2 className="text-lg font-semibold text-gray-900">Jobs needing attention</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-3">Job</th>
                    <th className="px-4 py-3">QA type</th>
                    <th className="px-4 py-3">Stage</th>
                    <th className="px-4 py-3">Urgency</th>
                    <th className="px-4 py-3">Section</th>
                    <th className="px-4 py-3">Issues</th>
                    <th className="px-4 py-3">Missing evidence</th>
                    <th className="px-4 py-3">Last activity</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.jobsNeedingAttention.map((row: JobAttentionRow, index) => (
                    <tr key={`${row.jobId}-${row.runId ?? 'none'}-${index}`} className="border-t border-gray-100 align-top">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{row.projectTitle ?? row.jobName}</div>
                        {row.clientName && <div className="text-xs text-gray-500">{row.clientName}</div>}
                      </td>
                      <td className="px-4 py-3">{row.qaTypeLabel}</td>
                      <td className="px-4 py-3">{row.activeStageName ?? '—'}</td>
                      <td className="px-4 py-3">
                        <span className="text-xs font-medium text-gray-800">{row.urgencyLabel}</span>
                      </td>
                      <td className="px-4 py-3">
                        {row.currentSectionTitle ?? '—'}
                        {row.runStatus && (
                          <div className="text-xs text-gray-500">Run: {row.runStatus}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">{row.issueCount}</td>
                      <td className="px-4 py-3">{row.missingEvidenceCount}</td>
                      <td className="px-4 py-3">{formatWhen(row.lastActivityAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <Link href={row.links.job} className="text-[#698F00] hover:underline">
                            Job
                          </Link>
                          {row.links.qaRun && (
                            <Link href={row.links.qaRun} className="text-[#698F00] hover:underline">
                              QA run
                            </Link>
                          )}
                          {row.links.evidence && (
                            <Link href={row.links.evidence} className="text-[#698F00] hover:underline">
                              Evidence
                            </Link>
                          )}
                          {row.links.supervisor && (
                            <Link href={row.links.supervisor} className="text-[#698F00] hover:underline">
                              Issues
                            </Link>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {data.jobsNeedingAttention.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-4 py-6 text-gray-500">
                        No jobs need attention for the current filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 px-4 py-3">
              <h2 className="text-lg font-semibold text-gray-900">Recent QA activity</h2>
            </div>
            <ul className="divide-y divide-gray-100">
              {data.activityFeed.map((item: ActivityFeedItem) => (
                <li key={item.id} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <span className="font-medium text-gray-900">{item.label}</span>
                      <span className="text-gray-600">
                        {' '}
                        · {item.jobName}
                        {item.sectionTitle ? ` · ${item.sectionTitle}` : ''}
                      </span>
                      {item.actorName && (
                        <span className="block text-xs text-gray-500">By {item.actorName}</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500">{formatWhen(item.timestamp)}</div>
                  </div>
                  <Link href={item.href} className="mt-1 inline-block text-[#698F00] hover:underline">
                    Open
                  </Link>
                </li>
              ))}
              {data.activityFeed.length === 0 && (
                <li className="px-4 py-6 text-sm text-gray-500">No recent activity in this range.</li>
              )}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
