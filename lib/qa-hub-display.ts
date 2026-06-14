import type { QaCheckType } from '@/lib/cc-project-context';
import { BLOCKING_ISSUE_STATUSES } from '@/lib/qa-evidence-graph';

export type QaType = 'paving' | 'irrigation' | 'fencing' | 'sign_off';

export type QaHubRun = {
  id: string;
  status: string;
  started_at: string;
  completed_at?: string | null;
  supervisor_final_approved_at?: string | null;
  qa_type?: string | null;
  setup_version?: number | null;
};

/** Legacy paving runs (pre-v2) are hidden from hub lists. */
export function isLegacyPavingRun(run: QaHubRun): boolean {
  return normalizeQaType(run.qa_type) === 'paving' && run.setup_version !== 2;
}

export function normalizeQaType(qaType: string | null | undefined): QaType {
  if (qaType === 'irrigation' || qaType === 'fencing' || qaType === 'sign_off') {
    return qaType;
  }
  return 'paving';
}

export function qaTypeDisplayLabel(qaType: string | null | undefined): string {
  switch (normalizeQaType(qaType)) {
    case 'irrigation':
      return 'Irrigation';
    case 'fencing':
      return 'Fencing';
    case 'sign_off':
      return 'Supervisor sign-off';
    case 'paving':
    default:
      return 'Paving';
  }
}

export function runDisplayStatus(run: QaHubRun): string {
  if (run.status === 'active') return 'Active';
  if (run.status === 'cancelled') return 'Cancelled';
  if (run.status === 'completed') {
    return run.supervisor_final_approved_at ? 'Approved' : 'Completed';
  }
  return 'Completed';
}

const QA_HUB_DATE_FORMATTER = new Intl.DateTimeFormat('en-AU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Australia/Melbourne',
  hour12: true,
});

export function formatQaDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return QA_HUB_DATE_FORMATTER.format(date);
}

export function qaRunPath(orgSlug: string, jobId: string, runId: string, qaType: string | null | undefined): string {
  const type = normalizeQaType(qaType);
  if (type === 'irrigation') {
    return `/t/${orgSlug}/jobs/${jobId}/qa/irrigation/${runId}`;
  }
  if (type === 'fencing') {
    return `/t/${orgSlug}/jobs/${jobId}/qa/fencing/${runId}`;
  }
  if (type === 'sign_off') {
    return `/t/${orgSlug}/jobs/${jobId}/qa/sign-off/${runId}`;
  }
  return `/t/${orgSlug}/jobs/${jobId}/qa/paving/${runId}`;
}

export function qaSupervisorPath(
  orgSlug: string,
  jobId: string,
  runId: string,
  qaType: string | null | undefined
): string {
  const type = normalizeQaType(qaType);
  if (type === 'irrigation') {
    return `/t/${orgSlug}/jobs/${jobId}/qa/irrigation/${runId}/supervisor`;
  }
  if (type === 'fencing') {
    return `/t/${orgSlug}/jobs/${jobId}/qa/fencing/${runId}/supervisor`;
  }
  if (type === 'sign_off') {
    return `/t/${orgSlug}/jobs/${jobId}/qa/sign-off/${runId}/supervisor`;
  }
  return `/t/${orgSlug}/jobs/${jobId}/qa/paving/${runId}/supervisor`;
}

export function qaNewRunPath(orgSlug: string, jobId: string, qaType: QaType | QaCheckType): string {
  if (qaType === 'irrigation') {
    return `/t/${orgSlug}/jobs/${jobId}/qa/irrigation/new`;
  }
  if (qaType === 'fencing') {
    return `/t/${orgSlug}/jobs/${jobId}/qa/fencing/new`;
  }
  if (qaType === 'sign_off') {
    return `/t/${orgSlug}/jobs/${jobId}/qa/sign-off/new`;
  }
  return `/t/${orgSlug}/jobs/${jobId}/qa/paving/new`;
}

export function currentRunActionLabel(run: QaHubRun): string {
  return run.status === 'active' ? 'Continue QA' : 'View QA';
}

function sortByStartedDesc(a: QaHubRun, b: QaHubRun): number {
  return new Date(b.started_at).getTime() - new Date(a.started_at).getTime();
}

/** Active or completed-but-not-finally-approved runs shown under Current QA. */
export function isCurrentQaRun(run: QaHubRun): boolean {
  if (run.status === 'cancelled') return false;
  if (run.supervisor_final_approved_at) return false;
  return run.status === 'active' || run.status === 'completed';
}

export function bucketHubRuns(runs: QaHubRun[]): { currentRuns: QaHubRun[]; historyRuns: QaHubRun[] } {
  const visible = runs.filter((run) => !isLegacyPavingRun(run));
  const currentRuns = visible.filter(isCurrentQaRun).sort(sortByStartedDesc);
  const historyRuns = visible.filter((run) => !isCurrentQaRun(run)).sort(sortByStartedDesc);
  return { currentRuns, historyRuns };
}

export function activeRunForType(runs: QaHubRun[], qaType: QaType): QaHubRun | undefined {
  return runs.find((run) => run.status === 'active' && normalizeQaType(run.qa_type) === qaType);
}

export const QA_CHECK_DESCRIPTIONS: Record<QaCheckType, string> = {
  paving:
    'Evidence run for paving works, base preparation, set-out, surface and supervisor sign-off.',
  irrigation:
    'Evidence run for irrigation water source checks, before-cover records, controller setup, testing and handover.',
  fencing:
    'Evidence run for fencing property protection, set-out, post holes, frame, cladding, gates and final supervisor review.',
};

export const SIGN_OFF_DESCRIPTION =
  'No trade-specific checklist applies to this project. Record completion evidence and supervisor review instead.';

export type QaAttentionSeverity = 'issue' | 'review' | 'info';

export type QaAttentionItem = {
  runId: string;
  qaType: string | null;
  severity: QaAttentionSeverity;
  title: string;
  detail?: string;
  count?: number;
  href: string;
};

export type QaRunDetailPayload = {
  ok?: boolean;
  qaType?: string | null;
  sectionStates?: unknown[];
  issues?: unknown[];
  run?: {
    id?: string;
    status?: string;
    supervisor_final_approved_at?: string | null;
  } | null;
};

type NormalizedSection = {
  code: string;
  title: string;
  applicable: boolean;
  cleared: boolean | null;
  submissionStatus: string | null;
  status: string;
  hasBlockingIssue: boolean;
};

const BLOCKING_SECTION_STATUSES = new Set([
  'issue_raised',
  'rectification_required',
  'rectified_awaiting_supervisor',
  'blocked',
  'blocked_by_unresolved_issue',
]);

function isBlockingIssueStatus(status: unknown): boolean {
  return (
    typeof status === 'string' &&
    BLOCKING_ISSUE_STATUSES.includes(status as (typeof BLOCKING_ISSUE_STATUSES)[number])
  );
}

function normalizeSection(raw: unknown): NormalizedSection | null {
  if (!raw || typeof raw !== 'object') return null;
  const section = raw as Record<string, unknown>;
  const code = String(section.code ?? section.section ?? '').trim();
  if (!code) return null;
  const title = String(section.title ?? code).trim() || code;
  const applicable = section.applicable !== false;
  const cleared =
    typeof section.cleared === 'boolean' ? section.cleared : null;
  const submissionStatus =
    typeof section.submissionStatus === 'string' ? section.submissionStatus : null;
  const status = typeof section.status === 'string' ? section.status : '';
  const hasBlockingIssue = section.hasBlockingIssue === true;
  return {
    code,
    title,
    applicable,
    cleared,
    submissionStatus,
    status,
    hasBlockingIssue,
  };
}

function normalizeSections(raw: unknown): NormalizedSection[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeSection).filter((section): section is NormalizedSection => section !== null);
}

function normalizeIssues(raw: unknown): Array<{ status: string; section_code?: string; title?: string | null }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((issue): issue is Record<string, unknown> => Boolean(issue) && typeof issue === 'object')
    .map((issue) => ({
      status: typeof issue.status === 'string' ? issue.status : '',
      section_code: typeof issue.section_code === 'string' ? issue.section_code : undefined,
      title: typeof issue.title === 'string' ? issue.title : null,
    }));
}

function formatSectionNames(sections: NormalizedSection[], max = 2): string | undefined {
  if (sections.length === 0) return undefined;
  const names = sections.slice(0, max).map((section) => section.title);
  const remaining = sections.length - max;
  if (remaining > 0) {
    return `${names.join(', ')} + ${remaining} more`;
  }
  return names.join(', ');
}

function attentionReviewHref(
  orgSlug: string,
  jobId: string,
  runId: string,
  qaType: string | null | undefined
): string {
  return qaSupervisorPath(orgSlug, jobId, runId, qaType);
}

function sectionAwaitingReview(section: NormalizedSection): boolean {
  if (!section.applicable) return false;
  if (section.cleared === true) return false;
  return section.submissionStatus === 'submitted';
}

function sectionHasBlockingSignal(section: NormalizedSection): boolean {
  if (!section.applicable) return false;
  if (section.hasBlockingIssue) return true;
  if (BLOCKING_SECTION_STATUSES.has(section.status)) return true;
  return false;
}

function buildSubmittedAttentionItem(
  runId: string,
  qaType: string | null | undefined,
  sections: NormalizedSection[],
  ctx: { orgSlug: string; jobId: string }
): QaAttentionItem | null {
  const submittedSections = sections.filter(sectionAwaitingReview);
  if (submittedSections.length === 0) return null;
  const detailParts = [`${submittedSections.length} section${submittedSections.length === 1 ? '' : 's'} submitted`];
  const names = formatSectionNames(submittedSections);
  if (names) detailParts.push(names);
  return {
    runId,
    qaType: qaType ?? null,
    severity: 'review',
    title: 'Submitted sections awaiting review',
    detail: detailParts.join(' · '),
    count: submittedSections.length,
    href: attentionReviewHref(ctx.orgSlug, ctx.jobId, runId, qaType),
  };
}

function buildBlockingAttentionItem(
  runId: string,
  qaType: string | null | undefined,
  sections: NormalizedSection[],
  issues: Array<{ status: string; section_code?: string; title?: string | null }>,
  ctx: { orgSlug: string; jobId: string }
): QaAttentionItem | null {
  const blockingIssues = issues.filter((issue) => isBlockingIssueStatus(issue.status));
  const blockingSections = sections.filter(sectionHasBlockingSignal);
  const count = Math.max(blockingIssues.length, blockingSections.length);
  if (count === 0) return null;

  const detailParts: string[] = [];
  if (blockingIssues.length > 0) {
    detailParts.push(`${blockingIssues.length} unresolved issue${blockingIssues.length === 1 ? '' : 's'}`);
  }
  const sectionNames = formatSectionNames(blockingSections);
  if (sectionNames) detailParts.push(sectionNames);

  return {
    runId,
    qaType: qaType ?? null,
    severity: 'issue',
    title: 'Blocking issue needs review',
    detail: detailParts.length > 0 ? detailParts.join(' · ') : undefined,
    count: blockingIssues.length > 0 ? blockingIssues.length : blockingSections.length,
    href: attentionReviewHref(ctx.orgSlug, ctx.jobId, runId, qaType),
  };
}

function canShowEvidenceReadyAttention(
  hubRun: QaHubRun,
  detail: QaRunDetailPayload,
  sections: NormalizedSection[],
  issues: Array<{ status: string }>,
  hasSubmittedAttention: boolean,
  hasBlockingAttention: boolean
): boolean {
  if (!isCurrentQaRun(hubRun)) return false;
  if (hubRun.supervisor_final_approved_at) return false;
  if (detail.run?.supervisor_final_approved_at) return false;
  if (hasSubmittedAttention || hasBlockingAttention) return false;
  if (!Array.isArray(detail.issues)) return false;
  if (sections.length === 0) return false;

  const applicableSections = sections.filter((section) => section.applicable);
  if (applicableSections.length === 0) return false;
  if (applicableSections.some((section) => section.cleared !== true)) return false;
  if (issues.some((issue) => isBlockingIssueStatus(issue.status))) return false;
  if (sections.some(sectionHasBlockingSignal)) return false;
  if (sections.some(sectionAwaitingReview)) return false;

  return true;
}

function buildEvidenceReadyAttentionItem(
  runId: string,
  qaType: string | null | undefined,
  ctx: { orgSlug: string; jobId: string }
): QaAttentionItem {
  return {
    runId,
    qaType: qaType ?? null,
    severity: 'info',
    title: 'Evidence may be ready for supervisor review',
    detail: 'All sections cleared',
    href: attentionReviewHref(ctx.orgSlug, ctx.jobId, runId, qaType),
  };
}

const ATTENTION_SEVERITY_RANK: Record<QaAttentionSeverity, number> = {
  issue: 0,
  review: 1,
  info: 2,
};

export function extractAttentionItemsFromRunDetail(
  detail: QaRunDetailPayload,
  hubRun: QaHubRun,
  ctx: { orgSlug: string; jobId: string }
): QaAttentionItem[] {
  if (!detail.ok) return [];

  const runId = detail.run?.id ?? hubRun.id;
  const qaType = detail.qaType ?? hubRun.qa_type ?? null;
  const sections = normalizeSections(detail.sectionStates);
  const issues = normalizeIssues(detail.issues);

  const submittedItem = buildSubmittedAttentionItem(runId, qaType, sections, ctx);
  const blockingItem = buildBlockingAttentionItem(runId, qaType, sections, issues, ctx);

  const items: QaAttentionItem[] = [];
  if (blockingItem) items.push(blockingItem);
  if (submittedItem) items.push(submittedItem);

  if (
    canShowEvidenceReadyAttention(
      hubRun,
      detail,
      sections,
      issues,
      submittedItem !== null,
      blockingItem !== null
    )
  ) {
    items.push(buildEvidenceReadyAttentionItem(runId, qaType, ctx));
  }

  return items;
}

export function sortAttentionItems(items: QaAttentionItem[], currentRuns: QaHubRun[]): QaAttentionItem[] {
  const runOrder = new Map(currentRuns.map((run, index) => [run.id, index]));
  return [...items].sort((a, b) => {
    const severityDelta = ATTENTION_SEVERITY_RANK[a.severity] - ATTENTION_SEVERITY_RANK[b.severity];
    if (severityDelta !== 0) return severityDelta;
    const runDelta = (runOrder.get(a.runId) ?? 999) - (runOrder.get(b.runId) ?? 999);
    if (runDelta !== 0) return runDelta;
    return a.title.localeCompare(b.title);
  });
}
