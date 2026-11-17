'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  applyChecklistDecision, checklistIsResolved, suggestChecklistItems,
  type ChecklistStatus, type SmartChecklistItem,
} from '@/lib/smart-checklist';

const STORAGE_KEY = 'team-connect-smart-checklist-pilot-v2';
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

function validItem(value: unknown): value is SmartChecklistItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<SmartChecklistItem>;
  return typeof item.id === 'string' && typeof item.jobId === 'string' &&
    typeof item.description === 'string' && (item.category === 'tool' || item.category === 'material') &&
    options.some(option => option.value === item.status) &&
    (item.status !== 'not_required_for_job' ||
      (typeof item.reason === 'string' && item.reason.trim().length > 0));
}

export default function SmartChecklistPilot() {
  const [items, setItems] = useState<SmartChecklistItem[]>(initial);
  const [activity, setActivity] = useState('Lay bluestone paving');
  const [newItem, setNewItem] = useState('');
  const [newCategory, setNewCategory] = useState<'tool' | 'material'>('tool');
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reasonText, setReasonText] = useState('');
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          const data = parsed as { activity?: unknown; items?: unknown; savedAt?: unknown };
          if (typeof data.activity === 'string' && Array.isArray(data.items) &&
              data.items.every(validItem)) {
            setActivity(data.activity);
            setItems(data.items);
            setSavedSnapshot(JSON.stringify({ activity: data.activity, items: data.items }));
            if (typeof data.savedAt === 'string') setSavedAt(data.savedAt);
          }
        }
      }
    } catch {
      // Corrupt or blocked storage falls back to sample data.
    }
    setReady(true);
  }, []);

  const currentSnapshot = JSON.stringify({ activity, items });
  const dirty = currentSnapshot !== savedSnapshot;
  const proposed = useMemo(() =>
    suggestChecklistItems(activity, items.map(item => item.description)), [activity, items]);
  const pending = items.filter(item => item.status === 'pending').length;

  function addItem(description: string, category: 'tool' | 'material') {
    const trimmed = description.trim();
    if (!trimmed) { setError('Enter an item to add.'); return; }
    if (items.some(item => item.description.trim().toLowerCase() === trimmed.toLowerCase())) {
      setError('This item is already on the checklist.'); return;
    }
    setItems(old => [...old, {
      id: crypto.randomUUID(), jobId: 'demo-job', description: trimmed,
      category, status: 'pending', reason: null,
    }]);
    setNewItem('');
    setError('');
  }

  function changeStatus(id: string, status: ChecklistStatus) {
    if (status === 'not_required_for_job') {
      const current = items.find(item => item.id === id);
      setReasonFor(id);
      setReasonText(current?.reason ?? '');
      setError('');
      return;
    }
    setItems(old => old.map(item => item.id === id ? applyChecklistDecision(item, { status }) : item));
    if (reasonFor === id) setReasonFor(null);
    setError('');
  }

  function confirmReason() {
    if (!reasonText.trim()) { setError('Enter why this item is not required for this job.'); return; }
    setItems(old => old.map(item => item.id === reasonFor ?
      applyChecklistDecision(item, { status: 'not_required_for_job', reason: reasonText }) : item));
    setReasonFor(null);
    setReasonText('');
    setError('');
  }

  function save() {
    if (reasonFor) {
      setError('Save or cancel the job-specific explanation before saving the checklist.');
      return;
    }
    try {
      const timestamp = new Date().toISOString();
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ activity, items, savedAt: timestamp }));
      setSavedSnapshot(currentSnapshot);
      setSavedAt(timestamp);
      setError('');
    } catch {
      setError('This browser could not save the test. Please check browser storage settings.');
    }
  }

  function reset() {
    try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    setItems(initial.map(item => ({ ...item })));
    setActivity('Lay bluestone paving');
    setNewItem('');
    setReasonFor(null);
    setReasonText('');
    setError('');
    setSavedAt(null);
    setSavedSnapshot('');
  }

  return <div className="space-y-6 text-gray-900">
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm">
      <strong>TEST ONLY.</strong> Click <strong>Save test checklist</strong> to keep your changes in this
      browser, including after refreshing the page. Nothing is written to actual jobs or sent by email.
    </div>

    <label className="block space-y-2">
      <span className="font-semibold">Sample activity (editable)</span>
      <input className="w-full rounded-lg border p-3" value={activity}
        onChange={event => setActivity(event.target.value)} />
    </label>

    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Checklist ({items.length} items)</h2>
      {items.map(item => <div key={item.id} className="space-y-3 rounded-xl border bg-white p-4">
        <p className="font-semibold">{item.description}
          <span className="ml-2 text-sm font-normal text-gray-500">({item.category})</span></p>
        <label className="block text-sm">Status
          <select className="mt-1 w-full rounded-lg border p-3" value={item.status}
            onChange={event => changeStatus(item.id, event.target.value as ChecklistStatus)}>
            {options.map(option => <option key={option.value} value={option.value}>
              {option.title}</option>)}
          </select>
        </label>
        {reasonFor === item.id && <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <label className="block text-sm font-semibold">
            Why is this not required for this particular job? (required)
            <textarea className="mt-2 w-full rounded-lg border bg-white p-3 font-normal" rows={2}
              placeholder="e.g. already on site or supplied by subcontractor"
              value={reasonText} onChange={event => setReasonText(event.target.value)} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={confirmReason}
              className="rounded-lg bg-[#698F00] px-4 py-2 text-sm font-semibold text-white">
              Save explanation
            </button>
            <button type="button" onClick={() => { setReasonFor(null); setReasonText(''); setError(''); }}
              className="rounded-lg border px-4 py-2 text-sm">Cancel</button>
          </div>
        </div>}
        {item.status === 'not_required_for_job' && <p className="text-sm text-gray-600">
          Reason: {item.reason}</p>}
      </div>)}
    </section>


    <section className="rounded-xl border bg-white p-4">
      <h2 className="mb-2 text-lg font-semibold">Suggested missing items</h2>
      {proposed.length === 0 ? <p className="text-sm text-gray-600">
        No further suggestions for this activity. You can always add your own item below.
      </p> : proposed.map(s => <div key={s.description}
        className="flex items-center justify-between gap-3 border-t py-3 first:border-t-0">
        <div><p className="font-medium">{s.description}</p>
          <p className="text-sm text-gray-600">{s.why}</p></div>
        <button type="button" className="shrink-0 rounded-lg bg-[#698F00] px-4 py-2 text-sm text-white"
          onClick={() => addItem(s.description, s.category)}>+ Add</button>
      </div>)}
    </section>


    <section className="rounded-xl border bg-white p-4">
      <h2 className="mb-2 text-lg font-semibold">Add your own tool or material</h2>
      <p className="mb-3 text-sm text-gray-600">Type any item you think is missing.</p>
      <form onSubmit={event => { event.preventDefault(); addItem(newItem, newCategory); }}
        className="flex flex-wrap gap-2">
        <input aria-label="Tool or material name" className="min-w-40 flex-1 rounded-lg border p-3"
          placeholder="e.g. spare diamond blade" value={newItem}
          onChange={event => setNewItem(event.target.value)} />
        <select aria-label="Item category" className="rounded-lg border p-3"
          value={newCategory} onChange={event => setNewCategory(event.target.value as 'tool' | 'material')}>
          <option value="tool">Tool</option><option value="material">Material</option>
        </select>
        <button type="submit" className="rounded-lg bg-[#698F00] px-5 py-3 font-semibold text-white">
          + Add item
        </button>
      </form>
    </section>


    <section className="space-y-3 rounded-xl border bg-gray-50 p-4">
      <p className="font-semibold">{checklistIsResolved(items) ?
        'All items resolved — reminders would stop' :
        `${pending} pending item(s) — reminders would continue`}</p>
      <p className="text-sm text-gray-600">Reminder behaviour is simulated; no emails are sent.</p>
      {error && <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
        {error}</p>}
      {savedAt && !dirty && <p role="status" className="text-sm font-medium text-green-800">
        Saved on this device. You can refresh this page and your test items will remain.
      </p>}
      <button type="button" onClick={save} disabled={!ready}
        className="w-full rounded-lg bg-[#698F00] px-5 py-3 font-semibold text-white disabled:opacity-50">
        Save test checklist
      </button>
      <button type="button" onClick={reset} className="rounded-lg border px-4 py-2 text-sm">
        Reset sample checklist
      </button>
    </section>
  </div>;
}
