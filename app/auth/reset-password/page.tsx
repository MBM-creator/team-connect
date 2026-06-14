'use client';

import Link from 'next/link';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    async function establishSession() {
      const url = new URL(window.location.href);
      const code = url.searchParams.get('code');
      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          setError('This reset link is invalid or has expired. Request a new one.');
          return;
        }
        window.history.replaceState(null, '', '/auth/reset-password');
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();
      setReady(Boolean(session));
      if (!session) {
        setError('This reset link is invalid or has expired. Request a new one.');
      }
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        setReady(Boolean(session));
        if (session) {
          setError(null);
        }
      }
    });

    void establishSession();

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(updateError.message);
        return;
      }

      await supabase.auth.signOut();
      router.push('/login?reason=password_reset');
      router.refresh();
    } catch {
      setError('Unable to update password');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white border border-gray-200 rounded-xl shadow-sm p-8">
        <h1 className="text-2xl font-bold text-gray-900">Choose a new password</h1>
        <p className="mt-2 text-sm text-gray-600">Set a new password for your staff account.</p>

        {!ready && !error && <p className="mt-6 text-sm text-gray-600">Checking reset link…</p>}

        {ready && (
          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">New password</label>
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Confirm password</label>
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
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
              {loading ? 'Saving…' : 'Update password'}
            </button>
          </form>
        )}

        {!ready && error && (
          <div className="mt-6 space-y-4">
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">{error}</div>
            <Link href="/forgot-password" className="inline-block text-sm text-[#698F00] hover:underline">
              Request a new reset link
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
