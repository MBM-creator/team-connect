'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface QaSectionCompleteActionsProps {
  orgSlug: string;
  jobId: string;
  runId: string;
  supervisorHref: string;
  qaHubHref: string;
  allSectionsCleared: boolean;
  alreadyFinalApproved: boolean;
}

export function QaSectionCompleteActions({
  orgSlug,
  jobId,
  runId,
  supervisorHref,
  qaHubHref,
  allSectionsCleared,
  alreadyFinalApproved,
}: QaSectionCompleteActionsProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const jobDetailHref = `/t/${orgSlug}/jobs/${jobId}`;

  async function handleSectionComplete() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/jobs/${jobId}/qa/runs/${runId}/final-approval?orgSlug=${encodeURIComponent(orgSlug)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'I confirm the work meets our standards.' }),
        }
      );
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setError(typeof data?.message === 'string' ? data.message : 'Could not complete section');
        return;
      }
      router.push(jobDetailHref);
    } catch {
      setError('Could not complete section');
    } finally {
      setBusy(false);
    }
  }

  if (alreadyFinalApproved) {
    return (
      <div className="space-y-3 pt-2">
        <p className="text-sm font-medium text-[#698F00]">Section complete.</p>
        <Link href={jobDetailHref} className="text-sm text-[#698F00] hover:underline">
          ← Back to job detail
        </Link>
      </div>
    );
  }

  if (allSectionsCleared) {
    return (
      <div className="space-y-3 pt-2">
        <button
          type="button"
          onClick={handleSectionComplete}
          disabled={busy}
          className="rounded-lg bg-[#698F00] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#5a7d00] disabled:cursor-not-allowed disabled:bg-gray-400"
        >
          {busy ? 'Completing…' : 'Section Complete'}
        </button>
        <p className="text-sm text-gray-600">I confirm the work meets our standards.</p>
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>
        )}
        <Link href={qaHubHref} className="inline-block text-sm text-[#698F00] hover:underline">
          ← Back to QA hub
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-4 pt-2">
      <Link href={supervisorHref} className="text-sm font-medium text-[#698F00] hover:underline">
        Supervisor →
      </Link>
      <Link href={qaHubHref} className="text-sm text-[#698F00] hover:underline">
        ← Back to QA hub
      </Link>
    </div>
  );
}
