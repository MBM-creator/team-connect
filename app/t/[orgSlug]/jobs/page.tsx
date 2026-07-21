'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { AppBrandMark } from '@/components/AppBrandMark';
import type { CcProject } from '@/lib/cc-client';
import { ccClientDisplayName } from '@/lib/cc-client-display';

interface Job {
  id: string;
  organisation_id: string;
  name: string;
  site_id: string | null;
  created_at: string;
  cc_project_id?: string | null;
  cc_client_id?: string | null;
  cc_project_title_snapshot?: string | null;
  cc_client_name_snapshot?: string | null;
}

const CLIENT_CONNECT_STATUS_ORDER: Record<string, number> = {
  wip: 0,
  deposit_paid: 1,
  prestart_date_set: 2,
  prestart_paid: 3,
  quote_accepted: 4,
};

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
    fetch('/api/cc/projects')
      .then((res) => res.json())
      .then((data: { ok?: boolean; projects?: CcProject[] }) => {
        if (!cancelled && data?.ok && Array.isArray(data.projects)) {
          setCcProjects(data.projects);
        }
      })
      .catch(() => {
        if (!cancelled) setCcProjects([]);
      });

    return () => {
      cancelled = true;
    };
  }, [orgSlug]);

  function normalise(value: string | null | undefined): string {
    return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function ccProjectForJob(job: Job): CcProject | null {
    if (job.cc_project_id) {
      return ccProjects.find((candidate) => candidate.project_id === job.cc_project_id) ?? null;
    }

    const title = normalise(job.cc_project_title_snapshot ?? job.name);
    if (!title) return null;

    const matches = ccProjects.filter((candidate) => normalise(candidate.project_title) === title);
    return matches.length === 1 ? matches[0] : null;
  }

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

  function statusRank(status: string | null | undefined): number {
    return CLIENT_CONNECT_STATUS_ORDER[status ?? ''] ?? 99;
  }

  function compareByDateDesc(a: string, b: string): number {
    const aTime = new Date(a).getTime();
    const bTime = new Date(b).getTime();
    return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
  }

  const visibleJobs = React.useMemo(() => {
    const byKey = new Map<string, Job>();

    for (const job of jobs) {
      if (isTestJob(job)) continue;

      const project = ccProjectForJob(job);
      const projectId = project?.project_id ?? job.cc_project_id ?? null;
      const titleKey = normalise(project?.project_title ?? job.cc_project_title_snapshot ?? job.name);
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
  }, [jobs, ccProjects]);

  const visibleCcProjectIds = React.useMemo(() => {
    return new Set(
      visibleJobs
        .map((job) => ccProjectForJob(job)?.project_id ?? job.cc_project_id ?? null)
        .filter((projectId): projectId is string => Boolean(projectId))
    );
  }, [visibleJobs, ccProjects]);

  const visibleLegacyTitleKeys = React.useMemo(() => {
    return new Set(
      visibleJobs
        .filter((job) => !job.cc_project_id && !ccProjectForJob(job))
        .map((job) => normalise(job.cc_project_title_snapshot ?? job.name))
        .filter(Boolean)
    );
  }, [visibleJobs, ccProjects]);

  const availableCcProjects = React.useMemo(() => {
    return ccProjects.filter((project) => {
      if (isTestProject(project)) return false;
      if (visibleCcProjectIds.has(project.project_id)) return false;
      return !visibleLegacyTitleKeys.has(normalise(project.project_title));
    }).sort((a, b) => {
      const rankDelta = statusRank(a.status) - statusRank(b.status);
      if (rankDelta !== 0) return rankDelta;
      return normalise(a.project_title).localeCompare(normalise(b.project_title));
    });
  }, [ccProjects, visibleCcProjectIds, visibleLegacyTitleKeys]);

  function jobCardLabel(job: Job): { headline: string; address: string | null } {
    const project = ccProjectForJob(job);
    if (project) {
      const name = project.client_name.trim();
      const phone = project.client_contact?.trim();
      return {
        headline: phone ? `${name} — ${phone}` : name,
        address: project.site_address?.trim() || null,
      };
    }

    const snapshotClient = job.cc_client_name_snapshot?.trim();
    return {
      headline: snapshotClient || job.name,
      address: null,
    };
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

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div>
            <AppBrandMark />
            <h1 className="mt-1 text-2xl font-bold text-gray-900">Jobs</h1>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && orgSlug && (
              <>
                <Link
                  href={`/t/${orgSlug}/site-operations`}
                  className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
                >
                  Site Operations
                </Link>
                <Link
                  href={`/t/${orgSlug}/admin`}
                  className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
                >
                  Admin
                </Link>
              </>
            )}
            {orgSlug && (
              <Link
                href={`/t/${orgSlug}/jobs/new`}
                className="rounded-lg bg-[#698F00] px-4 py-2 text-sm font-medium text-white hover:bg-[#5a7d00]"
              >
                New job
              </Link>
            )}
          </div>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-800">
            {error}
          </div>
        )}

        {ccWarning && !error && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            {ccWarning}
          </div>
        )}

        {loading && (
          <p className="text-gray-600">Loading jobs…</p>
        )}

        {!loading && !error && visibleJobs.length === 0 && availableCcProjects.length === 0 && (
          <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">
            No jobs yet.
          </div>
        )}

        {!loading && !error && (visibleJobs.length > 0 || availableCcProjects.length > 0) && (
          <ul className="space-y-3">
            {visibleJobs.map((job) => {
              const label = jobCardLabel(job);
              return (
                <li key={job.id}>
                  <Link
                    href={`/t/${orgSlug}/jobs/${job.id}`}
                    className="block rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition hover:border-[#698F00] hover:shadow"
                  >
                    <p className="font-medium text-gray-900">{label.headline}</p>
                    {label.address && (
                      <p className="mt-1 text-sm text-gray-600">{label.address}</p>
                    )}
                  </Link>
                </li>
              );
            })}
            {availableCcProjects.map((project) => (
              <li key={project.project_id}>
                <button
                  type="button"
                  onClick={() => createFromClientConnect(project)}
                  disabled={!!creatingProjectId}
                  className="block w-full rounded-lg border border-gray-200 bg-white p-4 text-left shadow-sm transition hover:border-[#698F00] hover:shadow disabled:cursor-wait disabled:opacity-70"
                >
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="font-medium text-gray-900">{project.project_title}</span>
                    <span className="text-xs font-medium uppercase text-[#698F00]">
                      {project.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-gray-600">
                    {[ccClientDisplayName(project), project.site_address].filter(Boolean).join(' — ')}
                  </p>
                  {creatingProjectId === project.project_id && (
                    <p className="mt-2 text-xs text-gray-500">Creating job…</p>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
