'use client';

import React, { useCallback, useMemo, useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { AppBrandMark } from '@/components/AppBrandMark';
import { LifecycleStatusChip } from '@/components/LifecycleStatusChip';
import type { CcProject } from '@/lib/cc-client';
import {
  ccClientDisplayName,
  ccClientPhone,
  formatAustralianMobileDisplay,
  siteLocationForList,
} from '@/lib/cc-client-display';
import {
  buildJobListRowModel,
  clearJobsListFilters,
  filterJobsByTab,
  hasActiveJobsListFilters,
  jobMatchesSearch,
  jobMatchesStatusFilter,
  normaliseSearchText,
  projectMatchesSearch,
  statusOptionsForTab,
  statusRank,
  type JobsListJob,
  type JobsListTab,
} from '@/lib/jobs-list';

type Job = JobsListJob;

function normalise(value: string | null | undefined): string {
  return normaliseSearchText(value);
}

function JobRowMeta({ items }: { items: Array<string | null | undefined> }) {
  const parts = items.map((item) => item?.trim()).filter((item): item is string => Boolean(item));
  if (parts.length === 0) return null;
  return (
    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] leading-snug text-sc-text-secondary">
      {parts.map((part, index) => (
        <span key={`${part}-${index}`} className="inline-flex min-w-0 items-center gap-x-1.5">
          {index > 0 && (
            <span className="text-sc-text-secondary/45" aria-hidden="true">
              ·
            </span>
          )}
          <span className="min-w-0 break-words">{part}</span>
        </span>
      ))}
    </p>
  );
}

function RowChevron() {
  return (
    <span className="ml-1 shrink-0 text-sc-text-secondary/70" aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M7.5 4.5L13 10L7.5 15.5"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function SearchIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sc-text-secondary"
      aria-hidden="true"
    >
      <circle cx="8.5" cy="8.5" r="5.75" stroke="currentColor" strokeWidth="1.75" />
      <path d="M13 13L17 17" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

const CONTROL_FOCUS =
  'focus:border-sc-euca focus:outline-none focus:ring-2 focus:ring-sc-euca/30';
const FOCUS_VISIBLE =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sc-euca';
const TRANSITION = 'motion-safe:transition motion-safe:duration-150 motion-reduce:transition-none';

const ROW_TARGET_CLASS = [
  'flex min-h-[44px] w-full items-center gap-3 rounded-xl border border-sc-border bg-sc-surface px-4 py-3 text-left shadow-[0_1px_2px_rgba(36,41,38,0.04)]',
  TRANSITION,
  'hover:bg-sc-surface-2 hover:border-sc-border-strong',
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sc-euca',
].join(' ');

export default function JobsListPage() {
  const params = useParams();
  const router = useRouter();
  const orgSlug = (params?.orgSlug as string) ?? '';

  const [jobs, setJobs] = useState<Job[]>([]);
  const [ccProjects, setCcProjects] = useState<CcProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ccWarning, setCcWarning] = useState<string | null>(null);
  const [creatingProjectId, setCreatingProjectId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [tab, setTab] = useState<JobsListTab>('active');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    if (!orgSlug) return;
    fetch(`/api/auth/me?orgSlug=${encodeURIComponent(orgSlug)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data?.ok && data?.staff?.role === 'admin') setIsAdmin(true);
      })
      .catch(() => setIsAdmin(false));
  }, [orgSlug]);

  useEffect(() => {
    if (!orgSlug) {
      return;
    }

    let cancelled = false;

    fetch(`/api/jobs?orgSlug=${encodeURIComponent(orgSlug)}`)
      .then((res) => res.json().then((data) => ({ res, data })))
      .then(({ res, data }) => {
        if (cancelled) return;
        if (!res.ok) {
          setError(typeof data?.message === 'string' ? data.message : 'Failed to load jobs');
          return;
        }
        if (data?.ok && Array.isArray(data.jobs)) {
          setJobs(data.jobs);
          setError(null);
          setCcWarning(typeof data.warning === 'string' ? data.warning : null);
        } else {
          setError('Invalid response');
          setCcWarning(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load jobs');
          setCcWarning(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [orgSlug]);

  useEffect(() => {
    if (!orgSlug) return;

    let cancelled = false;
    fetch(`/api/cc/projects?orgSlug=${encodeURIComponent(orgSlug)}`)
      .then((res) => res.json())
      .then((data: { ok?: boolean; projects?: CcProject[]; ccUnavailable?: boolean }) => {
        if (!cancelled && data?.ok && Array.isArray(data.projects) && !data.ccUnavailable) {
          setCcProjects(data.projects);
        } else if (!cancelled) {
          setCcProjects([]);
        }
      })
      .catch(() => {
        if (!cancelled) setCcProjects([]);
      });

    return () => {
      cancelled = true;
    };
  }, [orgSlug]);

  // Reset status filter when switching tabs — options are tab-scoped.
  useEffect(() => {
    setStatusFilter('');
  }, [tab]);

  const ccProjectForJob = useCallback(
    (job: Job): CcProject | null => {
      if (job.cc_project_id) {
        return ccProjects.find((candidate) => candidate.project_id === job.cc_project_id) ?? null;
      }

      const title = normalise(job.cc_project_title_snapshot ?? job.name);
      if (!title) return null;

      const matches = ccProjects.filter((candidate) => normalise(candidate.project_title) === title);
      return matches.length === 1 ? matches[0] : null;
    },
    [ccProjects]
  );

  function jobPriority(job: Job): number {
    if (job.cc_project_id && job.cc_client_name_snapshot) return 4;
    if (job.cc_project_id) return 3;
    if (job.cc_project_title_snapshot || job.cc_client_name_snapshot) return 2;
    return 1;
  }

  function isTestJob(job: Job): boolean {
    const name = normalise(job.name);
    const title = normalise(job.cc_project_title_snapshot);
    const client = normalise(job.cc_client_name_snapshot);
    return /^test(?:\s|$)/.test(name) || /^test(?:\s|$)/.test(title) || /^test client/.test(client);
  }

  function isTestProject(project: CcProject): boolean {
    return /^test(?:\s|$)/.test(normalise(project.project_title)) || /^test client/.test(normalise(project.client_name));
  }

  function compareByDateDesc(a: string, b: string): number {
    const aTime = new Date(a).getTime();
    const bTime = new Date(b).getTime();
    return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
  }

  const visibleJobs = useMemo(() => {
    const byKey = new Map<string, Job>();

    for (const job of jobs) {
      if (isTestJob(job)) continue;

      const project = ccProjectForJob(job);
      const projectId = project?.project_id ?? job.cc_project_id ?? null;
      const titleKey = normalise(project?.project_title ?? job.cc_project_title_snapshot ?? job.name);
      // Dedup by CC project / title only — never by client name or phone.
      // Multiple jobs for the same client with different project IDs all remain.
      const key = projectId ? `cc:${projectId}` : titleKey ? `title:${titleKey}` : `job:${job.id}`;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, job);
        continue;
      }

      const existingPriority = jobPriority(existing);
      const nextPriority = jobPriority(job);
      if (
        nextPriority > existingPriority ||
        (nextPriority === existingPriority && new Date(job.created_at).getTime() > new Date(existing.created_at).getTime())
      ) {
        byKey.set(key, job);
      }
    }

    return Array.from(byKey.values()).sort((a, b) => {
      const aProject = ccProjectForJob(a);
      const bProject = ccProjectForJob(b);
      const rankDelta = statusRank(aProject?.status) - statusRank(bProject?.status);
      if (rankDelta !== 0) return rankDelta;

      const dateDelta = compareByDateDesc(a.created_at, b.created_at);
      if (dateDelta !== 0) return dateDelta;

      const aTitle = normalise(aProject?.project_title ?? a.cc_project_title_snapshot ?? a.name);
      const bTitle = normalise(bProject?.project_title ?? b.cc_project_title_snapshot ?? b.name);
      return aTitle.localeCompare(bTitle);
    });
  }, [jobs, ccProjectForJob]);

  const visibleCcProjectIds = useMemo(() => {
    return new Set(
      visibleJobs
        .map((job) => ccProjectForJob(job)?.project_id ?? job.cc_project_id ?? null)
        .filter((projectId): projectId is string => Boolean(projectId))
    );
  }, [visibleJobs, ccProjectForJob]);

  const visibleLegacyTitleKeys = useMemo(() => {
    return new Set(
      visibleJobs
        .filter((job) => !job.cc_project_id && !ccProjectForJob(job))
        .map((job) => normalise(job.cc_project_title_snapshot ?? job.name))
        .filter(Boolean)
    );
  }, [visibleJobs, ccProjectForJob]);

  const availableCcProjects = useMemo(() => {
    return ccProjects
      .filter((project) => {
        if (isTestProject(project)) return false;
        if (visibleCcProjectIds.has(project.project_id)) return false;
        return !visibleLegacyTitleKeys.has(normalise(project.project_title));
      })
      .sort((a, b) => {
        const rankDelta = statusRank(a.status) - statusRank(b.status);
        if (rankDelta !== 0) return rankDelta;
        return normalise(a.project_title).localeCompare(normalise(b.project_title));
      });
  }, [ccProjects, visibleCcProjectIds, visibleLegacyTitleKeys]);

  const tabJobs = useMemo(() => filterJobsByTab(visibleJobs, tab), [visibleJobs, tab]);

  // Unlinked CC projects only appear on the Active tab (they are not completed jobs).
  const tabProjects = useMemo(() => (tab === 'active' ? availableCcProjects : []), [tab, availableCcProjects]);

  const statusOptions = useMemo(() => {
    const statuses = [
      ...tabJobs.map((job) => ccProjectForJob(job)?.status),
      ...tabProjects.map((project) => project.status),
    ];
    return statusOptionsForTab(statuses);
  }, [tabJobs, tabProjects, ccProjectForJob]);

  const filteredJobs = useMemo(() => {
    return tabJobs.filter((job) => {
      const project = ccProjectForJob(job);
      if (!jobMatchesSearch(job, searchQuery, project)) return false;
      return jobMatchesStatusFilter(project?.status ?? null, statusFilter);
    });
  }, [tabJobs, searchQuery, statusFilter, ccProjectForJob]);

  const filteredProjects = useMemo(() => {
    return tabProjects.filter((project) => {
      if (!projectMatchesSearch(project, searchQuery)) return false;
      return jobMatchesStatusFilter(project.status, statusFilter);
    });
  }, [tabProjects, searchQuery, statusFilter]);

  const filtersActive = hasActiveJobsListFilters(searchQuery, statusFilter);
  const hasAnyInTab = tabJobs.length > 0 || tabProjects.length > 0;
  const hasVisibleResults = filteredJobs.length > 0 || filteredProjects.length > 0;

  function clearFilters() {
    const cleared = clearJobsListFilters();
    setSearchQuery(cleared.searchQuery);
    setStatusFilter(cleared.statusFilter);
  }

  async function createFromClientConnect(project: CcProject) {
    if (!orgSlug || creatingProjectId) return;
    setError(null);
    setCreatingProjectId(project.project_id);

    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgSlug, ccProjectId: project.project_id }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data?.ok && data.job?.id) {
        router.push(`/t/${orgSlug}/jobs/${data.job.id}`);
        return;
      }

      setError(typeof data?.message === 'string' ? data.message : 'Failed to create job from project list');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create job from project list');
    } finally {
      setCreatingProjectId(null);
    }
  }

  const tabButtonClass = (value: JobsListTab) =>
    [
      'min-h-[36px] rounded-md px-3.5 py-1.5 text-sm font-medium',
      TRANSITION,
      FOCUS_VISIBLE,
      tab === value
        ? 'bg-sc-euca-tint text-sc-euca-hover shadow-sm'
        : 'text-sc-text-secondary hover:text-sc-text',
    ].join(' ');

  return (
    <div className="min-h-screen bg-sc-page text-sc-text">
      {/* Compact app header */}
      <header className="border-b border-sc-border bg-sc-surface">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:h-[68px] sm:px-6">
          <AppBrandMark variant="full" />
          {isAdmin && orgSlug && (
            <nav className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1" aria-label="Admin navigation">
              <Link
                href={`/t/${orgSlug}/site-operations`}
                className={`text-sm font-semibold text-sc-charcoal underline decoration-sc-euca decoration-2 underline-offset-4 ${FOCUS_VISIBLE}`}
              >
                Site Operations
              </Link>
              <Link
                href={`/t/${orgSlug}/admin`}
                className={`text-sm font-medium text-sc-text-secondary hover:text-sc-text ${TRANSITION} ${FOCUS_VISIBLE}`}
              >
                Admin
              </Link>
            </nav>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pb-10 pt-5 sm:px-6 sm:pt-6">
        {/* Title + primary action */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-[32px] font-semibold leading-tight tracking-tight text-sc-charcoal">Jobs</h1>
          {orgSlug && (
            <Link
              href={`/t/${orgSlug}/jobs/new`}
              className={[
                'inline-flex h-11 shrink-0 items-center justify-center rounded-lg bg-sc-euca px-4 text-sm font-medium text-white',
                TRANSITION,
                'hover:bg-sc-euca-hover active:bg-sc-euca-hover',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sc-euca',
              ].join(' ')}
            >
              New job
            </Link>
          )}
        </div>

        {/* Active / Completed tabs */}
        <div
          className="mb-4 inline-flex rounded-lg border border-sc-border bg-sc-surface-2 p-0.5"
          role="tablist"
          aria-label="Job status"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'active'}
            className={tabButtonClass('active')}
            onClick={() => setTab('active')}
          >
            Active
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'completed'}
            className={tabButtonClass('completed')}
            onClick={() => setTab('completed')}
          >
            Completed
          </button>
        </div>

        {/* Search + status filter */}
        <div className="mb-5 flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <label className="sr-only" htmlFor="jobs-search">
            Search jobs
          </label>
          <div className="relative min-w-0 flex-1">
            <SearchIcon />
            <input
              id="jobs-search"
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search client, project, suburb…"
              className={`h-11 w-full rounded-lg border border-sc-border bg-sc-surface py-2 pl-10 pr-3 text-sm text-sc-text placeholder:text-sc-text-secondary/70 ${CONTROL_FOCUS}`}
            />
          </div>
          <label className="sr-only" htmlFor="jobs-status-filter">
            Filter by status
          </label>
          <select
            id="jobs-status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className={`h-11 w-full rounded-lg border border-sc-border bg-sc-surface px-3 py-2 text-sm text-sc-text sm:w-56 sm:shrink-0 ${CONTROL_FOCUS}`}
          >
            <option value="">All statuses</option>
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {error && (
          <div
            className="mb-4 rounded-xl border border-sc-danger-border bg-sc-danger-tint px-4 py-3 text-sm text-sc-danger"
            role="alert"
          >
            {error}
          </div>
        )}

        {ccWarning && !error && (
          <div className="mb-4 rounded-xl border border-sc-warn-border bg-sc-warn-tint px-4 py-3 text-sm text-sc-warn">
            {ccWarning}
          </div>
        )}

        {loading && <p className="text-sm text-sc-text-secondary">Loading jobs…</p>}

        {!loading && !error && !hasAnyInTab && (
          <div className="rounded-xl border border-sc-border bg-sc-surface px-4 py-6 text-sm text-sc-text-secondary">
            {tab === 'active' ? 'No active jobs yet.' : 'No completed jobs.'}
          </div>
        )}

        {!loading && !error && hasAnyInTab && !hasVisibleResults && (
          <div className="rounded-xl border border-sc-border bg-sc-surface px-4 py-6 text-sm text-sc-text-secondary">
            <p>No jobs match your search.</p>
            {filtersActive && (
              <button
                type="button"
                onClick={clearFilters}
                className={`mt-3 text-sm font-medium text-sc-euca underline-offset-2 hover:underline ${FOCUS_VISIBLE}`}
              >
                Clear filters
              </button>
            )}
          </div>
        )}

        {!loading && !error && hasVisibleResults && (
          <ul className="flex flex-col gap-2.5">
            {filteredJobs.map((job) => {
              const row = buildJobListRowModel(job, orgSlug, ccProjectForJob(job));
              return (
                <li key={job.id}>
                  <Link href={row.href} className={ROW_TARGET_CLASS}>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="truncate text-[17px] font-semibold leading-snug text-sc-charcoal">
                          {row.clientName}
                        </p>
                        <LifecycleStatusChip status={row.status} />
                      </div>
                      {row.projectTitle && (
                        <p className="mt-0.5 truncate text-[14px] leading-snug text-sc-text">
                          {row.projectTitle}
                        </p>
                      )}
                      <JobRowMeta
                        items={[row.location, formatAustralianMobileDisplay(row.phone) ?? row.phone]}
                      />
                    </div>
                    <RowChevron />
                  </Link>
                </li>
              );
            })}
            {filteredProjects.map((project) => {
              const phone = ccClientPhone(project);
              const location = siteLocationForList(project.site_address);
              const clientName = ccClientDisplayName(project);
              const title =
                project.project_title?.trim() &&
                normalise(project.project_title) !== normalise(clientName)
                  ? project.project_title.trim()
                  : null;
              return (
                <li key={project.project_id}>
                  <button
                    type="button"
                    onClick={() => createFromClientConnect(project)}
                    disabled={!!creatingProjectId}
                    className={`${ROW_TARGET_CLASS} disabled:cursor-wait disabled:opacity-70`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="truncate text-[17px] font-semibold leading-snug text-sc-charcoal">
                          {clientName}
                        </p>
                        <LifecycleStatusChip status={project.status} />
                      </div>
                      {title && (
                        <p className="mt-0.5 truncate text-[14px] leading-snug text-sc-text">{title}</p>
                      )}
                      <JobRowMeta
                        items={[location, formatAustralianMobileDisplay(phone) ?? phone]}
                      />
                      {creatingProjectId === project.project_id && (
                        <p className="mt-0.5 text-xs text-sc-text-secondary">Creating job…</p>
                      )}
                    </div>
                    <RowChevron />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
