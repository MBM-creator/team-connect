'use client';

import { useEffect, useState } from 'react';
import type { DailyPlanApi, DailyPlanChecklistStatus } from '@/lib/daily-plan-shared';

type ChecklistItem = {
  id: string;
  description: string;
  quantity?: string | null;
  checklistStatus: DailyPlanChecklistStatus;
  checklistReason: string | null;
};
const choices: { value: DailyPlanChecklistStatus; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'loaded', label: 'Loaded' },
  { value: 'not_required', label: 'Not required' },
  { value: 'not_required_for_job', label: 'Not required for this particular job' },
];

export default function SavedDailyPlanChecklist({
  plan, orgSlug, jobId, onPlanUpdated,
}: {
  plan: DailyPlanApi;
  orgSlug: string;
  jobId: string;
  onPlanUpdated: (next: DailyPlanApi) => void;
}) {
  const [reasonTarget, setReasonTarget] = useState<{ kind: 'materials' | 'equipment'; id: string } | null>(null);
  const [reasonText, setReasonText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  useEffect(() => { setError(''); setSuccess(''); setReasonTarget(null); }, [plan.id]);
  const all = [...plan.materials, ...plan.equipment];
  const unresolved = all.filter(item => item.checklistStatus === 'pending').length;

  async function persist(kind: 'materials' | 'equipment', item: ChecklistItem,
    status: DailyPlanChecklistStatus, reason?: string) {
    if (status === 'not_required_for_job' && !reason?.trim()) {
      setError('Enter a reason before marking this item not required for this job.');
      return;
    }
    setBusy(item.id);
    setError('');
    setSuccess('');
    try {
      const response = await fetch(
        `/api/jobs/${encodeURIComponent(jobId)}/daily-plans/${encodeURIComponent(plan.id)}/checklist/${kind}/${encodeURIComponent(item.id)}?orgSlug=${encodeURIComponent(orgSlug)}`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status, reason: reason?.trim() ?? null }) },
      );
      const data = await response.json() as {
        ok?: boolean; message?: string;
        item?: { checklistStatus: DailyPlanChecklistStatus; checklistReason: string | null };
      };
      if (!response.ok || !data.ok || !data.item) {
        throw new Error(data.message || 'Could not update checklist item');
      }
      const key = kind === 'materials' ? 'materials' : 'equipment';
      onPlanUpdated({
        ...plan,
        [key]: plan[key].map(row => row.id === item.id
          ? { ...row, checklistStatus: data.item!.checklistStatus, checklistReason: data.item!.checklistReason }
          : row),
      });
      setReasonTarget(null);
      setReasonText('');
      setSuccess(`${item.description}: saved`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save checklist item');
    } finally {
      setBusy(null);
    }
  }

  function choose(kind: 'materials' | 'equipment', item: ChecklistItem,
    status: DailyPlanChecklistStatus) {
    if (status === 'not_required_for_job') {
      setReasonTarget({ kind, id: item.id });
      setReasonText(item.checklistReason ?? '');
      setError('');
      return;
    }
    setReasonTarget(null);
    void persist(kind, item, status);
  }

  function renderGroup(kind: 'materials' | 'equipment', title: string, items: ChecklistItem[]) {
    return items.length ? <div className="space-y-3">
      <h3 className="font-semibold text-gray-900">{title}</h3>
      {items.map(item => (
        <div key={item.id} className="space-y-2 rounded-lg border border-gray-200 bg-white p-3">
          <div className="font-medium text-gray-900">{item.description}
            {item.quantity ? <span className="ml-2 text-gray-600">— {item.quantity}</span> : null}
          </div>
          <label className="block text-sm">Loading status
            <select className="mt-1 w-full rounded-lg border border-gray-300 bg-white p-3 text-gray-900"
              value={item.checklistStatus} disabled={busy !== null || plan.status === 'completed'}
              onChange={e => choose(kind, item, e.target.value as DailyPlanChecklistStatus)}>
              {choices.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
            </select>
          </label>
          {item.checklistStatus === 'not_required_for_job' && (
            <p className="text-sm text-gray-600">Why: {item.checklistReason}</p>
          )}
          {reasonTarget?.id === item.id && reasonTarget.kind === kind && (
            <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
              <label className="block text-sm font-medium">
                Why is this not required for this particular job? (required)
                <textarea className="mt-1 w-full rounded-lg border bg-white p-2 text-gray-900"
                  value={reasonText} onChange={e => setReasonText(e.target.value)}
                  rows={2} maxLength={1000} />
              </label>
              <div className="flex gap-2">
                <button type="button" disabled={busy !== null || !reasonText.trim()}
                  className="rounded-lg bg-sc-euca px-3 py-2 text-white disabled:opacity-50"
                  onClick={() => void persist(kind, item, 'not_required_for_job', reasonText)}>
                  Save explanation
                </button>
                <button type="button" className="rounded-lg border px-3 py-2"
                  onClick={() => { setReasonTarget(null); setError(''); }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div> : null;
  }

  if (!all.length) return null;
  return <section className="space-y-4 rounded-xl border border-sc-euca/30 bg-sc-euca-tint p-4">
    <h2 className="text-base font-semibold text-gray-900">Tools and materials loading checklist</h2>
    <p className="text-sm text-gray-700">
      {unresolved === 0 ? 'All items resolved.' : `${unresolved} item(s) pending.`}
      {' '}Mark items as loaded or not required. Job-specific exclusions require a reason.
    </p>
    {renderGroup('equipment', 'Tools and equipment', plan.equipment)}
    {renderGroup('materials', 'Materials', plan.materials)}
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-2 text-red-800">{error}</p>}
    {success && <p role="status" className="text-sm font-medium text-green-800">{success}</p>}
    <p className="text-xs text-gray-600">
      Changes are saved immediately. The current morning reminder emails still use the separate whole-list confirmation.
    </p>
  </section>;
}
