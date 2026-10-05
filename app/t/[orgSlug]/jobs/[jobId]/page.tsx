'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { DailyPlanPanel } from '@/components/DailyPlanPanel';
import { JobBriefMediaPanel } from '@/components/JobBriefMediaPanel';
import { JobNotesEntryCard } from '@/components/JobNotesEntryCard';
import { JobWorkspaceShell } from '@/components/JobWorkspaceShell';
import type { CcProject } from '@/lib/cc-client';
import { formatAustralianDate } from '@/lib/australian-date';
import { clientFacingDetails } from '@/lib/cc-client-display';
import { compressImageForUpload } from '@/lib/client-image-compression';
import { JOB_STAGES_SECTION_ENABLED, QA_ENABLED } from '@/lib/feature-flags';
import {
  MAX_PRE_COMMENCEMENT_PHOTOS,
  OVERVIEW_QA_TEMPLATE_HELP,
  canMoveStage,
  overviewStageChipClass,
  photoUploadCountLabel,
  reorderStagesById,
  resolveOverviewStageState,
  selectFilesForPhotoUpload,
  shouldShowSupervisorSignOff,
  stageHasExplicitFinishedQa,
  stageMoveAriaLabel,
  validateNewStageName,
} from '@/lib/job-overview-display';

const CONTROL_FOCUS =
  'focus:border-sc-euca focus:outline-none focus:ring-2 focus:ring-sc-euca/30';
const FOCUS_VISIBLE =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sc-euca';
const TRANSITION = 'motion-safe:transition motion-safe:duration-150 motion-reduce:transition-none';

interface Job {
  id: string;
  organisation_id: string;
  name: string;
  site_id: string | null;
  created_at: string;
  active_stage_id?: string | null;
  cc_project_id?: string | null;
  cc_quote_id?: string | null;
  cc_job_id?: string | null;
  cc_job_number?: string | null;
  cc_client_id?: string | null;
  cc_project_title_snapshot?: string | null;
  cc_client_name_snapshot?: string | null;
  cc_site_address_snapshot?: string | null;
}

interface ChecklistTemplateItem {
  id: string;
  item_type: string;
  label: string;
  sort_order: number;
}

interface Stage {
  id: string;
  job_id: string;
  name: string;
  sort_order: number;
  created_at: string;
  checklist_template_id?: string | null;
  cc_project_id?: string | null;
  cc_section_id?: string | null;
  cc_section_name_snapshot?: string | null;
  cc_section_trade?: string | null;
  checklist_templates?: { name: string; checklist_template_items?: ChecklistTemplateItem[] } | null;
}

interface ChecklistTemplate {
  id: string;
  name: string;
}

interface PreCommencementPhoto {
  id: string;
  storage_path: string;
  created_at: string;
  url: string;
}

interface QaRun {
  id: string;
  stage_id?: string | null;
  status: string;
  qa_type?: string | null;
  setup_version: number | null;
  started_at: string;
  completed_at?: string | null;
  supervisor_final_approved_at?: string | null;
}

/**
 * Detect a mismatch between stage name / CC trade and the selected QA template.
 * Returns a human-readable warning string, or null when no mismatch is detected.
 */
function getTemplateMismatchWarning(stage: Stage): string | null {
  const templateName = (stage.checklist_templates?.name ?? '').toLowerCase();
  if (!templateName) return null;

  const stageName = stage.name.toLowerCase();
  const ccTrade = (stage.cc_section_trade ?? '').toLowerCase().replace(/_/g, ' ');

  const isPavingContext = stageName.includes('paving') || ccTrade.includes('paving');
  const isIrrigationContext = stageName.includes('irrigation') || ccTrade.includes('irrigation');
  const isFencingContext = stageName.includes('fence') || stageName.includes('fencing') || ccTrade.includes('fencing');
  const isPavingTemplate = templateName.includes('paving');
  const isIrrigationTemplate = templateName.includes('irrigation');
  const isFencingTemplate = templateName.includes('fencing');

  if ((isIrrigationContext || isFencingContext) && isPavingTemplate) {
    return `Stage/template mismatch: this stage is labelled "${stage.name}" but is using the Paving QA template.`;
  }
  if ((isPavingContext || isFencingContext) && isIrrigationTemplate) {
    return `Stage/template mismatch: this stage is labelled "${stage.name}" but is using the Irrigation QA template.`;
  }
  if ((isPavingContext || isIrrigationContext) && isFencingTemplate) {
    return `Stage/template mismatch: this stage is labelled "${stage.name}" but is using the Fencing QA template.`;
  }
  return null;
}

function qaRunType(run: QaRun): 'paving' | 'irrigation' | 'fencing' {
  if (run.qa_type === 'irrigation') return 'irrigation';
  if (run.qa_type === 'fencing') return 'fencing';
  return 'paving';
}

function stageQaHref(
  orgSlug: string,
  jobId: string,
  stageId: string,
  type: 'paving' | 'irrigation' | 'fencing',
  qaRuns: QaRun[]
): string {
  const activeRun = qaRuns.find((run) => run.status === 'active' && qaRunType(run) === type);
  if (activeRun) {
    return `/t/${orgSlug}/jobs/${jobId}/qa/${type}/${activeRun.id}`;
  }
  return `/t/${orgSlug}/jobs/${jobId}/qa/${type}/new?stageId=${encodeURIComponent(stageId)}`;
}

function stageSignOffHref(
  orgSlug: string,
  jobId: string,
  stageId: string,
  qaRuns: QaRun[]
): string {
  const activeRun = qaRuns.find((run) => run.status === 'active' && run.qa_type === 'sign_off');
  if (activeRun) {
    return `/t/${orgSlug}/jobs/${jobId}/qa/sign-off/${activeRun.id}`;
  }
  return `/t/${orgSlug}/jobs/${jobId}/qa/sign-off/new?stageId=${encodeURIComponent(stageId)}`;
}

export default function JobDetailPage() {
  const params = useParams();
  const orgSlug = (params?.orgSlug as string) ?? '';
  const jobId = (params?.jobId as string) ?? '';

  const [job, setJob] = useState<Job | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [photos, setPhotos] = useState<PreCommencementPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [photosError, setPhotosError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [photoIdRemoving, setPhotoIdRemoving] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [stageName, setStageName] = useState('');
  const [isSubmittingStage, setIsSubmittingStage] = useState(false);
  const [stageError, setStageError] = useState<string | null>(null);
  const [stageIdSettingActive, setStageIdSettingActive] = useState<string | null>(null);
  const [stageIdMoving, setStageIdMoving] = useState<string | null>(null);
  const [activeStageError, setActiveStageError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [stageIdUpdatingTemplate, setStageIdUpdatingTemplate] = useState<string | null>(null);
  const [templateUpdateError, setTemplateUpdateError] = useState<string | null>(null);
  const [qaRuns, setQaRuns] = useState<QaRun[]>([]);
  const [qaRunIncompleteById, setQaRunIncompleteById] = useState<Record<string, boolean>>({});
  const [qaRunsError, setQaRunsError] = useState<string | null>(null);

  const [ccProjects, setCcProjects] = useState<CcProject[]>([]);
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
    if (!orgSlug || !jobId) {
      setError('Job not found');
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setJob(null);
    setStages([]);

    fetch(`/api/jobs?orgSlug=${encodeURIComponent(orgSlug)}&jobId=${encodeURIComponent(jobId)}`)
      .then((res) => res.json().then((data) => ({ res, data })))
      .then(({ res, data }) => {
        if (cancelled) return;
        if (!res.ok) {
          setError(typeof data?.message === 'string' ? data.message : 'Failed to load job');
          return;
        }
        if (!data?.ok || !Array.isArray(data.jobs)) {
          setError('Invalid response');
          return;
        }
        const found = data.jobs[0];
        if (!found) {
          setError('Job not found');
          return;
        }
        setJob(found);

        if (!JOB_STAGES_SECTION_ENABLED) return undefined;
        return fetch(`/api/stages?jobId=${encodeURIComponent(found.id)}`);
      })
      .then((stagesRes) => {
        if (cancelled || stagesRes === undefined) return undefined;
        return stagesRes.json().then((stagesData: { ok?: boolean; stages?: Stage[]; message?: string }) => ({ stagesRes, stagesData }));
      })
      .then((next) => {
        if (cancelled || next === undefined) return;
        const { stagesRes, stagesData } = next;
        if (!stagesRes.ok) {
          setError(typeof stagesData?.message === 'string' ? stagesData.message : 'Failed to load stages');
          return;
        }
        if (stagesData?.ok && Array.isArray(stagesData.stages)) {
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

  // Fetch pre-commencement photos when job is available
  useEffect(() => {
    if (!job || !orgSlug) return;
    let cancelled = false;
    setPhotosLoading(true);
    setPhotosError(null);
    fetch(`/api/jobs/${job.id}/photos?orgSlug=${encodeURIComponent(orgSlug)}`)
      .then((res) => res.json())
      .then((data: { ok?: boolean; photos?: PreCommencementPhoto[]; message?: string }) => {
        if (cancelled) return;
        if (!data?.ok || !Array.isArray(data.photos)) {
          setPhotosError(typeof data?.message === 'string' ? data.message : 'Failed to load photos');
          return;
        }
        setPhotos(data.photos);
      })
      .catch((err) => {
        if (!cancelled) {
          setPhotosError(err instanceof Error ? err.message : 'Failed to load photos');
        }
      })
      .finally(() => {
        if (!cancelled) setPhotosLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [job, orgSlug]);

  // Fetch Client Connect projects when job is available (for client phone / address)
  useEffect(() => {
    if (!job || !orgSlug) return;
    let cancelled = false;
    fetch(
      `/api/cc/projects?orgSlug=${encodeURIComponent(orgSlug)}&jobId=${encodeURIComponent(job.id)}`
    )
      .then((res) => res.json().then((data) => ({ res, data })))
      .then(({ res, data }: { res: Response; data: { ok?: boolean; projects?: CcProject[]; error?: string } }) => {
        if (cancelled) return;
        if (!res.ok || !data?.ok || !Array.isArray(data.projects)) {
          setCcProjects([]);
          return;
        }
        // Server returns only the authorised linked project (0–1 records).
        setCcProjects(data.projects);
      })
      .catch(() => {
        if (!cancelled) setCcProjects([]);
      });
    return () => {
      cancelled = true;
    };
  }, [job, orgSlug]);

  // Fetch checklist templates for org (for stage template selector)
  useEffect(() => {
    if (!QA_ENABLED) return;
    if (!orgSlug || !job) return;
    let cancelled = false;
    setTemplatesLoading(true);
    setTemplatesError(null);
    fetch(`/api/checklist-templates?orgSlug=${encodeURIComponent(orgSlug)}`)
      .then((res) => res.json().then((data) => ({ res, data })))
      .then(({ res, data }) => {
        if (cancelled) return;
        if (!res.ok) {
          setTemplatesError(typeof data?.message === 'string' ? data.message : 'Failed to load templates');
          return;
        }
        if (data?.ok && Array.isArray(data.templates)) {
          setTemplates(data.templates.map((t: { id: string; name: string }) => ({ id: t.id, name: t.name })));
        } else {
          setTemplatesError('Failed to load templates');
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setTemplatesError(err instanceof Error ? err.message : 'Failed to load templates');
        }
      })
      .finally(() => {
        if (!cancelled) setTemplatesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orgSlug, job]);

  useEffect(() => {
    if (!QA_ENABLED) return;
    if (!job?.id || !orgSlug) {
      setQaRuns([]);
      setQaRunIncompleteById({});
      setQaRunsError(null);
      return;
    }
    let cancelled = false;
    setQaRunsError(null);
    Promise.all([
      fetch(`/api/jobs/${job.id}/qa/runs?orgSlug=${encodeURIComponent(orgSlug)}`).then((res) =>
        res.json().then((data) => ({ res, data }))
      ),
      fetch(`/api/jobs/${job.id}/qa/summary?orgSlug=${encodeURIComponent(orgSlug)}`).then((res) =>
        res.json().then((data) => ({ res, data }))
      ),
    ])
      .then(([runsResult, summaryResult]) => {
        if (cancelled) return;
        const { res, data } = runsResult;
        if (!res.ok || !data?.ok || !Array.isArray(data.runs)) {
          setQaRuns([]);
          setQaRunIncompleteById({});
          setQaRunsError(typeof data?.message === 'string' ? data.message : 'QA status unavailable');
          return;
        }
        setQaRuns(data.runs);

        const incompleteById: Record<string, boolean> = {};
        if (summaryResult.res.ok && summaryResult.data?.ok && Array.isArray(summaryResult.data.activeRuns)) {
          for (const run of summaryResult.data.activeRuns as { id: string; incompleteEvidence?: boolean }[]) {
            incompleteById[run.id] = run.incompleteEvidence !== false;
          }
        }
        setQaRunIncompleteById(incompleteById);
      })
      .catch(() => {
        if (!cancelled) {
          setQaRuns([]);
          setQaRunIncompleteById({});
          setQaRunsError('QA status unavailable');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [job?.id, orgSlug]);

  async function refetchPhotos() {
    if (!orgSlug || !job?.id) return;
    try {
      const res = await fetch(`/api/jobs/${job.id}/photos?orgSlug=${encodeURIComponent(orgSlug)}`);
      const data = await res.json();
      if (res.ok && data?.ok && Array.isArray(data.photos)) {
        setPhotos(data.photos);
        setPhotosError(null);
      }
    } catch {
      // Keep existing photos on refetch failure
    }
  }

  async function refetchStages() {
    if (!JOB_STAGES_SECTION_ENABLED) return;
    if (!job?.id) return;
    try {
      const res = await fetch(`/api/stages?jobId=${encodeURIComponent(job.id)}`);
      const data = await res.json();
      if (res.ok && data?.ok && Array.isArray(data.stages)) {
        setStages(data.stages);
      }
    } catch {
      // Keep existing stages on refetch failure
    }
  }

  async function setActiveStage(stageId: string) {
    if (!JOB_STAGES_SECTION_ENABLED) return;
    setActiveStageError(null);
    setStageIdSettingActive(stageId);
    try {
      const res = await fetch(
        `/api/jobs/${job?.id ?? jobId}?orgSlug=${encodeURIComponent(orgSlug)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ activeStageId: stageId }),
        }
      );
      const data = await res.json();
      if (res.ok && data?.ok && data.job) {
        setJob(data.job);
      } else {
        setActiveStageError(typeof data?.message === 'string' ? data.message : 'Failed to set active stage');
      }
    } catch {
      setActiveStageError('Failed to set active stage');
    } finally {
      setStageIdSettingActive(null);
    }
  }

  async function setStageTemplate(stageId: string, checklistTemplateId: string | null) {
    if (!JOB_STAGES_SECTION_ENABLED) return;
    setTemplateUpdateError(null);
    setStageIdUpdatingTemplate(stageId);
    try {
      const res = await fetch(
        `/api/stages/${stageId}?orgSlug=${encodeURIComponent(orgSlug)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ checklistTemplateId }),
        }
      );
      const data = await res.json();
      if (res.ok && data?.ok && data?.stage) {
        setStages((prev) =>
          prev.map((s) => (s.id === stageId ? { ...s, ...data.stage } : s))
        );
      } else {
        setTemplateUpdateError(typeof data?.message === 'string' ? data.message : 'Failed to update template');
      }
    } catch {
      setTemplateUpdateError('Failed to update template');
    } finally {
      setStageIdUpdatingTemplate(null);
    }
  }

  async function moveStage(stageId: string, direction: 'up' | 'down') {
    if (!JOB_STAGES_SECTION_ENABLED) return;
    if (!orgSlug || stageIdMoving) return;
    const reorderedStages = reorderStagesById(stages, stageId, direction);
    if (!reorderedStages) return;

    const fromIndex = stages.findIndex((stage) => stage.id === stageId);
    const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
    const movingStage = stages[fromIndex];
    const swappedStage = stages[toIndex];
    if (!movingStage || !swappedStage) return;

    setActiveStageError(null);
    setStageIdMoving(stageId);
    setStages(reorderedStages);

    try {
      const updates = [movingStage.id, swappedStage.id].map((id) => {
        const next = reorderedStages.find((stage) => stage.id === id);
        return fetch(`/api/stages/${id}?orgSlug=${encodeURIComponent(orgSlug)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sortOrder: next?.sort_order ?? 0 }),
        });
      });
      const responses = await Promise.all(updates);
      const failed = responses.find((res) => !res.ok);
      if (failed) {
        const data = await failed.json().catch(() => null);
        throw new Error(typeof data?.message === 'string' ? data.message : 'Failed to move stage');
      }
      await refetchStages();
    } catch (err) {
      setActiveStageError(err instanceof Error ? err.message : 'Failed to move stage');
      await refetchStages();
    } finally {
      setStageIdMoving(null);
    }
  }

  async function handleAddStage(e: React.FormEvent) {
    e.preventDefault();
    if (!JOB_STAGES_SECTION_ENABLED) return;
    const nameError = validateNewStageName(stageName);
    if (nameError) {
      setStageError(nameError);
      return;
    }
    const trimmed = stageName.trim();
    setStageError(null);
    setIsSubmittingStage(true);
    try {
      const res = await fetch('/api/stages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, name: trimmed }),
      });
      const data = await res.json();
      if (res.ok && data?.ok) {
        await refetchStages();
        setStageName('');
      } else {
        setStageError(typeof data?.message === 'string' ? data.message : 'Failed to add stage');
      }
    } catch {
      setStageError('Failed to add stage');
    } finally {
      setIsSubmittingStage(false);
    }
  }

  function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const { toUpload, error } = selectFilesForPhotoUpload(photos.length, files);
    if (error || toUpload.length === 0) {
      setPhotosError(error ?? `Maximum ${MAX_PRE_COMMENCEMENT_PHOTOS} photos allowed`);
      if (photoInputRef.current) photoInputRef.current.value = '';
      return;
    }
    setPhotosError(null);
    setIsUploading(true);
    (async () => {
      let lastError: string | null = null;
      for (const file of toUpload) {
        if (!(file instanceof File) || file.size === 0) continue;
        const formData = new FormData();
        try {
          const uploadFile = await compressImageForUpload(file);
          formData.append('file', uploadFile);
          const res = await fetch(`/api/jobs/${job?.id ?? jobId}/photos?orgSlug=${encodeURIComponent(orgSlug)}`, {
            method: 'POST',
            body: formData,
          });
          if (res.status === 413) {
            lastError = 'Photo is too large to upload. Retake at lower resolution or choose a smaller image.';
            continue;
          }
          const data = await res.json();
          if (res.ok && data?.ok) {
            await refetchPhotos();
          } else {
            lastError = typeof data?.message === 'string' ? data.message : 'Upload failed';
          }
        } catch {
          lastError = 'Upload failed';
        }
      }
      if (lastError) setPhotosError(lastError);
      setIsUploading(false);
      if (photoInputRef.current) photoInputRef.current.value = '';
    })();
  }

  async function handleRemovePhoto(photo: PreCommencementPhoto) {
    if (!window.confirm('Remove this photo?')) return;
    setPhotosError(null);
    setPhotoIdRemoving(photo.id);
    try {
      const res = await fetch(
        `/api/jobs/${job?.id ?? jobId}/photos?photoId=${encodeURIComponent(photo.id)}&orgSlug=${encodeURIComponent(orgSlug)}`,
        { method: 'DELETE' }
      );
      const data = await res.json();
      if (res.ok && data?.ok) {
        await refetchPhotos();
      } else {
        setPhotosError(typeof data?.message === 'string' ? data.message : 'Failed to remove photo');
      }
    } catch {
      setPhotosError('Failed to remove photo');
    } finally {
      setPhotoIdRemoving(null);
    }
  }

  function formatDate(iso: string): string {
    return formatAustralianDate(iso);
  }

  function normaliseProjectMatch(value: string | null | undefined): string {
    return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  const linkedCcProject =
    (job?.cc_project_id
      ? ccProjects.find((candidate) => candidate.project_id === job.cc_project_id) ?? null
      : null) ??
    (() => {
      if (!job) return null;
      const title = normaliseProjectMatch(job.cc_project_title_snapshot ?? job.name);
      if (!title) return null;
      const matches = ccProjects.filter(
        (candidate) => normaliseProjectMatch(candidate.project_title) === title
      );
      return matches.length === 1 ? matches[0] : null;
    })();

  const clientDetails = job
    ? clientFacingDetails({
        project: linkedCcProject,
        clientNameSnapshot: job.cc_client_name_snapshot,
        projectTitleSnapshot: job.cc_project_title_snapshot,
        siteAddressSnapshot: job.cc_site_address_snapshot,
        jobName: job.name,
      })
    : null;

  const currentQaRuns = qaRuns.filter((run) => run.qa_type === 'irrigation' || run.qa_type === 'fencing' || run.qa_type === 'sign_off' || run.setup_version === 2);
  const activeQaRun = currentQaRuns.find((run) => run.status === 'active') ?? null;
  const approvedQaRun =
    currentQaRuns.find((run) => run.status === 'completed' && run.supervisor_final_approved_at) ?? null;
  const qaStatusLabel = qaRunsError
    ? 'QA status unavailable'
    : activeQaRun
      ? 'QA in progress'
      : approvedQaRun
        ? 'QA complete'
        : 'No active QA run';
  const qaStatusClass = qaRunsError
    ? 'text-sc-warn'
    : activeQaRun
      ? 'text-sc-warn'
      : approvedQaRun
        ? 'text-sc-euca'
        : 'text-sc-text-secondary';

  const activeStageName =
    job?.active_stage_id
      ? stages.find((stage) => stage.id === job.active_stage_id)?.name ?? null
      : null;

  if (loading) {
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
          <div className="mb-4 rounded-xl border border-sc-danger-border bg-sc-danger-tint px-4 py-3 text-sm text-sc-danger">
            {error ?? 'Job not found'}
          </div>
          <Link
            href={`/t/${orgSlug}/jobs`}
            className="text-sm font-medium text-sc-euca hover:text-sc-euca-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sc-euca"
          >
            ← Back to jobs
          </Link>
        </div>
      </div>
    );
  }

  return (
    <JobWorkspaceShell
      orgSlug={orgSlug}
      job={job}
      project={linkedCcProject}
      activeStageName={activeStageName}
      isAdmin={isAdmin}
      afterSummary={<JobBriefMediaPanel orgSlug={orgSlug} jobId={job.id} />}
    >
            <div className="mb-6">
              <DailyPlanPanel
                orgSlug={orgSlug}
                jobId={job.id}
                jobName={clientDetails?.name ?? job.name}
                highlightOnJobHome
              />
            </div>

            {QA_ENABLED && job.active_stage_id && (
              <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-sc-border bg-sc-surface px-3 py-2 text-sm text-sc-text-secondary">
                <span className={qaStatusClass}>{qaStatusLabel}</span>
                <Link
                  href={`/t/${orgSlug}/jobs/${jobId}/today`}
                  className="font-medium text-sc-euca hover:text-sc-euca-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sc-euca"
                >
                  Open Today
                </Link>
              </div>
            )}

            <section className="mt-8" aria-labelledby="pre-commencement-photos-heading">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h2
                  id="pre-commencement-photos-heading"
                  className="text-lg font-semibold text-sc-charcoal"
                >
                  Pre-commencement photos
                </h2>
                <p className="text-sm text-sc-text-secondary" aria-live="polite">
                  {photoUploadCountLabel(photos.length)}
                </p>
              </div>

              {photosLoading && (
                <p className="text-sm text-sc-text-secondary">Loading photos…</p>
              )}
              {!photosLoading && photosError && (
                <div
                  className="mb-3 rounded-xl border border-sc-danger-border bg-sc-danger-tint px-4 py-3 text-sm text-sc-danger"
                  role="alert"
                >
                  {photosError}
                </div>
              )}
              {!photosLoading && photos.length > 0 && (
                <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {photos.map((photo) => (
                    <div key={photo.id} className="group relative min-w-0">
                      <img
                        src={photo.url}
                        alt="Pre-commencement photo"
                        className="aspect-square w-full rounded-lg border border-sc-border bg-sc-surface-2 object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => handleRemovePhoto(photo)}
                        disabled={photoIdRemoving === photo.id}
                        className={`absolute top-2 right-2 flex h-9 w-9 items-center justify-center rounded-full border border-sc-danger-border bg-sc-danger text-sm font-medium text-white opacity-100 sm:opacity-0 sm:group-hover:opacity-100 ${TRANSITION} disabled:opacity-100 ${FOCUS_VISIBLE}`}
                        aria-label="Remove photo"
                      >
                        {photoIdRemoving === photo.id ? (
                          <span className="text-xs">…</span>
                        ) : (
                          '×'
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {!photosLoading && photos.length < MAX_PRE_COMMENCEMENT_PHOTOS && (
                <div className="rounded-xl border border-dashed border-sc-border-strong bg-sc-surface px-4 py-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-sc-text">Add site photos before work starts</p>
                      <p className="mt-0.5 text-sm text-sc-text-secondary" id="pre-commencement-photo-help">
                        Images only. Up to {MAX_PRE_COMMENCEMENT_PHOTOS} photos.
                      </p>
                    </div>
                    <label
                      htmlFor="pre-commencement-photo-input"
                      className={`inline-flex h-11 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-sc-euca px-4 text-sm font-medium text-white hover:bg-sc-euca-hover has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-sc-euca ${TRANSITION}`}
                    >
                      <span>{isUploading ? 'Uploading…' : 'Add photos'}</span>
                      <input
                        id="pre-commencement-photo-input"
                        ref={photoInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={handlePhotoSelect}
                        disabled={isUploading}
                        aria-describedby="pre-commencement-photo-help"
                        className="sr-only"
                      />
                    </label>
                  </div>
                </div>
              )}
              {!photosLoading && photos.length >= MAX_PRE_COMMENCEMENT_PHOTOS && (
                <p className="text-sm text-sc-text-secondary">Maximum photos reached.</p>
              )}
            </section>

            {JOB_STAGES_SECTION_ENABLED && (
              <section className="mt-8" aria-labelledby="stages-heading">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h2 id="stages-heading" className="text-lg font-semibold text-sc-charcoal">
                  Stages
                </h2>
                <p className="text-sm text-sc-text-secondary">
                  {stages.length === 1 ? '1 stage' : `${stages.length} stages`}
                </p>
              </div>

              {stageError && (
                <div
                  className="mb-3 rounded-xl border border-sc-danger-border bg-sc-danger-tint px-4 py-3 text-sm text-sc-danger"
                  role="alert"
                >
                  {stageError}
                </div>
              )}

              <form
                onSubmit={handleAddStage}
                className="mb-4 flex max-w-xl flex-col gap-2 sm:flex-row sm:items-center"
              >
                <label className="sr-only" htmlFor="new-stage-name">
                  Stage name
                </label>
                <input
                  id="new-stage-name"
                  type="text"
                  value={stageName}
                  onChange={(e) => setStageName(e.target.value)}
                  placeholder="Stage name"
                  className={`h-11 min-w-0 w-full rounded-lg border border-sc-border bg-sc-surface px-3 text-sm text-sc-text placeholder:text-sc-text-secondary/70 sm:max-w-sm ${CONTROL_FOCUS}`}
                  disabled={isSubmittingStage}
                />
                <button
                  type="submit"
                  disabled={isSubmittingStage}
                  className={`inline-flex h-11 shrink-0 items-center justify-center rounded-lg bg-sc-euca px-4 text-sm font-medium whitespace-nowrap text-white hover:bg-sc-euca-hover disabled:cursor-not-allowed disabled:opacity-50 ${TRANSITION} ${FOCUS_VISIBLE}`}
                >
                  {isSubmittingStage ? 'Adding…' : 'Add stage'}
                </button>
              </form>

              {activeStageError && (
                <div
                  className="mb-3 rounded-xl border border-sc-danger-border bg-sc-danger-tint px-4 py-3 text-sm text-sc-danger"
                  role="alert"
                >
                  {activeStageError}
                </div>
              )}
              {QA_ENABLED && (templateUpdateError || templatesError) && (
                <div
                  className="mb-3 rounded-xl border border-sc-danger-border bg-sc-danger-tint px-4 py-3 text-sm text-sc-danger"
                  role="alert"
                >
                  {templateUpdateError ?? templatesError}
                </div>
              )}

              {QA_ENABLED && stages.length > 0 && (
                <p className="mb-3 text-sm text-sc-text-secondary">{OVERVIEW_QA_TEMPLATE_HELP}</p>
              )}

              {stages.length === 0 ? (
                <p className="rounded-xl border border-sc-border bg-sc-surface px-4 py-6 text-sm text-sc-text-secondary">
                  No stages yet. Add a stage to organise site work.
                </p>
              ) : (
                <ul className="space-y-3">
                  {stages.map((stage, stageIndex) => {
                    const isActive = job?.active_stage_id === stage.id;
                    const isSetting = stageIdSettingActive === stage.id;
                    const isMoving = stageIdMoving === stage.id;
                    const isUpdatingTemplate = stageIdUpdatingTemplate === stage.id;
                    const selectorDisabled =
                      templatesLoading || !!templatesError || isUpdatingTemplate;
                    const mismatchWarning = getTemplateMismatchWarning(stage);
                    const templateNameLower = (stage.checklist_templates?.name ?? '').toLowerCase();
                    const isPavingTemplate = templateNameLower.includes('paving');
                    const isIrrigationTemplate = templateNameLower.includes('irrigation');
                    const isFencingTemplate = templateNameLower.includes('fencing');
                    const hasQaTemplate =
                      isPavingTemplate || isIrrigationTemplate || isFencingTemplate;
                    const stageQaType = isPavingTemplate
                      ? 'paving'
                      : isIrrigationTemplate
                        ? 'irrigation'
                        : isFencingTemplate
                          ? 'fencing'
                          : !hasQaTemplate
                            ? 'sign_off'
                            : null;
                    const hasExplicitFinishedQa = QA_ENABLED && stageHasExplicitFinishedQa({
                        stageId: stage.id,
                        stageQaType,
                        qaRuns,
                        qaRunIncompleteById,
                      });
                    const stageState = resolveOverviewStageState({
                      isActive,
                      hasExplicitFinishedQa,
                    });
                    const showSignOff = shouldShowSupervisorSignOff({
                      hasQaTemplate,
                      hasMismatchWarning: !!mismatchWarning,
                    });
                    const stageDate = stage.created_at ? formatDate(stage.created_at) : '';
                    const canMoveUp = canMoveStage(stageIndex, stages.length, 'up') && !stageIdMoving;
                    const canMoveDown =
                      canMoveStage(stageIndex, stages.length, 'down') && !stageIdMoving;

                    return (
                      <li
                        key={stage.id}
                        className={[
                          'rounded-xl border border-sc-border bg-sc-surface p-4 sm:p-5',
                          stageState.cardAccent ? 'border-l-[3px] border-l-sc-euca' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0 flex-1 space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="min-w-0 break-words text-base font-semibold text-sc-charcoal sm:text-lg">
                                {stage.name}
                              </h3>
                              <span
                                className={`inline-flex shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium ${overviewStageChipClass(stageState.chipTone)}`}
                              >
                                {stageState.label}
                              </span>
                            </div>
                            {stageDate && (
                              <p className="text-sm text-sc-text-secondary">{stageDate}</p>
                            )}
                            {stageState.showSetActive && (
                              <button
                                type="button"
                                onClick={() => setActiveStage(stage.id)}
                                disabled={!!stageIdSettingActive}
                                className={`text-sm font-medium text-sc-text-secondary underline decoration-sc-border underline-offset-2 hover:text-sc-text disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_VISIBLE}`}
                                aria-label={`Set ${stage.name} as active stage`}
                              >
                                {isSetting ? 'Setting…' : 'Set as active'}
                              </button>
                            )}
                          </div>

                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              onClick={() => moveStage(stage.id, 'up')}
                              disabled={!canMoveUp}
                              className={`inline-flex h-11 min-w-11 items-center justify-center rounded-lg border border-sc-border bg-sc-surface px-3 text-sm font-medium text-sc-text hover:bg-sc-surface-2 disabled:cursor-not-allowed disabled:opacity-40 ${TRANSITION} ${FOCUS_VISIBLE}`}
                              aria-label={stageMoveAriaLabel(stage.name, 'up')}
                            >
                              Up
                            </button>
                            <button
                              type="button"
                              onClick={() => moveStage(stage.id, 'down')}
                              disabled={!canMoveDown}
                              className={`inline-flex h-11 min-w-11 items-center justify-center rounded-lg border border-sc-border bg-sc-surface px-3 text-sm font-medium text-sc-text hover:bg-sc-surface-2 disabled:cursor-not-allowed disabled:opacity-40 ${TRANSITION} ${FOCUS_VISIBLE}`}
                              aria-label={stageMoveAriaLabel(stage.name, 'down')}
                            >
                              Down
                            </button>
                            {isMoving && (
                              <span className="text-xs text-sc-text-secondary" aria-live="polite">
                                Moving…
                              </span>
                            )}
                          </div>
                        </div>

                        {QA_ENABLED && <div className="mt-4 space-y-2">
                          <label
                            className="block text-sm font-medium text-sc-text"
                            htmlFor={`qa-template-${stage.id}`}
                          >
                            QA template
                          </label>
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <select
                              id={`qa-template-${stage.id}`}
                              value={stage.checklist_template_id ?? ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                setStageTemplate(stage.id, val ? val : null);
                              }}
                              disabled={selectorDisabled}
                              className={`h-11 min-w-0 max-w-full rounded-lg border border-sc-border bg-sc-surface px-3 text-sm text-sc-text disabled:cursor-not-allowed disabled:opacity-60 sm:max-w-md ${CONTROL_FOCUS}`}
                              aria-label={`QA template for ${stage.name}`}
                            >
                              <option value="">None</option>
                              {templates.map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.name}
                                </option>
                              ))}
                            </select>
                            {isUpdatingTemplate && (
                              <span className="text-xs text-sc-text-secondary" aria-live="polite">
                                Saving…
                              </span>
                            )}
                            {!stage.checklist_template_id && (
                              <span className="text-xs text-sc-text-secondary">No template selected</span>
                            )}
                          </div>
                        </div>}

                        {QA_ENABLED && mismatchWarning && (
                          <div
                            className="mt-3 rounded-lg border border-sc-warn-border bg-sc-warn-tint px-3 py-2 text-xs text-sc-warn"
                            role="status"
                          >
                            {mismatchWarning}
                          </div>
                        )}

                        {QA_ENABLED && (isPavingTemplate ||
                          isIrrigationTemplate ||
                          isFencingTemplate ||
                          showSignOff) &&
                          !mismatchWarning && (
                            <div className="mt-4 flex flex-wrap gap-2">
                              {isPavingTemplate && (
                                <Link
                                  href={stageQaHref(orgSlug, jobId, stage.id, 'paving', qaRuns)}
                                  className={`inline-flex h-11 items-center justify-center rounded-lg border border-sc-border bg-sc-surface px-4 text-sm font-medium text-sc-euca hover:bg-sc-euca-tint ${TRANSITION} ${FOCUS_VISIBLE}`}
                                >
                                  Open Paving QA
                                </Link>
                              )}
                              {isIrrigationTemplate && (
                                <Link
                                  href={stageQaHref(orgSlug, jobId, stage.id, 'irrigation', qaRuns)}
                                  className={`inline-flex h-11 items-center justify-center rounded-lg border border-sc-border bg-sc-surface px-4 text-sm font-medium text-sc-euca hover:bg-sc-euca-tint ${TRANSITION} ${FOCUS_VISIBLE}`}
                                >
                                  Open Irrigation QA
                                </Link>
                              )}
                              {isFencingTemplate && (
                                <Link
                                  href={stageQaHref(orgSlug, jobId, stage.id, 'fencing', qaRuns)}
                                  className={`inline-flex h-11 items-center justify-center rounded-lg border border-sc-border bg-sc-surface px-4 text-sm font-medium text-sc-euca hover:bg-sc-euca-tint ${TRANSITION} ${FOCUS_VISIBLE}`}
                                >
                                  Open Fencing QA
                                </Link>
                              )}
                              {showSignOff && (
                                <Link
                                  href={stageSignOffHref(orgSlug, jobId, stage.id, qaRuns)}
                                  className={`inline-flex h-11 items-center justify-center rounded-lg border border-sc-border bg-sc-surface px-4 text-sm font-medium text-sc-text hover:bg-sc-surface-2 ${TRANSITION} ${FOCUS_VISIBLE}`}
                                >
                                  Supervisor sign-off
                                </Link>
                              )}
                            </div>
                          )}

                        {QA_ENABLED && stage.checklist_templates?.checklist_template_items &&
                          stage.checklist_templates.checklist_template_items.length > 0 && (
                            <div className="mt-4 border-t border-sc-border pt-3">
                              {(() => {
                                const items = [
                                  ...stage.checklist_templates.checklist_template_items,
                                ].sort((a, b) => a.sort_order - b.sort_order);
                                const byType = {
                                  tools: items.filter((i) => i.item_type === 'tools'),
                                  materials: items.filter((i) => i.item_type === 'materials'),
                                  qc: items.filter((i) => i.item_type === 'qc'),
                                };
                                const groups = [
                                  { key: 'tools' as const, label: 'Tools', list: byType.tools },
                                  {
                                    key: 'materials' as const,
                                    label: 'Materials',
                                    list: byType.materials,
                                  },
                                  { key: 'qc' as const, label: 'QC', list: byType.qc },
                                ];
                                return (
                                  <div className="space-y-2 text-sm text-sc-text-secondary">
                                    {groups.map(
                                      (g) =>
                                        g.list.length > 0 && (
                                          <div key={g.key} className="min-w-0">
                                            <span className="font-medium text-sc-text">{g.label}:</span>
                                            <ul className="mt-0.5 ml-3 list-disc break-words">
                                              {g.list.map((item, idx) => (
                                                <li key={idx}>{item.label}</li>
                                              ))}
                                            </ul>
                                          </div>
                                        )
                                    )}
                                  </div>
                                );
                              })()}
                            </div>
                          )}
                      </li>
                    );
                  })}
                </ul>
              )}
              </section>
            )}

            {/* Keep job notes last so every current and future stage renders above it. */}
            <div className="mt-8">
              <JobNotesEntryCard
                orgSlug={orgSlug}
                jobId={jobId}
                variant="archive"
                returnTo={`/t/${orgSlug}/jobs/${jobId}`}
                showPreview
              />
            </div>

    </JobWorkspaceShell>
  );
}
