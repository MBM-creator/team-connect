'use client';

import Link from 'next/link';
import { useState } from 'react';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(typeof data?.message === 'string' ? data.message : 'Unable to send reset email');
        return;
      }

      setMessage(
        typeof data?.message === 'string'
          ? data.message
          : 'If that email has a staff account, a reset link has been sent.'
      );
    } catch {
      setError('Unable to send reset email');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white border border-gray-200 rounded-xl shadow-sm p-8">
        <h1 className="text-2xl font-bold text-gray-900">Reset password</h1>
        <p className="mt-2 text-sm text-gray-600">
          Enter your staff email and we&apos;ll send a reset link.
        </p>

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

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">{error}</div>
          )}

          {message && (
            <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
              {message}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#698F00] text-white py-2 rounded-lg font-medium disabled:bg-gray-400"
          >
            {loading ? 'Sending…' : 'Send reset link'}
          </button>
        </form>

        <Link href="/login" className="mt-4 inline-block text-sm text-[#698F00] hover:underline">
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
