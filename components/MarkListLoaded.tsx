'use client';

import { useState } from 'react';

export default function MarkListLoaded({ id, orgSlug, loadedAt }: { id: string; orgSlug: string; loadedAt: string | null }) {
  const [loaded, setLoaded] = useState(Boolean(loadedAt));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function confirm() {
    setSaving(true); setError('');
    try {
      const response = await fetch(`/api/loading-lists/${id}/loaded?orgSlug=${encodeURIComponent(orgSlug)}`, { method: 'POST' });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.message || 'Could not confirm loading');
      setLoaded(true);
    } catch (err) { setError(err instanceof Error ? err.message : 'Please try again'); }
    finally { setSaving(false); }
  }
  return <div className="space-y-3">
    {loaded ? <p role="status" className="rounded-lg bg-green-50 p-4 font-semibold text-green-800">Marked as loaded. Reminders for this list have stopped.</p>
      : <><p className="text-gray-700">Confirm once all tools, equipment and materials in this list are loaded.</p>
        <button type="button" disabled={saving} onClick={confirm} className="rounded-lg bg-[#698F00] px-6 py-3 font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Mark as loaded'}</button></>}
    {error && <p role="alert" className="text-red-700">{error}</p>}
  </div>;
}
