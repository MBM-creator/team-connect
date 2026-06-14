'use client';

/* eslint-disable react-hooks/set-state-in-effect */

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { ClientConnectJobSummary } from '@/components/ClientConnectJobSummary';
import { JobActivityFeed } from '@/components/JobActivityFeed';
import {
  parseJobNotesMode,
  parseJobNotesReportDate,
  validateReturnTo,
} from '@/lib/job-notes-routes';

interface Job {
  id: string;
  name: string;
  active_stage_id?: string | null;
  cc_project_id?: string | null;
  cc_client_id?: string | null;
  cc_project_title_snapshot?: string | null;
  cc_client_name_snapshot?: string | null;
}

interface Stage {
  id: string;
  name: string;
}

export default function JobNotesPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const orgSlug = (params?.orgSlug as string) ?? '';
  const jobId = (params?.jobId as string) ?? '';

  const mode = parseJobNotesMode(searchParams.get('mode'));
  const reportDate = parseJobNotesReportDate(searchParams.get('date'));
  const stageIdFromQuery = searchParams.get('stageId')?.trim() || null;
  const returnTo = useMemo(
    () => validateReturnTo(orgSlug, searchParams.get('returnTo')),
    [orgSlug, searchParams]
  );

  const [job, setJob] = useState<Job | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clientReady, setClientReady] = useState(false);

  useEffect(() => {
    setClientReady(true);
  }, []);

  useEffect(() => {
    if (!orgSlug || !jobId) {
      setError('Job not found');
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      fetch(`/api/jobs/${jobId}?orgSlug=${encodeURIComponent(orgSlug)}`).then((r) =>
        r.json().then((d) => ({ ok: r.ok, d }))
      ),
      fetch(`/api/stages?jobId=${encodeURIComponent(jobId)}&orgSlug=${encodeURIComponent(orgSlug)}`).then((r) =>
        r.json().then((d) => ({ ok: r.ok, d }))
      ),
    ])
      .then(([jobRes, stagesRes]) => {
        if (cancelled) return;
        if (!jobRes.ok || !jobRes.d?.ok || !jobRes.d.job) {
          setError(typeof jobRes.d?.message === 'string' ? jobRes.d.message : 'Failed to load job');
          return;
        }
        setJob(jobRes.d.job as Job);
        setStages(Array.isArray(stagesRes.d?.stages) ? stagesRes.d.stages : []);
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load job');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [orgSlug, jobId]);

  const initialStageId = stageIdFromQuery ?? job?.active_stage_id ?? null;
  const fallbackReturnTo =
    mode === 'capture'
      ? `/t/${orgSlug}/jobs/${jobId}/today`
      : `/t/${orgSlug}/jobs/${jobId}`;
  const backHref = returnTo ?? fallbackReturnTo;

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {(!clientReady || loading) && <p className="text-gray-600">Loading…</p>}

        {clientReady && error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-800">
            {error}
            <Link href={backHref} className="mt-3 block text-sm font-medium text-[#698F00] hover:underline">
              ← Back
            </Link>
          </div>
        )}

        {clientReady && !loading && !error && job && (
          <div className="space-y-6">
            <div>
              <Link href={backHref} className="text-sm text-[#698F00] hover:underline">
                ← Back
              </Link>
              <h2 className="mt-2 text-lg font-semibold text-gray-900">{job.name}</h2>
              <ClientConnectJobSummary
                job={job}
                compact
                className="mt-1"
                emptyText="No Client Connect project linked."
              />
            </div>

            <JobActivityFeed
              orgSlug={orgSlug}
              jobId={jobId}
              stages={stages.map((stage) => ({ id: stage.id, name: stage.name }))}
              activeStageId={job.active_stage_id ?? null}
              mode={mode}
              initialReportDate={mode === 'capture' ? reportDate : undefined}
              initialStageId={initialStageId}
            />
          </div>
        )}
      </div>
    </div>
  );
}
