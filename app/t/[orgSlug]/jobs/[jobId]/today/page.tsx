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

interface QaRun {
  id: string;
  job_id: string;
  stage_id: string | null;
  status: string;
  setup_version: number | null;
  setup?: unknown;
  started_at: string;
  updated_at?: string | null;
  completed_at?: string | null;
  supervisor_final_approved_at?: string | null;
  qa_type?: string | null;
}

function templateName(stage: Stage | null): string {
  const template = stage?.checklist_templates;
  if (Array.isArray(template)) return template[0]?.name ?? '';
  return template?.name ?? '';
}

function isPavingStage(stage: Stage | null, ccProject: CcProject | null): boolean {
  const trade = (stage?.cc_section_trade ?? '').toLowerCase().replace(/_/g, ' ');
  const name = (stage?.name ?? '').toLowerCase();
  const template = templateName(stage).toLowerCase();
  const trades = new Set(ccProject?.trades ?? []);
  return trade.includes('paving') || name.includes('paving') || template.includes('paving') || trades.has('paving');
}

function isIrrigationStage(stage: Stage | null, ccProject: CcProject | null): boolean {
  const trade = (stage?.cc_section_trade ?? '').toLowerCase().replace(/_/g, ' ');
  const name = (stage?.name ?? '').toLowerCase();
  const template = templateName(stage).toLowerCase();
  const trades = new Set(ccProject?.trades ?? []);
  return trade.includes('irrigation') || name.includes('irrigation') || template.includes('irrigation') || trades.has('irrigation');
}

function isFencingStage(stage: Stage | null, ccProject: CcProject | null): boolean {
  const trade = (stage?.cc_section_trade ?? '').toLowerCase().replace(/_/g, ' ');
  const name = (stage?.name ?? '').toLowerCase();
  const template = templateName(stage).toLowerCase();
  const trades = new Set(ccProject?.trades ?? []);
  return (
    trade.includes('fencing') ||
    name.includes('fencing') ||
    template.includes('fencing') ||
    template.includes('fence') ||
    trades.has('fencing')
  );
}

function runHref(orgSlug: string, jobId: string, run: QaRun, activeStage: Stage | null, ccProject: CcProject | null): string {
  if (run.qa_type === 'irrigation') {
    return `/t/${orgSlug}/jobs/${jobId}/qa/irrigation/${run.id}`;
  }
  if (run.qa_type === 'fencing') {
    return `/t/${orgSlug}/jobs/${jobId}/qa/fencing/${run.id}`;
  }
  if (run.setup_version === 2 && isPavingStage(activeStage, ccProject)) {
    return `/t/${orgSlug}/jobs/${jobId}/qa/paving/${run.id}`;
  }
  return `/t/${orgSlug}/jobs/${jobId}/qa`;
}

export default function TodaysWorkPage() {
  const params = useParams();
  const orgSlug = (params?.orgSlug as string) ?? '';
  const jobId = (params?.jobId as string) ?? '';

  const [job, setJob] = useState<Job | null>(null);
  const [ccProject, setCcProject] = useState<CcProject | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [runs, setRuns] = useState<QaRun[]>([]);
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
    setRuns([]);

    Promise.all([
      fetch(`/api/jobs/${jobId}/qa/runs?orgSlug=${encodeURIComponent(orgSlug)}`)
        .then((res) => res.json().then((data) => ({ res, data }))),
      fetch(`/api/stages?jobId=${encodeURIComponent(jobId)}`)
        .then((res) => res.json().then((data) => ({ res, data }))),
    ])
      .then(([runsResult, stagesResult]) => {
        if (cancelled) return;
        const { res: runsRes, data: runsData } = runsResult;
        if (!runsRes.ok || !runsData?.ok) {
          setError(typeof runsData?.message === 'string' ? runsData.message : 'Failed to load QA status');
          return;
        }
        setJob(runsData.job && typeof runsData.job === 'object' ? runsData.job : null);
        setCcProject(runsData.ccProject && typeof runsData.ccProject === 'object' ? runsData.ccProject : null);
        setRuns(Array.isArray(runsData.runs) ? runsData.runs : []);
        if (runsData.viewerRole === 'admin') setIsAdmin(true);

        const { res: stagesRes, data: stagesData } = stagesResult;
        if (stagesRes.ok && stagesData?.ok && Array.isArray(stagesData.stages)) {
          setStages(stagesData.stages);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load QA status');
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

  const currentRuns = runs.filter((run) => run.qa_type === 'irrigation' || run.qa_type === 'fencing' || run.setup_version === 2);
  const activeRuns = currentRuns.filter((run) => run.status === 'active');
  const activeRun =
    activeRuns.find((run) => run.qa_type === 'irrigation' && isIrrigationStage(activeStage, ccProject)) ??
    activeRuns.find((run) => run.qa_type === 'fencing' && isFencingStage(activeStage, ccProject)) ??
    activeRuns.find((run) => (run.qa_type ?? 'paving') === 'paving' && isPavingStage(activeStage, ccProject)) ??
    activeRuns[0] ??
    null;
  const latestApprovedRun =
    currentRuns.find((run) => run.status === 'completed' && run.supervisor_final_approved_at) ?? null;
  const qaHubHref = `/t/${orgSlug}/jobs/${jobId}/qa`;
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

        {job.active_stage_id && activeRun && (
          <div className="rounded-xl border border-sc-border bg-sc-surface p-5 shadow-[0_1px_2px_rgba(36,41,38,0.04)]">
            <p className="text-sm font-medium text-sc-warn">QA in progress</p>
            <p className="mt-1 text-sc-text">
              Continue the active QA run for today&apos;s work.
            </p>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Link
                href={runHref(orgSlug, jobId, activeRun, activeStage, ccProject)}
                className="block w-full rounded-lg bg-sc-euca px-4 py-3 text-center text-sm font-medium text-white transition-colors hover:bg-sc-euca-hover sm:w-auto"
              >
                Continue QA run →
              </Link>
              {activeRuns.length > 1 && (
                <Link
                  href={qaHubHref}
                  className="block w-full rounded-lg border border-sc-border px-4 py-3 text-center text-sm font-medium text-sc-euca transition-colors hover:bg-sc-euca-tint sm:w-auto"
                >
                  View all QA
                </Link>
              )}
            </div>
          </div>
        )}

        {job.active_stage_id && !activeRun && latestApprovedRun && (
          <div className="rounded-xl border border-sc-border bg-sc-surface p-5 shadow-[0_1px_2px_rgba(36,41,38,0.04)]">
            <p className="text-sm font-medium text-sc-euca">Latest QA approved</p>
            <p className="mt-1 text-sc-text">
              There is no active QA run. Supervisors can choose the next required QA checklist from the QA hub.
            </p>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Link
                href={runHref(orgSlug, jobId, latestApprovedRun, activeStage, ccProject)}
                className="block w-full rounded-lg bg-sc-euca px-4 py-3 text-center text-sm font-medium text-white transition-colors hover:bg-sc-euca-hover sm:w-auto"
              >
                View latest QA
              </Link>
              <Link
                href={qaHubHref}
                className="block w-full rounded-lg border border-sc-border px-4 py-3 text-center text-sm font-medium text-sc-euca transition-colors hover:bg-sc-euca-tint sm:w-auto"
              >
                Open QA hub
              </Link>
            </div>
          </div>
        )}

        {job.active_stage_id && !activeRun && !latestApprovedRun && (
          <div className="rounded-xl border border-sc-border bg-sc-surface p-5 shadow-[0_1px_2px_rgba(36,41,38,0.04)]">
            <p className="text-sm font-medium text-sc-charcoal">No active QA run</p>
            <p className="mt-1 text-sc-text">
              No QA checklist has been started for this stage.
            </p>
            <Link
              href={qaHubHref}
              className="mt-4 block w-full rounded-lg bg-sc-euca px-4 py-3 text-center text-sm font-medium text-white transition-colors hover:bg-sc-euca-hover sm:inline-block sm:w-auto"
            >
              Open QA hub
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
