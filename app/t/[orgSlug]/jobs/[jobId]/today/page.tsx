'use client';

/* eslint-disable react-hooks/set-state-in-effect */

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ClientConnectJobSummary } from '@/components/ClientConnectJobSummary';
import { DailySiteUpdatePanel } from '@/components/DailySiteUpdatePanel';
import { JobActivityFeed } from '@/components/JobActivityFeed';
import type { CcProject } from '@/lib/cc-client';
import type { StaffRole } from '@/lib/daily-site-update-shared';

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
  return trade.includes('fencing') || name.includes('fencing') || template.includes('fencing') || trades.has('fencing');
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
  const [viewerRole, setViewerRole] = useState<StaffRole>('field');
  const [clientReady, setClientReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        if (runsData.viewerRole === 'field' || runsData.viewerRole === 'supervisor' || runsData.viewerRole === 'admin') {
          setViewerRole(runsData.viewerRole);
        }

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

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {(!clientReady || loading) && <p className="text-gray-600">Loading…</p>}

        {clientReady && error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-800">
            {error}
          </div>
        )}

        {clientReady && !loading && !error && job && (
          <div className="space-y-6">
            <div>
              <Link href={detailHref} className="text-sm text-[#698F00] hover:underline">
                ← Full job detail
              </Link>
              <h1 className="mt-2 text-2xl font-bold text-gray-900">{job.name}</h1>
              <ClientConnectJobSummary
                job={job}
                compact
                className="mt-1"
                emptyText="No Client Connect project linked."
              />
              {activeStage && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className="text-sm font-medium text-[#698F00]">{activeStage.name}</span>
                  {activeStage.cc_section_trade && (
                    <span className="text-xs font-medium text-gray-700 bg-gray-100 px-2 py-0.5 rounded">
                      {activeStage.cc_section_trade.replace(/_/g, ' ')}
                    </span>
                  )}
                </div>
              )}
            </div>

            {!job.active_stage_id && (
              <div className="p-4 bg-white border border-gray-200 rounded-lg shadow-sm">
                <p className="text-gray-700">No active stage set. Set the active stage on the job detail page.</p>
                <Link href={detailHref} className="mt-3 inline-block text-sm font-medium text-[#698F00] hover:underline">
                  Go to job detail
                </Link>
              </div>
            )}

            {job.active_stage_id && activeRun && (
              <div className="p-5 bg-white border border-gray-200 rounded-lg shadow-sm">
                <p className="text-sm font-medium text-amber-800">QA in progress</p>
                <p className="mt-1 text-gray-700">
                  Continue the active QA run for today&apos;s work.
                </p>
                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                  <Link
                    href={runHref(orgSlug, jobId, activeRun, activeStage, ccProject)}
                    className="block w-full rounded-lg bg-[#698F00] px-4 py-3 text-center text-sm font-medium text-white transition-colors hover:bg-[#5a7d00] sm:w-auto"
                  >
                    Continue QA run →
                  </Link>
                  {activeRuns.length > 1 && (
                    <Link
                      href={qaHubHref}
                      className="block w-full rounded-lg border border-[#698F00]/30 px-4 py-3 text-center text-sm font-medium text-[#698F00] transition-colors hover:bg-[#698F00]/5 sm:w-auto"
                    >
                      View all QA
                    </Link>
                  )}
                </div>
              </div>
            )}

            {job.active_stage_id && !activeRun && latestApprovedRun && (
              <div className="p-5 bg-white border border-gray-200 rounded-lg shadow-sm">
                <p className="text-sm font-medium text-[#698F00]">Latest QA approved</p>
                <p className="mt-1 text-gray-700">
                  There is no active QA run. Supervisors can choose the next required QA checklist from the QA hub.
                </p>
                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                  <Link
                    href={runHref(orgSlug, jobId, latestApprovedRun, activeStage, ccProject)}
                    className="block w-full rounded-lg bg-[#698F00] px-4 py-3 text-center text-sm font-medium text-white transition-colors hover:bg-[#5a7d00] sm:w-auto"
                  >
                    View latest QA
                  </Link>
                  <Link
                    href={qaHubHref}
                    className="block w-full rounded-lg border border-[#698F00]/30 px-4 py-3 text-center text-sm font-medium text-[#698F00] transition-colors hover:bg-[#698F00]/5 sm:w-auto"
                  >
                    Open QA hub
                  </Link>
                </div>
              </div>
            )}

            {job.active_stage_id && !activeRun && !latestApprovedRun && (
              <div className="p-5 bg-white border border-gray-200 rounded-lg shadow-sm">
                <p className="text-sm font-medium text-gray-900">No active QA run</p>
                <p className="mt-1 text-gray-700">
                  No QA checklist has been started for this stage.
                </p>
                <Link
                  href={qaHubHref}
                  className="mt-4 block w-full rounded-lg bg-[#698F00] px-4 py-3 text-center text-sm font-medium text-white transition-colors hover:bg-[#5a7d00] sm:inline-block sm:w-auto"
                >
                  Open QA hub
                </Link>
              </div>
            )}

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

            <JobActivityFeed
              orgSlug={orgSlug}
              jobId={jobId}
              stages={stages.map((stage) => ({ id: stage.id, name: stage.name }))}
              activeStageId={job.active_stage_id ?? null}
              compact
              defaultCollapsed
            />
          </div>
        )}
      </div>
    </div>
  );
}
