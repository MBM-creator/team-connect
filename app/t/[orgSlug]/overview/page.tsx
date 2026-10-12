'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { STAGE_LABELS_ENABLED } from '@/lib/feature-flags';

interface JobOverviewEntry {
  id: string;
  name: string;
  activeStageName: string | null;
  qaRunStatus: 'active' | 'completed' | 'none';
  qaRunId: string | null;
  qaRunType: 'paving' | 'irrigation' | 'fencing' | null;
  qaRunApprovedAt: string | null;
}

function qaBadge(job: JobOverviewEntry): { label: string; className: string } {
  if (job.qaRunStatus === 'completed' && job.qaRunApprovedAt) {
    return { label: 'Approved', className: 'bg-[#698F00]/10 text-[#4f6f00] border-[#698F00]/20' };
  }
  if (job.qaRunStatus === 'active') {
    return { label: 'In progress', className: 'bg-amber-50 text-amber-800 border-amber-200' };
  }
  return { label: 'Not started', className: 'bg-gray-100 text-gray-700 border-gray-200' };
}

function qaHref(orgSlug: string, job: JobOverviewEntry): string {
  if (job.qaRunType === 'paving' && job.qaRunId) {
    return `/t/${orgSlug}/jobs/${job.id}/qa/paving/${job.qaRunId}`;
  }
  if (job.qaRunType === 'irrigation' && job.qaRunId) {
    return `/t/${orgSlug}/jobs/${job.id}/qa/irrigation/${job.qaRunId}`;
  }
  if (job.qaRunType === 'fencing' && job.qaRunId) {
    return `/t/${orgSlug}/jobs/${job.id}/qa/fencing/${job.qaRunId}`;
  }
  return `/t/${orgSlug}/jobs/${job.id}/qa`;
}

export default function OverviewPage() {
  const params = useParams();
  const orgSlug = (params?.orgSlug as string) ?? '';

  const [jobs, setJobs] = useState<JobOverviewEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgSlug) {
      return;
    }

    let cancelled = false;

    fetch(`/api/jobs/overview?orgSlug=${encodeURIComponent(orgSlug)}`)
      .then((res) => res.json().then((data) => ({ res, data })))
      .then(({ res, data }: { res: Response; data: { ok?: boolean; jobs?: JobOverviewEntry[]; message?: string } }) => {
        if (cancelled) return;
        if (!res.ok) {
          setError(typeof data?.message === 'string' ? data.message : 'Failed to load overview');
          return;
        }
        if (data?.ok && Array.isArray(data.jobs)) {
          setJobs(data.jobs);
          setError(null);
        } else {
          setError('Invalid response');
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load overview');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [orgSlug]);

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Jobs overview</h1>

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-800">
            {error}
          </div>
        )}

        {loading && (
          <p className="text-gray-600">Loading…</p>
        )}

        {!loading && !error && jobs.length === 0 && (
          <p className="text-gray-600">No jobs yet.</p>
        )}

        {!loading && !error && jobs.length > 0 && (
          <ul className="space-y-3">
            {jobs.map((job) => (
              <li
                key={job.id}
                className="p-4 bg-white border border-gray-200 rounded-lg shadow-sm"
              >
                <p className="font-medium text-gray-900">{job.name}</p>
                {STAGE_LABELS_ENABLED && (
                  <p className="mt-1 text-sm text-gray-600">
                    {job.activeStageName ?? 'No active stage'}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  {(() => {
                    const badge = qaBadge(job);
                    return (
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${badge.className}`}>
                        {badge.label}
                      </span>
                    );
                  })()}
                  <Link href={qaHref(orgSlug, job)} className="text-sm font-medium text-[#698F00] hover:underline">
                    {job.qaRunId ? 'Open QA run' : 'Open QA hub'}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
