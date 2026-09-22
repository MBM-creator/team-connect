'use client';

/* eslint-disable react-hooks/set-state-in-effect */

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { DailyPlanPanel } from '@/components/DailyPlanPanel';
import { DailySiteUpdatePanel } from '@/components/DailySiteUpdatePanel';
import { JobNotesEntryCard } from '@/components/JobNotesEntryCard';
import { JobWorkspaceShell } from '@/components/JobWorkspaceShell';
import type { CcProject } from '@/lib/cc-client';
import { todayReportDate } from '@/lib/report-date';

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
  job_id: string;
  name: string;
  cc_section_id?: string | null;
  cc_section_name_snapshot?: string | null;
  cc_section_trade?: string | null;
  checklist_templates?: { name: string } | { name: string }[] | null;
}

export default function TodaysWorkPage() {
  const params = useParams();
  const orgSlug = (params?.orgSlug as string) ?? '';
  const jobId = (params?.jobId as string) ?? '';

  const [job, setJob] = useState<Job | null>(null);
  const [ccProject, setCcProject] = useState<CcProject | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [clientReady, setClientReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    if (!clientReady || loading) return;
    if (typeof window === 'undefined') return;
    if (window.location.hash !== '#daily-site-update') return;
    const el = document.getElementById('daily-site-update');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [clientReady, loading]);

  useEffect(() => {
    if (!orgSlug || !jobId) {
      setError('Job not found');
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setJob(null);
    setCcProject(null);
    setStages([]);

    Promise.all([
      fetch(`/api/jobs?orgSlug=${encodeURIComponent(orgSlug)}&jobId=${encodeURIComponent(jobId)}`)
        .then((res) => res.json().then((data) => ({ res, data }))),
      fetch(`/api/stages?jobId=${encodeURIComponent(jobId)}`)
        .then((res) => res.json().then((data) => ({ res, data }))),
    ])
      .then(([jobsResult, stagesResult]) => {
        if (cancelled) return;
        const { res: jobsRes, data: jobsData } = jobsResult;
        if (!jobsRes.ok || !jobsData?.ok || !Array.isArray(jobsData.jobs)) {
          setError(typeof jobsData?.message === 'string' ? jobsData.message : 'Failed to load job');
          return;
        }
        setJob(jobsData.jobs[0] ?? null);

        const { res: stagesRes, data: stagesData } = stagesResult;
        if (stagesRes.ok && stagesData?.ok && Array.isArray(stagesData.stages)) {
          setStages(stagesData.stages);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load job');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [orgSlug, jobId]);

  const activeStage = job?.active_stage_id
    ? stages.find((stage) => stage.id === job.active_stage_id) ?? null
    : null;

  const detailHref = `/t/${orgSlug}/jobs/${jobId}`;

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
          </div>
        </div>
      </div>
    );
  }

  return (
    <JobWorkspaceShell
      orgSlug={orgSlug}
      job={job}
      project={ccProject}
      activeStageName={activeStage?.name ?? null}
      isAdmin={isAdmin}
    >
      <div className="space-y-6">
        {!job.active_stage_id && (
          <div className="rounded-xl border border-sc-border bg-sc-surface p-4 shadow-[0_1px_2px_rgba(36,41,38,0.04)]">
            <p className="text-sc-text">No active stage set. Set the active stage on the job detail page.</p>
            <Link
              href={detailHref}
              className="mt-3 inline-block text-sm font-medium text-sc-euca hover:text-sc-euca-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sc-euca"
            >
              Go to job detail
            </Link>
          </div>
        )}

        <DailyPlanPanel orgSlug={orgSlug} jobId={jobId} jobName={job.name} />

        <div id="daily-site-update">
          <DailySiteUpdatePanel
            orgSlug={orgSlug}
            jobId={jobId}
            jobName={job.name}
            job={job}
            hideHeaderContext
            hideQaEvidenceWarning
            historyDefaultOpen={false}
            compactTaskMode
            formDefaultOpen={false}
          />
        </div>

        <JobNotesEntryCard
          orgSlug={orgSlug}
          jobId={jobId}
          variant="capture"
          returnTo={`/t/${orgSlug}/jobs/${jobId}/today`}
          reportDate={todayReportDate()}
          stageId={job.active_stage_id ?? null}
        />
      </div>
    </JobWorkspaceShell>
  );
}
