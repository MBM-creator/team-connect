import type { CcProject, CcProjectStatus } from '@/lib/cc-client';
import { clientFacingDetails, siteLocationForList } from '@/lib/cc-client-display';

export type JobsListTab = 'active' | 'completed';

export type JobsListJob = {
  id: string;
  organisation_id: string;
  name: string;
  site_id: string | null;
  created_at: string;
  cc_project_id?: string | null;
  cc_client_id?: string | null;
  cc_project_title_snapshot?: string | null;
  cc_client_name_snapshot?: string | null;
  cc_site_address_snapshot?: string | null;
  site_location?: string | null;
  /** Soft-hide timestamp. Only honest "completed" signal available on the job row. */
  hidden_from_qa_at?: string | null;
};

export type JobListRowModel = {
  id: string;
  clientName: string;
  projectTitle: string | null;
  location: string | null;
  phone: string | null;
  status: string | null;
  href: string;
};

export const CLIENT_CONNECT_STATUS_ORDER: Record<string, number> = {
  wip: 0,
  deposit_paid: 1,
  prestart_date_set: 2,
  prestart_paid: 3,
  quote_accepted: 4,
  active: 5,
  planning: 6,
};

/**
 * Active / Completed mapping for the Jobs list.
 *
 * There is no job.status column. CcProjectStatus values are all pipeline stages
 * (planning → wip). The only job-level "done" signal is hidden_from_qa_at
 * (soft-hide from QA). Note: GET /api/jobs currently filters those rows out, so
 * the Completed tab is empty until that API surface changes.
 */
export function isCompletedJob(job: Pick<JobsListJob, 'hidden_from_qa_at'>): boolean {
  return job.hidden_from_qa_at != null && String(job.hidden_from_qa_at).trim() !== '';
}

export function filterJobsByTab(jobs: JobsListJob[], tab: JobsListTab): JobsListJob[] {
  return jobs.filter((job) => (tab === 'completed' ? isCompletedJob(job) : !isCompletedJob(job)));
}

export function normaliseSearchText(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function jobSearchHaystack(
  job: JobsListJob,
  project: Pick<CcProject, 'client_name' | 'client_contact' | 'site_address' | 'project_title'> | null
): string {
  const details = clientFacingDetails({
    project,
    clientNameSnapshot: job.cc_client_name_snapshot,
    projectTitleSnapshot: job.cc_project_title_snapshot,
    siteAddressSnapshot: job.cc_site_address_snapshot,
    jobName: job.name,
  });
  const parts = [
    details.name,
    job.cc_project_title_snapshot,
    job.name,
    project?.project_title,
    job.site_location,
    details.address,
    job.cc_site_address_snapshot,
  ];
  return normaliseSearchText(parts.filter(Boolean).join(' '));
}

export function jobMatchesSearch(
  job: JobsListJob,
  query: string,
  project: Pick<CcProject, 'client_name' | 'client_contact' | 'site_address' | 'project_title'> | null
): boolean {
  const needle = normaliseSearchText(query);
  if (!needle) return true;
  return jobSearchHaystack(job, project).includes(needle);
}

export function projectMatchesSearch(project: CcProject, query: string): boolean {
  const needle = normaliseSearchText(query);
  if (!needle) return true;
  const haystack = normaliseSearchText(
    [project.client_name, project.project_title, project.site_address, siteLocationForList(project.site_address)]
      .filter(Boolean)
      .join(' ')
  );
  return haystack.includes(needle);
}

/** Presentation label for CC pipeline status. Does not change stored values. */
export function formatCcStatusLabel(status: string | null | undefined): string | null {
  const raw = status?.trim();
  if (!raw) return null;

  const key = raw.toLowerCase();
  if (key === 'wip') return 'WIP';

  const spaced = key.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function statusRank(status: string | null | undefined): number {
  return CLIENT_CONNECT_STATUS_ORDER[status ?? ''] ?? 99;
}

/** Statuses present in the current tab, ordered by established CC priority. */
export function statusOptionsForTab(
  statuses: Array<string | null | undefined>
): Array<{ value: string; label: string }> {
  const unique = new Set<string>();
  for (const status of statuses) {
    const trimmed = status?.trim();
    if (trimmed) unique.add(trimmed);
  }
  return Array.from(unique)
    .sort((a, b) => {
      const rankDelta = statusRank(a) - statusRank(b);
      if (rankDelta !== 0) return rankDelta;
      return a.localeCompare(b);
    })
    .map((value) => ({ value, label: formatCcStatusLabel(value) ?? value }));
}

export function jobMatchesStatusFilter(
  status: string | null | undefined,
  statusFilter: string
): boolean {
  if (!statusFilter) return true;
  return (status ?? '') === statusFilter;
}

export function buildJobListRowModel(
  job: JobsListJob,
  orgSlug: string,
  project: Pick<CcProject, 'client_name' | 'client_contact' | 'site_address' | 'project_title' | 'status'> | null
): JobListRowModel {
  const details = clientFacingDetails({
    project,
    clientNameSnapshot: job.cc_client_name_snapshot,
    projectTitleSnapshot: job.cc_project_title_snapshot,
    siteAddressSnapshot: job.cc_site_address_snapshot,
    jobName: job.name,
  });
  const projectTitle =
    (project?.project_title ?? job.cc_project_title_snapshot ?? job.name)?.trim() || null;
  const showTitle =
    projectTitle &&
    normaliseSearchText(projectTitle) !== normaliseSearchText(details.name)
      ? projectTitle
      : null;

  return {
    id: job.id,
    clientName: details.name,
    projectTitle: showTitle,
    location: job.site_location ?? siteLocationForList(details.address),
    phone: details.phone,
    status: project?.status ?? null,
    href: `/t/${orgSlug}/jobs/${job.id}`,
  };
}

export function clearJobsListFilters(): { searchQuery: string; statusFilter: string } {
  return { searchQuery: '', statusFilter: '' };
}

export function hasActiveJobsListFilters(searchQuery: string, statusFilter: string): boolean {
  return Boolean(searchQuery.trim() || statusFilter);
}

/** Type-safe known CC statuses for reference; options are still derived from data. */
export const KNOWN_CC_PROJECT_STATUSES: CcProjectStatus[] = [
  'planning',
  'active',
  'quote_accepted',
  'deposit_paid',
  'prestart_date_set',
  'prestart_paid',
  'wip',
];

/**
 * Lifecycle chip tone for Client Connect pipeline status.
 * Maps pipeline stage → semantic colour only. Does not imply operational health
 * (on track / attention / blocked / overdue).
 */
export type LifecycleStatusChipTone = 'active' | 'info' | 'neutral';

export function lifecycleStatusChipTone(
  status: string | null | undefined
): LifecycleStatusChipTone {
  const key = status?.trim() ?? '';
  if (key === 'wip' || key === 'active') return 'active';
  if (
    key === 'planning' ||
    key === 'quote_accepted' ||
    key === 'deposit_paid' ||
    key === 'prestart_date_set' ||
    key === 'prestart_paid'
  ) {
    return 'info';
  }
  return 'neutral';
}
