'use client';

/* eslint-disable react-hooks/set-state-in-effect */

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { JobActivityFeed } from '@/components/JobActivityFeed';
import { JobWorkspaceShell } from '@/components/JobWorkspaceShell';
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
  cc_site_address_snapshot?: string | null;
  cc_job_number?: string | null;
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
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clientReady, setClientReady] = useState(false);

  useEffect(() => {
    setClientReady(true);
  }, []);

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
  const activeStageName =
    job?.active_stage_id
      ? stages.find((stage) => stage.id === job.active_stage_id)?.name ?? null
      : null;

  if (!clientReady || loading) {
    return (
      <div className="min-h-screen bg-sc-page px-4 py-8 text-sc-text">
        <p className="mx-auto max-w-7xl text-sm text-sc-text-secondary">Loading…</p>
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="min-h-screen bg-sc-page px-4 py-8 text-sc-text">
        <div className="mx-auto max-w-7xl">
          <div className="rounded-xl border border-sc-danger-border bg-sc-danger-tint px-4 py-3 text-sm text-sc-danger">
            {error ?? 'Job not found'}
            <Link
              href={backHref}
              className="mt-3 block text-sm font-medium text-sc-euca hover:text-sc-euca-hover"
            >
              ← Back
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <JobWorkspaceShell
      orgSlug={orgSlug}
      job={job}
      activeStageName={activeStageName}
      isAdmin={isAdmin}
    >
      <JobActivityFeed
        orgSlug={orgSlug}
        jobId={jobId}
        stages={stages.map((stage) => ({ id: stage.id, name: stage.name }))}
        activeStageId={job.active_stage_id ?? null}
        mode={mode}
        initialReportDate={mode === 'capture' ? reportDate : undefined}
        initialStageId={initialStageId}
      />
    </JobWorkspaceShell>
  );
}
