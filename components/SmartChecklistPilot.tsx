'use client';

import { useMemo, useState } from 'react';
import {
  applyChecklistDecision, checklistIsResolved, suggestChecklistItems,
  type ChecklistStatus, type SmartChecklistItem,
} from '@/lib/smart-checklist';

const initial: SmartChecklistItem[] = [
  { id: 'saw', jobId: 'demo-job', description: 'Wet saw', category: 'tool', status: 'pending', reason: null },
  { id: 'adhesive', jobId: 'demo-job', description: 'Stone adhesive', category: 'material', status: 'pending', reason: null },
  { id: 'spacers', jobId: 'demo-job', description: '5 mm spacers', category: 'tool', status: 'pending', reason: null },
];
const options: { value: ChecklistStatus; title: string }[] = [
  { value: 'pending', title: 'Pending' },
  { value: 'loaded', title: 'Loaded' },
  { value: 'not_required', title: 'Not required' },
  { value: 'not_required_for_job', title: 'Not required for this particular job' },
];

export default function SmartChecklistPilot() {
  const [items, setItems] = useState<SmartChecklistItem[]>(initial);
  const [activity, setActivity] = useState('Lay bluestone paving');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const proposed = useMemo(() =>
    suggestChecklistItems(activity, items.map(item => item.description)), [activity, items]);
  const pending = items.filter(item => item.status === 'pending').length;

  function changeStatus(id: string, status: ChecklistStatus) {
    setItems(previous => previous.map(item => {
      if (item.id !== id) return item;
      if (status === 'not_required_for_job') {
        const reason = drafts[id] || item.reason || '';
        if (!reason.trim()) {
          setErrors(old => ({ ...old, [id]: 'Enter a reason before resolving this item.' }));
          return item;
        }
        setErrors(old => ({ ...old, [id]: '' }));
        return applyChecklistDecision(item, { status, reason });
      }
      setErrors(old => ({ ...old, [id]: '' }));
      return applyChecklistDecision(item, { status });
    }));
  }

  return <div className="space-y-6 text-gray-900">
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm">
      TEST ONLY — Your changes stay on this screen and are not saved or sent to the morning email.
    </div>
    <label className="block space-y-2">
      <span className="font-semibold">Tomorrow's activity</span>
      <input className="w-full rounded-lg border p-3" value={activity}
        onChange={event => setActivity(event.target.value)} />
    </label>
    {proposed.length > 0 && <section className="rounded-xl border p-4">
      <h2 className="mb-3 text-lg font-semibold">Suggested missing items</h2>
      {proposed.map(s => <div key={s.description} className="mb-3 flex items-center justify-between gap-3">
        <div><p className="font-medium">{s.description}</p><p className="text-sm text-gray-600">{s.why}</p></div>
        <button className="rounded-lg bg-[#698F00] px-3 py-2 text-sm text-white" onClick={() => setItems(old => [
          ...old, { id: `suggested-${s.description}`, jobId: 'demo-job', description: s.description,
            category: s.category, status: 'pending', reason: null },
        ])}>Add</button>
      </div>)}
    </section>}
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Tools and materials</h2>
      {items.map(item => <div key={item.id} className="space-y-3 rounded-xl border bg-white p-4">
        <p className="font-semibold">{item.description} <span className="text-sm font-normal text-gray-500">({item.category})</span></p>
        <label className="block text-sm">Status
          <select className="mt-1 w-full rounded-lg border p-3" value={item.status}
            onChange={event => changeStatus(item.id, event.target.value as ChecklistStatus)}>
            {options.map(option => <option key={option.value} value={option.value}>{option.title}</option>)}
          </select>
        </label>
        {(item.status === 'not_required_for_job' || errors[item.id]) && <label className="block text-sm">
          Why is this not required for this particular job?
          <textarea className="mt-1 w-full rounded-lg border p-3" rows={2}
            placeholder="For example, already on site, or supplied by the subcontractor"
            value={drafts[item.id] ?? item.reason ?? ''}
            onChange={event => setDrafts(old => ({ ...old, [item.id]: event.target.value }))} />
          <button className="mt-2 rounded-lg border px-3 py-2" onClick={() => changeStatus(item.id, 'not_required_for_job')}>
            Save explanation
          </button>
          {errors[item.id] && <p role="alert" className="mt-1 text-red-700">{errors[item.id]}</p>}
        </label>}
        {item.status === 'not_required_for_job' && <p className="text-sm text-gray-600">Recorded reason: {item.reason}</p>}
      </div>)}
    </section>
    <div className="rounded-xl border bg-gray-50 p-4">
      <p className="font-semibold">{checklistIsResolved(items) ? 'All items resolved — follow-ups would stop' :
        `${pending} pending item(s) — follow-up reminders would continue`}</p>
      <p className="mt-1 text-sm text-gray-600">Simulation only. No reminders are changed.</p>
      <button className="mt-3 rounded-lg border px-3 py-2" onClick={() => {
        setItems(initial); setDrafts({}); setErrors({});
      }}>Reset test</button>
    </div>
  </div>;
}
