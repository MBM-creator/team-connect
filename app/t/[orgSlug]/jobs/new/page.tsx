'use client';

import { AppBrandMark } from '@/components/AppBrandMark';
import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import type { CcProject } from '@/lib/cc-client';
import { ccClientDisplayName, ccClientPhone, ccProjectPickerLabel } from '@/lib/cc-client-display';

type CreateMode = 'client-connect' | 'manual';

interface ExistingJob {
  id: string;
  cc_project_id?: string | null;
  cc_quote_id?: string | null;
  cc_job_id?: string | null;
  cc_job_number?: string | null;
}

export default function NewJobPage() {
  const params = useParams();
  const router = useRouter();
  const orgSlug = (params?.orgSlug as string) ?? '';

  const [mode, setMode] = useState<CreateMode>('client-connect');
  const [name, setName] = useState('');
  const [ccProjects, setCcProjects] = useState<CcProject[]>([]);
  const [existingJobs, setExistingJobs] = useState<ExistingJob[]>([]);
  const [selectedCcProjectId, setSelectedCcProjectId] = useState('');
  const [ccLoading, setCcLoading] = useState(false);
  const [ccError, setCcError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgSlug) return;
    let cancelled = false;
    setCcLoading(true);
    setCcError(null);
    fetch(`/api/cc/projects?orgSlug=${encodeURIComponent(orgSlug)}`)
      .then((res) => res.json().then((data) => ({ res, data })))
      .then(({ res, data }: { res: Response; data: { ok?: boolean; projects?: CcProject[]; error?: string; message?: string; ccUnavailable?: boolean; warning?: string } }) => {
        if (cancelled) return;
        if (!res.ok || !data?.ok || !Array.isArray(data.projects) || data.ccUnavailable) {
          setCcProjects([]);
          setCcError(
            typeof data?.warning === 'string'
              ? data.warning
              : typeof data?.message === 'string'
                ? data.message
                : typeof data?.error === 'string'
                  ? data.error
                  : 'Failed to load projects'
          );
          setMode('manual');
          return;
        }
        setCcProjects(data.projects);
        setSelectedCcProjectId((current) => current || data.projects?.[0]?.project_id || '');
      })
      .catch((err) => {
        if (!cancelled) {
          setCcProjects([]);
          setCcError(err instanceof Error ? err.message : 'Failed to load projects');
          setMode('manual');
        }
      })
      .finally(() => {
        if (!cancelled) setCcLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orgSlug]);

  useEffect(() => {
    if (!orgSlug) return;
    let cancelled = false;
    fetch(`/api/jobs?orgSlug=${encodeURIComponent(orgSlug)}`)
      .then((res) => res.json())
      .then((data: { ok?: boolean; jobs?: ExistingJob[] }) => {
        if (!cancelled && data?.ok && Array.isArray(data.jobs)) {
          setExistingJobs(data.jobs);
        }
      })
      .catch(() => {
        if (!cancelled) setExistingJobs([]);
      });
    return () => {
      cancelled = true;
    };
  }, [orgSlug]);

  function projectIdentity(project: CcProject): string {
    if (project.cc_job_id) return `cc_job_id:${project.cc_job_id}`;
    if (project.cc_job_number) return `cc_job_number:${project.cc_job_number}`;
    if (project.quote_id) return `cc_quote_id:${project.quote_id}`;
    return `cc_project_id:${project.project_id}`;
  }

  function jobIdentity(job: ExistingJob): string | null {
    if (job.cc_job_id) return `cc_job_id:${job.cc_job_id}`;
    if (job.cc_job_number) return `cc_job_number:${job.cc_job_number}`;
    if (job.cc_quote_id) return `cc_quote_id:${job.cc_quote_id}`;
    const project = job.cc_project_id
      ? ccProjects.find((candidate) => candidate.project_id === job.cc_project_id) ?? null
      : null;
    if (project) return projectIdentity(project);
    if (job.cc_project_id) return `cc_project_id:${job.cc_project_id}`;
    return null;
  }

  const existingJobIdentities = useMemo(
    () => new Set(existingJobs.map(jobIdentity).filter((identity): identity is string => Boolean(identity))),
    [existingJobs, ccProjects]
  );
  const availableCcProjects = useMemo(
    () => ccProjects.filter((project) => !existingJobIdentities.has(projectIdentity(project))),
    [ccProjects, existingJobIdentities]
  );

  useEffect(() => {
    if (mode !== 'client-connect') return;
    if (availableCcProjects.length === 0) {
      setSelectedCcProjectId('');
      return;
    }
    if (!selectedCcProjectId || !availableCcProjects.some((project) => project.project_id === selectedCcProjectId)) {
      setSelectedCcProjectId(availableCcProjects[0].project_id);
    }
  }, [availableCcProjects, mode, selectedCcProjectId]);

  const selectedProject = selectedCcProjectId
    ? availableCcProjects.find((project) => project.project_id === selectedCcProjectId) ?? null
    : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!orgSlug) {
      setError('Organisation is required');
      return;
    }

    const trimmedName = name.trim();
    const usingCc = mode === 'client-connect';

    if (usingCc && !selectedCcProjectId) {
      setError('Select a client / site');
      return;
    }
    if (usingCc && !selectedProject) {
      setError('That project is already linked to a Team Connect job');
      return;
    }
    if (!usingCc && !trimmedName) {
      setError('Job name is required');
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          usingCc
            ? { orgSlug, ccProjectId: selectedCcProjectId }
            : { orgSlug, name: trimmedName }
        ),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok && data?.ok && data.job?.id) {
        router.push(`/t/${orgSlug}/jobs/${data.job.id}`);
        return;
      }

      setError(typeof data?.message === 'string' ? data.message : 'Failed to create job');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create job');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <Link href={`/t/${orgSlug}/jobs`} className="text-sm text-[#698F00] hover:underline">
          ← Jobs
        </Link>
        <AppBrandMark className="mt-4" />
        <h1 className="mt-2 text-2xl font-bold text-gray-900 mb-6">New job</h1>

        {!orgSlug && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-800">
            Organisation is required.
          </div>
        )}

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-800">
            {error}
          </div>
        )}

        {ccError && (
          <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-sm">
            Projects are unavailable: {ccError}
          </div>
        )}

        {orgSlug && (
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-2 gap-2 rounded-lg border border-gray-200 bg-white p-1 shadow-sm">
              <button
                type="button"
                onClick={() => setMode('client-connect')}
                disabled={availableCcProjects.length === 0}
                className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  mode === 'client-connect'
                    ? 'bg-[#698F00] text-white'
                    : 'text-gray-700 hover:bg-gray-50 disabled:text-gray-400 disabled:hover:bg-white'
                }`}
              >
                From project list
              </button>
              <button
                type="button"
                onClick={() => setMode('manual')}
                className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  mode === 'manual'
                    ? 'bg-[#698F00] text-white'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                Manual
              </button>
            </div>

            {mode === 'client-connect' && (
              <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                <label htmlFor="ccProject" className="block text-sm font-medium text-gray-700 mb-1">
                  Client / site <span className="text-red-500">*</span>
                </label>
                <select
                  id="ccProject"
                  value={selectedCcProjectId}
                  onChange={(e) => setSelectedCcProjectId(e.target.value)}
                  disabled={ccLoading || isSubmitting || availableCcProjects.length === 0}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#698F00] focus:border-transparent bg-white text-gray-900 disabled:bg-gray-100"
                  required
                >
                  {ccLoading && <option value="">Loading projects…</option>}
                  {!ccLoading && availableCcProjects.length === 0 && <option value="">No projects available</option>}
                  {!ccLoading && availableCcProjects.map((project) => (
                    <option key={project.project_id} value={project.project_id}>
                      {ccProjectPickerLabel(project)}
                    </option>
                  ))}
                </select>

                {selectedProject && (
                  <div className="mt-4 space-y-3 text-sm">
                    <div>
                      <p className="font-medium text-gray-900">{ccClientDisplayName(selectedProject)}</p>
                      {ccClientPhone(selectedProject) && (
                        <p className="text-gray-600">{ccClientPhone(selectedProject)}</p>
                      )}
                      {selectedProject.site_address && (
                        <p className="text-gray-600">{selectedProject.site_address}</p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {selectedProject.trades.length > 0 ? (
                        selectedProject.trades.map((trade) => (
                          <span
                            key={trade}
                            className="inline-flex rounded-full border border-[#698F00]/30 bg-[#698F00]/5 px-2 py-1 text-xs font-medium text-[#5a7d00]"
                          >
                            {trade.replace(/_/g, ' ')}
                          </span>
                        ))
                      ) : (
                        <span className="text-gray-500">No trades set</span>
                      )}
                    </div>
                    <p className="text-gray-600">
                      {selectedProject.sections.length} section{selectedProject.sections.length === 1 ? '' : 's'} will be synced into this job.
                    </p>
                  </div>
                )}
              </section>
            )}

            {mode === 'manual' && (
              <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                <label htmlFor="jobName" className="block text-sm font-medium text-gray-700 mb-1">
                  Job name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  id="jobName"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. North Site Build"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#698F00] focus:border-transparent"
                  required={mode === 'manual'}
                  disabled={isSubmitting}
                />
              </section>
            )}

            <button
              type="submit"
              disabled={isSubmitting || (mode === 'client-connect' && (ccLoading || !selectedCcProjectId || !selectedProject))}
              className="w-full bg-[#698F00] text-white py-3 px-6 rounded-lg font-medium hover:bg-[#5a7d00] disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              {isSubmitting ? 'Creating…' : mode === 'client-connect' ? 'Create from project list' : 'Create job'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
