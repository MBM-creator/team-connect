/**
 * Smart Checklist pilot — domain rules, intentionally independent of persistence and email.
 * The API/UI can reuse these rules without changing existing loading reminders prematurely.
 */
export const checklistStatuses = [
  'pending', 'loaded', 'not_required', 'not_required_for_job',
] as const;
export type ChecklistStatus = (typeof checklistStatuses)[number];

export type SmartChecklistItem = {
  id: string;
  jobId: string;
  description: string;
  category: 'tool' | 'material';
  status: ChecklistStatus;
  reason: string | null;
};

export type ChecklistDecision = {
  status: ChecklistStatus;
  reason?: string | null;
};

export function applyChecklistDecision(
  item: SmartChecklistItem,
  decision: ChecklistDecision,
): SmartChecklistItem {
  if (!checklistStatuses.includes(decision.status)) {
    throw new Error('Invalid checklist status');
  }
  const reason = decision.reason?.trim() || null;
  if (decision.status === 'not_required_for_job' && !reason) {
    throw new Error('Explain why this item is not required for this particular job');
  }
  return {
    ...item,
    status: decision.status,
    reason: decision.status === 'not_required_for_job' ? reason : null,
  };
}

export function checklistIsResolved(items: SmartChecklistItem[]): boolean {
  // Empty lists must not trigger spurious repeat reminders.
  return items.every((item) => item.status !== 'pending');
}

export function unresolvedItems(items: SmartChecklistItem[]): SmartChecklistItem[] {
  return items.filter((item) => item.status === 'pending');
}

/** Job-only decisions must not alter suggestions for other jobs. */
export function shouldSuggestOnJob(
  item: Pick<SmartChecklistItem, 'jobId' | 'status'>,
  proposedJobId: string,
): boolean {
  return item.status !== 'not_required_for_job' || item.jobId !== proposedJobId;
}

/** Simple deterministic starter suggestions; never automatically append to saved lists. */
export type Suggestion = { category: 'tool' | 'material'; description: string; why: string };
const ACTIVITY_HINTS: Array<{ match: RegExp; suggestions: Suggestion[] }> = [
  {
    match: /bluestone|stone paving|lay(?:ing)? pavers?/i,
    suggestions: [
      { category: 'tool', description: 'Wet saw', why: 'Cutting stone or perimeter pieces' },
      { category: 'tool', description: '5 mm spacers', why: 'Maintain joint width' },
      { category: 'material', description: 'Stone adhesive', why: 'Bonding paving to prepared slab' },
    ],
  },
  {
    match: /irrigation|sprinklers?|dripline/i,
    suggestions: [
      { category: 'tool', description: 'Pipe cutters', why: 'Cutting irrigation pipe' },
      { category: 'material', description: 'Irrigation connectors', why: 'Joining pipe and fittings' },
    ],
  },
  {
    match: /concret(?:e|ing)|pour(?:ing)? slab/i,
    suggestions: [
      { category: 'tool', description: 'Bull float', why: 'Finishing fresh concrete' },
      { category: 'material', description: 'Ableflex', why: 'Isolation against adjacent structures, where applicable' },
    ],
  },
];

export function suggestChecklistItems(
  activity: string,
  existingDescriptions: string[],
): Suggestion[] {
  const known = new Set(existingDescriptions.map((s) => s.trim().toLowerCase()));
  return ACTIVITY_HINTS.flatMap(({ match, suggestions }) => match.test(activity) ? suggestions : [])
    .filter((suggestion) => !known.has(suggestion.description.toLowerCase()))
    .filter((suggestion, index, all) =>
      all.findIndex((s) => s.description.toLowerCase() === suggestion.description.toLowerCase()) === index);
}
