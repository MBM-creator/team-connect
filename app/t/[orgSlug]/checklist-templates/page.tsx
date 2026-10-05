'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { formatAustralianDate } from '@/lib/australian-date';

interface ChecklistTemplate {
  id: string;
  organisation_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export default function ChecklistTemplatesListPage() {
  const params = useParams();
  const orgSlug = (params?.orgSlug as string) ?? '';

  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgSlug) {
      return;
    }

    let cancelled = false;

    fetch(`/api/checklist-templates?orgSlug=${encodeURIComponent(orgSlug)}`)
      .then((res) => res.json().then((data) => ({ res, data })))
      .then(({ res, data }) => {
        if (cancelled) return;
        if (!res.ok) {
          setError(typeof data?.message === 'string' ? data.message : 'Failed to load templates');
          return;
        }
        if (data?.ok && Array.isArray(data.templates)) {
          setTemplates(data.templates);
          setError(null);
        } else {
          setError('Invalid response');
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load templates');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [orgSlug]);

  function formatDate(iso: string): string {
    return formatAustralianDate(iso);
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Checklist templates</h1>
          {orgSlug && (
            <Link
              href={`/t/${orgSlug}/checklist-templates/new`}
              className="px-4 py-2 bg-[#698F00] text-white rounded-lg font-medium hover:bg-[#5a7d00] transition-colors"
            >
              New template
            </Link>
          )}
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-800">
            {error}
          </div>
        )}

        {loading && (
          <p className="text-gray-600">Loading templates…</p>
        )}

        {!loading && !error && templates.length === 0 && (
          <p className="text-gray-600">No checklist templates yet.</p>
        )}

        {!loading && !error && templates.length > 0 && (
          <ul className="space-y-3">
            {templates.map((t) => (
              <li
                key={t.id}
                className="p-4 bg-white border border-gray-200 rounded-lg shadow-sm"
              >
                <Link
                  href={`/t/${orgSlug}/checklist-templates/${t.id}`}
                  className="block font-medium text-gray-900 hover:text-[#698F00]"
                >
                  {t.name}
                </Link>
                {t.updated_at && (
                  <span className="block mt-1 text-sm text-gray-500">
                    Updated {formatDate(t.updated_at)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
