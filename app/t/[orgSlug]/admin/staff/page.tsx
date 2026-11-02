'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { StaffRole } from '@/lib/staff-auth';

interface StaffRow {
  id: string;
  full_name: string;
  email: string;
  role: StaffRole;
  active: boolean;
}

const ROLES: StaffRole[] = ['field', 'supervisor', 'admin'];

export default function AdminStaffPage() {
  const params = useParams();
  const orgSlug = (params?.orgSlug as string) ?? '';

  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<StaffRole>('field');
  const [password, setPassword] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!orgSlug) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/staff?orgSlug=${encodeURIComponent(orgSlug)}`);
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data?.message === 'string' ? data.message : 'Failed to load staff');
        return;
      }
      setStaff(Array.isArray(data.staff) ? data.staff : []);
    } catch {
      setError('Failed to load staff');
    } finally {
      setLoading(false);
    }
  }, [orgSlug]);

  useEffect(() => {
    load();
  }, [load]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/staff?orgSlug=${encodeURIComponent(orgSlug)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName, email, role, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data?.message === 'string' ? data.message : 'Failed to create staff');
        return;
      }
      setCreateOpen(false);
      setFullName('');
      setEmail('');
      setPassword('');
      setRole('field');
      await load();
    } catch {
      setError('Failed to create staff');
    } finally {
      setCreating(false);
    }
  }

  async function patchStaff(id: string, patch: { fullName?: string; role?: StaffRole; active?: boolean }) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/staff?orgSlug=${encodeURIComponent(orgSlug)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...patch }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data?.message === 'string' ? data.message : 'Update failed');
        return;
      }
      await load();
    } catch {
      setError('Update failed');
    } finally {
      setBusyId(null);
    }
  }

  const activeAdminCount = staff.filter((s) => s.active && s.role === 'admin').length;

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-3xl mx-auto">
        <Link href={`/t/${orgSlug}/jobs`} className="text-sm text-[#698F00] hover:underline">
          ← Jobs
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">Staff</h1>
        <p className="text-sm text-gray-600 mt-1">Manage field, supervisor, and admin accounts.</p>

        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={() => setCreateOpen((v) => !v)}
          className="mt-6 px-4 py-2 bg-[#698F00] text-white rounded-lg text-sm font-medium"
        >
          {createOpen ? 'Cancel' : 'Add staff member'}
        </button>

        {createOpen && (
          <form onSubmit={onCreate} className="mt-4 bg-white border border-gray-200 rounded-lg p-4 space-y-3">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Full name</label>
              <input
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Email</label>
              <input
                type="email"
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Role</label>
              <select
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                value={role}
                onChange={(e) => setRole(e.target.value as StaffRole)}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Temporary password (min 8 chars)</label>
              <input
                type="password"
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required
              />
            </div>
            <button
              type="submit"
              disabled={creating}
              className="px-4 py-2 bg-[#698F00] text-white rounded-lg text-sm font-medium disabled:bg-gray-400"
            >
              {creating ? 'Creating…' : 'Create staff account'}
            </button>
          </form>
        )}

        {loading && <p className="mt-6 text-gray-600">Loading…</p>}

        {!loading && (
          <ul className="mt-6 space-y-3">
            {staff.map((s) => {
              const isLastActiveAdmin = s.active && s.role === 'admin' && activeAdminCount <= 1;

              return (
                <li
                  key={s.id}
                  className={`border rounded-lg p-4 bg-white text-sm ${s.active ? 'border-gray-200' : 'border-gray-300 opacity-75'}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-gray-900">{s.full_name}</p>
                      <p className="text-gray-600">{s.email}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        {s.role}
                        {!s.active && ' · deactivated'}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <select
                        className="border border-gray-300 rounded px-2 py-1 text-xs"
                        value={s.role}
                        disabled={busyId === s.id || isLastActiveAdmin}
                        onChange={(e) => patchStaff(s.id, { role: e.target.value as StaffRole })}
                        title={isLastActiveAdmin ? 'Cannot change the last active admin' : undefined}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={busyId === s.id || isLastActiveAdmin}
                        className="px-2 py-1 text-xs border rounded hover:bg-gray-50"
                        onClick={() => patchStaff(s.id, { active: !s.active })}
                        title={isLastActiveAdmin ? 'Cannot deactivate the last active admin' : undefined}
                      >
                        {s.active ? 'Deactivate' : 'Reactivate'}
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
