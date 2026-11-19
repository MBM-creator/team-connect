'use client';

import { useEffect, useState } from 'react';
import type { DailyPlanApi, DailyPlanChecklistStatus } from '@/lib/daily-plan-shared';

type Kind = 'materials' | 'equipment';
type ChecklistItem = {
  id: string;
  description: string;
  quantity?: string | null;
  checklistStatus: DailyPlanChecklistStatus;
  checklistReason: string | null;
};
type Draft = { kind: Kind; id: string; status: DailyPlanChecklistStatus; reason: string | null };
const choices: { value: DailyPlanChecklistStatus; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'loaded', label: 'Loaded' },
  { value: 'not_required', label: 'Not required' },
];
const draftKey = (kind: Kind, id: string) => `${kind}:${id}`;

export default function SavedDailyPlanChecklist({
  plan, orgSlug, jobId, onPlanUpdated,
}: {
  plan: DailyPlanApi;
  orgSlug: string;
  jobId: string;
  onPlanUpdated: (next: DailyPlanApi) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [reasonTarget, setReasonTarget] = useState<{ kind: Kind; id: string } | null>(null);
  const [reasonText, setReasonText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  useEffect(() => {
    setDrafts({});
    setError('');
    setSuccess('');
    setReasonTarget(null);
    setReasonText('');
  }, [plan.id]);

  function current(kind: Kind, item: ChecklistItem): Draft {
    return drafts[draftKey(kind, item.id)] ?? {
      kind, id: item.id, status: item.checklistStatus, reason: item.checklistReason,
    };
  }

  function stage(kind: Kind, item: ChecklistItem, status: DailyPlanChecklistStatus, reason: string | null) {
    const key = draftKey(kind, item.id);
    setDrafts(previous => {
      const updated = { ...previous };
      if (status === item.checklistStatus && (reason ?? null) === (item.checklistReason ?? null)) {
        delete updated[key];
      } else {
        updated[key] = { kind, id: item.id, status, reason };
      }
      return updated;
    });
    setSuccess('');
    setError('');
  }

  function choose(kind: Kind, item: ChecklistItem, status: DailyPlanChecklistStatus) {
    if (status === 'not_required_for_job') {
      setReasonTarget({ kind, id: item.id });
      setReasonText(current(kind, item).reason ?? '');
      setError('');
      return;
    }
    setReasonTarget(null);
    setReasonText('');
    stage(kind, item, status, null);
  }

  function confirmReason(kind: Kind, item: ChecklistItem) {
    if (!reasonText.trim()) {
      setError('Enter why this item is not required for this job.');
      return;
    }
    stage(kind, item, 'not_required_for_job', reasonText.trim());
    setReasonTarget(null);
    setReasonText('');
  }

  const pendingChanges = Object.values(drafts);
  const unresolved = (['equipment', 'materials'] as const).reduce(
    (count, kind) => count + plan[kind].filter(item => current(kind, item).status === 'pending').length, 0,
  );

  async function saveAll() {
    if (saving || !pendingChanges.length || plan.status === 'completed') return;
    if (reasonTarget) {
      setError('Save or cancel the explanation before saving the checklist.');
      return;
    }
    setSaving(true);
    setError('');
    setSuccess('');
    const changes = [...pendingChanges];
    const results = await Promise.all(changes.map(async change => {
      try {
        const response = await fetch(
          `/api/jobs/${encodeURIComponent(jobId)}/daily-plans/${encodeURIComponent(plan.id)}/checklist/${change.kind}/${encodeURIComponent(change.id)}?orgSlug=${encodeURIComponent(orgSlug)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: change.status, reason: change.reason }),
          },
        );
        const data = await response.json() as {
          ok?: boolean; message?: string;
          item?: { checklistStatus: DailyPlanChecklistStatus; checklistReason: string | null };
        };
        if (!response.ok || !data.ok || !data.item) {
          throw new Error(data.message || 'Could not save checklist item');
        }
        return { change, saved: data.item, error: null as string | null };
      } catch (cause) {
        return {
          change, saved: null,
          error: cause instanceof Error ? cause.message : 'Could not save checklist item',
        };
      }
    }));
    const succeeded = results.filter(result => result.saved !== null);
    if (succeeded.length) {
      let updated = plan;
      for (const result of succeeded) {
        const key = result.change.kind;
        updated = {
          ...updated,
          [key]: updated[key].map(item => item.id === result.change.id
            ? { ...item, checklistStatus: result.saved!.checklistStatus,
                checklistReason: result.saved!.checklistReason }
            : item),
        };
      }
      onPlanUpdated(updated);
      setDrafts(previous => {
        const remaining = { ...previous };
        for (const result of succeeded) {
          const key = draftKey(result.change.kind, result.change.id);
          if (remaining[key]?.status === result.change.status &&
              remaining[key]?.reason === result.change.reason) delete remaining[key];
        }
        return remaining;
      });
    }
    const failures = results.filter(result => result.error !== null);
    if (failures.length) {
      setError(`${failures.length} item(s) could not be saved. Your selections remain on screen; retry Save changes. ${failures[0].error}`);
    } else {
      setSuccess(`${succeeded.length} checklist change(s) saved.`);
    }
    setSaving(false);
  }

  function renderGroup(kind: Kind, title: string, items: ChecklistItem[]) {
    return items.length ? <div className="space-y-3">
      <h3 className="font-semibold text-gray-900">{title}</h3>
      {items.map(item => {
        const selection = current(kind, item);
        const changed = !!drafts[draftKey(kind, item.id)];
        return <div key={item.id} className="space-y-2 rounded-lg border border-gray-200 bg-white p-3">
          <div className="font-medium text-gray-900">{item.description}
            {item.quantity ? <span className="ml-2 text-gray-600">— {item.quantity}</span> : null}
            {changed ? <span className="ml-2 text-xs text-amber-700">(unsaved)</span> : null}
          </div>
          <label className="block text-sm">Loading status
            <select className="mt-1 w-full rounded-lg border border-gray-300 bg-white p-3 text-gray-900"
              value={selection.status === 'not_required_for_job' ? 'not_required' : selection.status} disabled={saving || plan.status === 'completed'}
              onChange={event => choose(kind, item, event.target.value as DailyPlanChecklistStatus)}>
              {choices.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
            </select>
          </label>
          {selection.status === 'not_required_for_job' && (
            <p className="text-sm text-gray-600">Why: {selection.reason}</p>
          )}
          {reasonTarget?.id === item.id && reasonTarget.kind === kind && (
            <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
              <label className="block text-sm font-medium">
                Why is this not required for this particular job? (required)
                <textarea className="mt-1 w-full rounded-lg border bg-white p-2 text-gray-900"
                  value={reasonText} onChange={event => setReasonText(event.target.value)}
                  rows={2} maxLength={1000} />
              </label>
              <div className="flex gap-2">
                <button type="button" disabled={saving || !reasonText.trim()}
                  className="rounded-lg bg-sc-euca px-3 py-2 text-white disabled:opacity-50"
                  onClick={() => confirmReason(kind, item)}>
                  Apply explanation
                </button>
                <button type="button" disabled={saving} className="rounded-lg border px-3 py-2"
                  onClick={() => { setReasonTarget(null); setReasonText(''); setError(''); }}>Cancel</button>
              </div>
            </div>
          )}
        </div>;
      })}
    </div> : null;
  }

  if (!plan.materials.length && !plan.equipment.length) return null;
  return <section className="space-y-4 rounded-xl border border-sc-euca/30 bg-sc-euca-tint p-4">
    <h2 className="text-base font-semibold text-gray-900">Tools and materials loading checklist</h2>
    <p className="text-sm text-gray-700">
      {unresolved === 0 ? 'All items selected as resolved.' : `${unresolved} item(s) pending.`}
      {' '}Choose Loaded or Not required for each item, then save all changes at the bottom.
    </p>
    {renderGroup('equipment', 'Tools and equipment', plan.equipment)}
    {renderGroup('materials', 'Materials', plan.materials)}
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-2 text-red-800">{error}</p>}
    {success && <p role="status" className="text-sm font-medium text-green-800">{success}</p>}
    <button type="button" onClick={() => void saveAll()}
      disabled={saving || !pendingChanges.length || plan.status === 'completed'}
      className="w-full rounded-lg bg-sc-euca px-5 py-3 font-semibold text-white disabled:opacity-50">
      {saving ? 'Saving checklist…' : `Save checklist changes${pendingChanges.length ? ` (${pendingChanges.length})` : ''}`}
    </button>
    <p className="text-xs text-gray-600">
      Selections are instant and remain unsaved until you press Save. Leave this page only after saving.
      Morning reminder emails still use the separate whole-list confirmation.
    </p>
  </section>;
}
