import type { IssueStatus, SubmissionStatus } from './qa-evidence-types';

export type { IssueStatus, SubmissionStatus };

export const BLOCKING_ISSUE_STATUSES: IssueStatus[] = [
  'open',
  'rectification_required',
  'evidence_requested',
];

export const TERMINAL_ISSUE_STATUSES: IssueStatus[] = ['resolved_approved', 'proceed_approved'];

export type AnswerPayload = { result?: string; note?: string };

export type SubmissionSnapshot = {
  section_code: string;
  submission_status: SubmissionStatus | string;
  answers: Record<string, AnswerPayload>;
  submitted_at?: string | null;
};

export type IssueSnapshot = {
  id?: string;
  section_code: string;
  item_key: string;
  severity: string;
  status: IssueStatus | string;
  title?: string | null;
};

/** Count photos per `${section_code}:${item_key}` */
export type PhotoCounts = Map<string, number>;

function photoKey(section: string, itemKey: string): string {
  return `${section}:${itemKey}`;
}

export function buildPhotoCounts(
  rows: { section_code: string; item_key: string }[]
): PhotoCounts {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = photoKey(r.section_code, r.item_key);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

export function buildSubmissionMap(rows: SubmissionSnapshot[]): Map<string, SubmissionSnapshot> {
  const m = new Map<string, SubmissionSnapshot>();
  for (const r of rows) {
    m.set(r.section_code, r);
  }
  return m;
}

export function hasBlockingIssueInSection(section: string, issues: IssueSnapshot[]): boolean {
  return issues
    .filter((i) => i.section_code === section)
    .some((i) => BLOCKING_ISSUE_STATUSES.includes(i.status as IssueStatus));
}
