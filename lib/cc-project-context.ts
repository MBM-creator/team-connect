import {
  fetchCcProjects,
  toCcProjectOperationalSummary,
  type CcProject,
  type CcProjectOperationalSummary,
  type CcProjectTrade,
} from '@/lib/cc-client';
import { isCcIntegrationOrgAllowed } from '@/lib/cc-integration-access';

type JobWithClientConnect = {
  cc_project_id?: string | null;
  cc_quote_id?: string | null;
};

export type QaCheckType = 'paving' | 'irrigation' | 'fencing';

export function getApplicableQaChecks(project: CcProject | null): QaCheckType[] {
  if (!project) return ['paving'];
  const trades = new Set<CcProjectTrade>(project.trades);
  const checks: QaCheckType[] = [];
  if (trades.has('paving')) checks.push('paving');
  if (trades.has('irrigation')) checks.push('irrigation');
  if (trades.has('fencing')) checks.push('fencing');
  return checks;
}

/**
 * Load the single linked operational CC project for a job.
 * Fail closed when the Site Connect org is not on the temporary integration allowlist.
 */
export async function loadCcProjectForJob(
  job: JobWithClientConnect,
  organisationId: string,
  requestId?: string
): Promise<CcProjectOperationalSummary | null> {
  if (!job.cc_project_id && !job.cc_quote_id) return null;
  if (!isCcIntegrationOrgAllowed(organisationId)) return null;
  try {
    const projects = await fetchCcProjects(organisationId, requestId);
    const match =
      projects.find((project) => {
        // Prefer explicit quote match when the job stores cc_quote_id; never treat quote as project.
        if (job.cc_quote_id && project.quote_id === job.cc_quote_id) return true;
        return project.project_id === job.cc_project_id;
      }) ?? null;
    return match ? toCcProjectOperationalSummary(match) : null;
  } catch (err) {
    console.warn('[CC PROJECT CONTEXT] skipped', {
      requestId,
      organisationId,
      reason: err instanceof Error ? err.message : 'unknown',
    });
    return null;
  }
}
