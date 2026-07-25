import type { CcProject } from '@/lib/cc-client';
import { clientFacingDetails, siteLocationForList } from '@/lib/cc-client-display';

export type JobSiteLocationSource = {
  id: string;
  name: string;
  cc_project_id?: string | null;
  cc_project_title_snapshot?: string | null;
  cc_client_name_snapshot?: string | null;
  cc_site_address_snapshot?: string | null;
};

export type JobWithSiteLocation<T extends JobSiteLocationSource> = T & {
  site_location: string | null;
};

function normaliseTitle(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function ccProjectForJob(job: JobSiteLocationSource, projects: CcProject[]): CcProject | null {
  if (job.cc_project_id) {
    return projects.find((candidate) => candidate.project_id === job.cc_project_id) ?? null;
  }

  const title = normaliseTitle(job.cc_project_title_snapshot ?? job.name);
  if (!title) return null;

  const matches = projects.filter((candidate) => normaliseTitle(candidate.project_title) === title);
  return matches.length === 1 ? matches[0] : null;
}

export function jobSiteLocation(
  job: JobSiteLocationSource,
  projects: CcProject[] = []
): string | null {
  const details = clientFacingDetails({
    project: ccProjectForJob(job, projects),
    clientNameSnapshot: job.cc_client_name_snapshot,
    projectTitleSnapshot: job.cc_project_title_snapshot,
    siteAddressSnapshot: job.cc_site_address_snapshot,
    jobName: job.name,
  });
  return siteLocationForList(details.address);
}

export function enrichJobsWithSiteLocation<T extends JobSiteLocationSource>(
  jobs: T[],
  projects: CcProject[] = []
): JobWithSiteLocation<T>[] {
  return jobs.map((job) => ({
    ...job,
    site_location: jobSiteLocation(job, projects),
  }));
}
