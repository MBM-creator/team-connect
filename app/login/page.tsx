'use client';

import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';

function reasonMessage(reason: string | null): string | null {
  switch (reason) {
    case 'deactivated':
      return 'Your staff account has been deactivated. Contact an administrator.';
    case 'no_access':
      return 'You do not have a staff profile for this organisation.';
    case 'forbidden':
      return 'You do not have permission to access that page.';
    case 'no_org':
      return 'Organisation context is required.';
    case 'password_reset':
      return 'Your password has been updated. Sign in with your new password.';
    default:
      return null;
  }
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next') ?? '/';
  const reason = searchParams.get('reason');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const notice = useMemo(() => reasonMessage(reason), [reason]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) {
        setError(signInError.message);
        return;
      }
      router.push(next);
      router.refresh();
    } catch {
      setError('Sign in failed');
    } finally {
      setLoading(false);
    }
  }

  async function onSignOut() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white border border-gray-200 rounded-xl shadow-sm p-8">
        <h1 className="text-2xl font-bold text-gray-900">Staff sign in</h1>
        <p className="mt-2 text-sm text-gray-600">Use your organisation staff account.</p>

        {notice && (
          <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900">
            {notice}
          </div>
        )}

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              autoComplete="email"
              required
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              autoComplete="current-password"
              required
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">{error}</div>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#698F00] text-white py-2 rounded-lg font-medium disabled:bg-gray-400"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <a href="/forgot-password" className="mt-4 inline-block text-sm text-[#698F00] hover:underline">
          Forgot password?
        </a>

        {(reason === 'deactivated' || reason === 'forbidden') && (
          <button
            type="button"
            onClick={onSignOut}
            className="mt-4 w-full text-sm text-gray-600 underline"
          >
            Sign out and try another account
          </button>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
      <LoginForm />
    </Suspense>
  );
}
