import type { CcProject } from '@/lib/cc-client';

export type JobNumberSource = {
  cc_project_id?: string | null;
  cc_quote_id?: string | null;
  cc_job_number?: string | null;
};

/** CC owns numbering. Never match a number by client name or job title. */
export function canonicalJobNumber(job: JobNumberSource, project?: Pick<CcProject, 'project_id' | 'quote_id' | 'cc_job_number'> | null): string | null {
  const linked = project && (
    (job.cc_project_id && job.cc_project_id === project.project_id) ||
    (job.cc_quote_id && job.cc_quote_id === project.quote_id)
  );
  // An authoritative linked null also clears a stale cached number.
  return linked ? project.cc_job_number?.trim() || null : job.cc_job_number?.trim() || null;
}

export function jobNumberLabel(number: string | null | undefined): string {
  return number?.trim() ? `Job #${number.trim()}` : 'Job number not assigned';
}
