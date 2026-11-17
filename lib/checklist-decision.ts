import type { DailyPlanChecklistStatus } from '@/lib/daily-plan-shared';

const statuses: DailyPlanChecklistStatus[] = [
  'pending', 'loaded', 'not_required', 'not_required_for_job',
];

export function parseChecklistDecision(raw: unknown):
  | { ok: true; status: DailyPlanChecklistStatus; reason: string | null }
  | { ok: false; message: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, message: 'Invalid checklist update' };
  const input = raw as Record<string, unknown>;
  if (!statuses.includes(input.status as DailyPlanChecklistStatus)) {
    return { ok: false, message: 'Invalid checklist status' };
  }
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (input.status === 'not_required_for_job' && !reason) {
    return { ok: false, message: 'Explain why this item is not required for this particular job' };
  }
  if (reason.length > 1000) return { ok: false, message: 'Reason is too long' };
  return {
    ok: true,
    status: input.status as DailyPlanChecklistStatus,
    reason: input.status === 'not_required_for_job' ? reason : null,
  };
}
