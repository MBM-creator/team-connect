import type { CcProject } from '@/lib/cc-client';
import {
  clientFacingDetails,
  formatAustralianMobileDisplay,
  siteLocationForList,
} from '@/lib/cc-client-display';
import { formatCcStatusLabel, normaliseSearchText } from '@/lib/jobs-list';
import { buildJobNotesHref } from '@/lib/job-notes-routes';
import { todayReportDate } from '@/lib/report-date';
import { QA_ENABLED } from '@/lib/feature-flags';

export type JobWorkspaceJobInput = {
  id: string;
  name: string;
  cc_project_id?: string | null;
  cc_project_title_snapshot?: string | null;
  cc_client_name_snapshot?: string | null;
  cc_site_address_snapshot?: string | null;
  cc_job_number?: string | null;
  active_stage_id?: string | null;
};

export type JobWorkspaceSectionId = 'overview' | 'today' | 'qa' | 'notes';

export type JobWorkspaceIdentityModel = {
  /** Always the selected job UUID — never inferred from client name. */
  jobId: string;
  primaryHeading: string;
  supportingClientName: string | null;
  suburb: string | null;
  lifecycleStatus: string | null;
  lifecycleStatusLabel: string | null;
  jobReference: string | null;
};

export type JobWorkspaceSummaryField = {
  key: 'address' | 'phone' | 'stage';
  label: string;
  value: string;
  /** Raw phone for tel: links; only set for phone fields. */
  telHref?: string | null;
};

export type JobWorkspaceSection = {
  id: JobWorkspaceSectionId;
  label: string;
  href: string;
};

export type JobWorkspaceHealthInput = {
  /** Explicit operational health label from trusted data only. */
  label: string | null;
};

/**
 * Operational health for the workspace shell.
 * Returns null unless the caller already has explicit health data.
 * Does not infer health from lifecycle status.
 */
export function resolveJobWorkspaceHealth(
  health: JobWorkspaceHealthInput | null | undefined
): string | null {
  const label = health?.label?.trim() ?? '';
  return label || null;
}

export function buildJobWorkspaceIdentityModel(input: {
  job: JobWorkspaceJobInput;
  project?: Pick<
    CcProject,
    'client_name' | 'client_contact' | 'site_address' | 'project_title' | 'status'
  > | null;
}): JobWorkspaceIdentityModel {
  const { job, project = null } = input;
  const details = clientFacingDetails({
    project,
    clientNameSnapshot: job.cc_client_name_snapshot,
    projectTitleSnapshot: job.cc_project_title_snapshot,
    siteAddressSnapshot: job.cc_site_address_snapshot,
    jobName: job.name,
  });

  const projectTitle =
    (project?.project_title ?? job.cc_project_title_snapshot ?? job.name)?.trim() || null;
  const clientName = details.name.trim();
  const titleDistinct =
    Boolean(projectTitle) &&
    normaliseSearchText(projectTitle) !== normaliseSearchText(clientName);

  const primaryHeading = titleDistinct ? projectTitle! : clientName || projectTitle || 'Job';
  const supportingClientName =
    titleDistinct && clientName && normaliseSearchText(clientName) !== normaliseSearchText(primaryHeading)
      ? clientName
      : null;

  const lifecycleStatus = project?.status?.trim() || null;

  return {
    jobId: job.id,
    primaryHeading,
    supportingClientName,
    suburb: siteLocationForList(details.address),
    lifecycleStatus,
    lifecycleStatusLabel: formatCcStatusLabel(lifecycleStatus),
    jobReference: job.cc_job_number?.trim() || null,
  };
}

export function buildJobWorkspaceSummaryFields(input: {
  job: JobWorkspaceJobInput;
  project?: Pick<CcProject, 'client_name' | 'client_contact' | 'site_address'> | null;
  activeStageName?: string | null;
}): JobWorkspaceSummaryField[] {
  const details = clientFacingDetails({
    project: input.project,
    clientNameSnapshot: input.job.cc_client_name_snapshot,
    projectTitleSnapshot: input.job.cc_project_title_snapshot,
    siteAddressSnapshot: input.job.cc_site_address_snapshot,
    jobName: input.job.name,
  });

  const fields: JobWorkspaceSummaryField[] = [];

  const address = details.address?.trim() || null;
  if (address) {
    fields.push({ key: 'address', label: 'Address', value: address });
  }

  const phoneRaw = details.phone?.trim() || null;
  if (phoneRaw) {
    fields.push({
      key: 'phone',
      label: 'Phone',
      value: formatAustralianMobileDisplay(phoneRaw) ?? phoneRaw,
      telHref: phoneRaw,
    });
  }

  const stage = input.activeStageName?.trim() || null;
  if (stage) {
    fields.push({ key: 'stage', label: 'Current stage', value: stage });
  }

  return fields;
}

export function jobWorkspaceJobsListHref(orgSlug: string): string {
  return `/t/${orgSlug}/jobs`;
}

export function buildJobWorkspaceSections(input: {
  orgSlug: string;
  jobId: string;
  activeStageId?: string | null;
}): JobWorkspaceSection[] {
  const { orgSlug, jobId, activeStageId = null } = input;
  const overviewHref = `/t/${orgSlug}/jobs/${jobId}`;

  return [
    { id: 'overview', label: 'Overview', href: overviewHref },
    { id: 'today', label: 'Today', href: `${overviewHref}/today` },
    ...(QA_ENABLED
      ? [{ id: 'qa' as const, label: 'QA', href: `${overviewHref}/qa` }]
      : []),
    {
      id: 'notes',
      label: 'Notes',
      href: buildJobNotesHref(orgSlug, jobId, {
        mode: 'capture',
        returnTo: overviewHref,
        reportDate: todayReportDate(),
        stageId: activeStageId,
      }),
    },
  ];
}

/**
 * Resolve the active workspace section from a pathname.
 * Deep routes under /qa/... still highlight QA; /notes highlights Notes.
 */
export function resolveActiveJobWorkspaceSection(
  pathname: string | null | undefined
): JobWorkspaceSectionId {
  const path = (pathname ?? '').split('?')[0] ?? '';
  if (/\/jobs\/[^/]+\/today(?:\/|$)/.test(path)) return 'today';
  if (/\/jobs\/[^/]+\/qa(?:\/|$)/.test(path)) return 'qa';
  if (/\/jobs\/[^/]+\/notes(?:\/|$)/.test(path)) return 'notes';
  if (/\/jobs\/[^/]+\/daily-plan(?:\/|$)/.test(path)) return 'today';
  return 'overview';
}
