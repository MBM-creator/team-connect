'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ClientConnectJobSummary } from '@/components/ClientConnectJobSummary';
import type { SignoffQaSetupV1 } from '@/lib/signoff-qa-v1-types';
import type { SignoffSectionUiState } from '@/lib/signoff-qa-v1-graph';
import {
  findActiveQaSectionCode,
  resolveQaSectionCardTone,
} from '@/lib/qa-section-card-style';
import { QaSectionCard } from '@/components/QaSectionCard';

interface JobContext {
  cc_project_id?: string | null;
  cc_client_id?: string | null;
  cc_project_title_snapshot?: string | null;
  cc_client_name_snapshot?: string | null;
}

const STATUS_CONFIG: Record<string, { label: string; pill: string }> = {
  pending: { label: 'Pending', pill: 'bg-gray-100 text-gray-600' },
  submitted: { label: 'Submitted', pill: 'bg-blue-50 text-blue-800' },
  cleared: { label: 'Cleared', pill: 'bg-green-50 text-green-800' },
  issue_raised: { label: 'Issue raised', pill: 'bg-red-50 text-red-800' },
  rectification_required: { label: 'Rectification required', pill: 'bg-red-50 text-red-800' },
  rectified_awaiting_supervisor: { label: 'Awaiting supervisor', pill: 'bg-amber-50 text-amber-900' },
  supervisor_approved_to_proceed: { label: 'Approved to proceed', pill: 'bg-[#698F00]/10 text-[#4f6f00]' },
  blocked_by_unresolved_issue: { label: 'Blocked', pill: 'bg-amber-50 text-amber-900' },
};

export default function SignOffQaRunOverviewPage() {
  const params = useParams();
  const orgSlug = (params?.orgSlug as string) ?? '';
  const jobId = (params?.jobId as string) ?? '';
  const runId = (params?.runId as string) ?? '';

  const [setup, setSetup] = useState<SignoffQaSetupV1 | null>(null);
  const [sectionStates, setSectionStates] = useState<SignoffSectionUiState[]>([]);
  const [job, setJob] = useState<JobContext | null>(null);
  const [runStatus, setRunStatus] = useState('');
  const [finalAt, setFinalAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgSlug || !jobId || !runId) return;
    let cancelled = false;
    fetch(`/api/jobs/${jobId}/qa/runs/${runId}?orgSlug=${encodeURIComponent(orgSlug)}`)
      .then((r) => r.json().then((d) => ({ r, d })))
      .then(({ r, d }) => {
        if (cancelled) return;
        if (!r.ok || d.qaType !== 'sign_off') {
          setError(typeof d?.message === 'string' ? d.message : 'Failed to load supervisor sign-off');
          return;
        }
        setJob(d.job && typeof d.job === 'object' ? d.job : null);
        setRunStatus(String(d.run?.status ?? ''));
        setFinalAt(d.run?.supervisor_final_approved_at ?? null);
        setSetup(d.setup as SignoffQaSetupV1);
        setSectionStates(Array.isArray(d.sectionStates) ? d.sectionStates : []);
      })
      .catch(() => setError('Failed to load supervisor sign-off'))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orgSlug, jobId, runId]);

  const activeSectionCode = findActiveQaSectionCode(sectionStates, (section) => section.code);

  function sectionActivated(section: SignoffSectionUiState): boolean {
    return (
      Boolean(section.submissionStatus || section.submittedAt) ||
      ['submitted', 'issue_raised', 'rectification_required', 'rectified_awaiting_supervisor', 'supervisor_approved_to_proceed'].includes(
        section.status
      )
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <Link href={`/t/${orgSlug}/jobs/${jobId}/qa`} className="text-sm text-[#698F00] hover:underline">
          ← QA checks
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">Supervisor sign-off</h1>
        <p className="text-sm text-gray-600 mt-1">Status: {runStatus || '…'}</p>
        {job && <ClientConnectJobSummary job={job} compact className="mt-1" />}
        {finalAt && <p className="text-sm text-[#698F00] mt-1">Final approval recorded.</p>}
        {error && <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">{error}</div>}
        {loading && <p className="mt-4 text-gray-600">Loading…</p>}

        {!loading && !error && setup && (
          <div className="mt-6 space-y-4">
            {(setup.scope_description || setup.supervisor_notes) && (
              <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm space-y-3">
                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Setup summary</h2>
                <dl className="space-y-2 text-sm">
                  {setup.scope_description && (
                    <div className="flex flex-col sm:flex-row sm:gap-4">
                      <dt className="text-gray-500 sm:w-44 shrink-0">Scope</dt>
                      <dd className="font-medium text-gray-900">{setup.scope_description}</dd>
                    </div>
                  )}
                  {setup.supervisor_notes && (
                    <div className="flex flex-col sm:flex-row sm:gap-4">
                      <dt className="text-gray-500 sm:w-44 shrink-0">Supervisor notes</dt>
                      <dd className="font-medium text-gray-900">{setup.supervisor_notes}</dd>
                    </div>
                  )}
                </dl>
              </div>
            )}

            <div>
              <h2 className="text-sm font-semibold text-gray-700 mb-2">Sign-off section</h2>
              <ul className="space-y-2">
                {sectionStates.map((section, index) => {
                  const cfg = STATUS_CONFIG[section.status] ?? STATUS_CONFIG.pending;
                  const cardTone = resolveQaSectionCardTone({
                    cleared: section.cleared,
                    activated: sectionActivated(section),
                    isActiveStep: section.code === activeSectionCode,
                  });
                  return (
                    <QaSectionCard key={section.code} tone={cardTone}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0">
                          <span className="mt-0.5 flex-none w-6 h-6 rounded-full bg-gray-100 text-gray-500 text-xs font-medium flex items-center justify-center">{index + 1}</span>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-gray-900">{section.title}</p>
                            <p className="text-xs text-gray-500 mt-0.5">{section.description}</p>
                          </div>
                        </div>
                        <span className={`flex-none px-2 py-0.5 text-xs rounded-full whitespace-nowrap ${cfg.pill}`}>{cfg.label}</span>
                      </div>
                      {!section.cleared && section.clearReasons.length > 0 && (
                        <ul className="mt-2 text-xs text-gray-600 list-disc pl-10 space-y-0.5">
                          {section.clearReasons.slice(0, 4).map((r) => <li key={r}>{r}</li>)}
                        </ul>
                      )}
                      <Link href={`/t/${orgSlug}/jobs/${jobId}/qa/sign-off/${runId}/${encodeURIComponent(section.code)}`} className="mt-3 inline-block text-xs text-[#698F00] font-medium hover:underline pl-9">
                        Open section →
                      </Link>
                    </QaSectionCard>
                  );
                })}
              </ul>
            </div>

            <div className="flex flex-wrap items-center gap-4 pt-2">
              <Link href={`/t/${orgSlug}/jobs/${jobId}/qa/sign-off/${runId}/supervisor`} className="text-sm font-medium text-[#698F00] hover:underline">Supervisor →</Link>
              <Link href={`/t/${orgSlug}/jobs/${jobId}/qa`} className="text-sm text-[#698F00] hover:underline">← Back to QA hub</Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
