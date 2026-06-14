'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { PavingQaSetupV2 } from '@/lib/paving-qa-v2-types';
import {
  PAVING_INSTALL_METHOD_LABELS_V2,
  PAVING_MATERIAL_TYPE_LABELS_V2,
  PAVING_AREA_USE_LABELS,
} from '@/lib/paving-qa-v2-types';
import { isOtherMixedMethod } from '@/lib/paving-qa-v2-catalog';
import type { V2SectionUiState } from '@/lib/paving-qa-v2-graph';
import { ClientConnectJobSummary } from '@/components/ClientConnectJobSummary';
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

export default function PavingQaRunOverviewPage() {
  const params = useParams();
  const orgSlug = (params?.orgSlug as string) ?? '';
  const jobId = (params?.jobId as string) ?? '';
  const runId = (params?.runId as string) ?? '';

  const [setup, setSetup] = useState<PavingQaSetupV2 | null>(null);
  const [sectionStates, setSectionStates] = useState<V2SectionUiState[]>([]);
  const [job, setJob] = useState<JobContext | null>(null);
  const [runStatus, setRunStatus] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgSlug || !jobId || !runId) return;
    let cancelled = false;
    fetch(`/api/jobs/${jobId}/qa/runs/${runId}?orgSlug=${encodeURIComponent(orgSlug)}`)
      .then((r) => r.json().then((d) => ({ r, d })))
      .then(({ r, d }) => {
        if (cancelled) return;
        if (!r.ok) {
          setError(typeof d?.message === 'string' ? d.message : 'Failed to load');
          return;
        }
        setJob(d.job && typeof d.job === 'object' ? d.job : null);
        setRunStatus(String(d.run?.status ?? ''));
        if (d.setup && typeof d.setup === 'object') {
          setSetup(d.setup as PavingQaSetupV2);
        }
        setSectionStates(Array.isArray(d.sectionStates) ? (d.sectionStates as V2SectionUiState[]) : []);
        setError(null);
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orgSlug, jobId, runId]);

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <Link href={`/t/${orgSlug}/jobs/${jobId}/qa`} className="text-sm text-[#698F00] hover:underline">
          ← Paving QA
        </Link>

        <div className="flex items-center gap-3 mt-2">
          <h1 className="text-2xl font-bold text-gray-900">QA run</h1>
          <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-[#698F00]/10 text-[#698F00] border border-[#698F00]/20">
            Paving QA v2
          </span>
        </div>

        <p className="text-sm text-gray-600 mt-1">Status: {runStatus || '…'}</p>
        {job && (
          <ClientConnectJobSummary
            job={job}
            compact
            className="mt-1"
            emptyText="No Client Connect project linked."
          />
        )}

        {error && (
          <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">{error}</div>
        )}
        {loading && <p className="mt-4 text-gray-600">Loading…</p>}

        {!loading && !error && setup && (
          <V2RunOverview
            setup={setup}
            sectionStates={sectionStates}
            orgSlug={orgSlug}
            jobId={jobId}
            runId={runId}
          />
        )}
      </div>
    </div>
  );
}

type StatusConfig = {
  label: string;
  pill: string;
};

const STATUS_CONFIG: Record<string, StatusConfig> = {
  pending:      { label: 'Pending',      pill: 'bg-gray-100 text-gray-500' },
  submitted:    { label: 'Submitted',    pill: 'bg-blue-50 text-blue-800' },
  cleared:      { label: 'Cleared',      pill: 'bg-green-50 text-green-800' },
  issue_raised: { label: 'Issue raised', pill: 'bg-red-50 text-red-800' },
  blocked:      { label: 'Blocked',      pill: 'bg-amber-50 text-amber-900' },
};

function V2RunOverview({
  setup,
  sectionStates,
  orgSlug,
  jobId,
  runId,
}: {
  setup: PavingQaSetupV2;
  sectionStates: V2SectionUiState[];
  orgSlug: string;
  jobId: string;
  runId: string;
}) {
  const otherMixed = isOtherMixedMethod(setup);
  const activeSectionCode = findActiveQaSectionCode(sectionStates, (s) => s.code);

  return (
    <div className="mt-6 space-y-4">
      <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm space-y-3">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Setup summary</h2>

        <dl className="space-y-2 text-sm">
          <div className="flex flex-col sm:flex-row sm:gap-4">
            <dt className="text-gray-500 sm:w-44 shrink-0">Install method</dt>
            <dd className="font-medium text-gray-900">
              {PAVING_INSTALL_METHOD_LABELS_V2[setup.install_method] ?? setup.install_method}
            </dd>
          </div>

          {setup.other_install_method_note && (
            <div className="flex flex-col sm:flex-row sm:gap-4">
              <dt className="text-gray-500 sm:w-44 shrink-0">Install method note</dt>
              <dd className="font-medium text-gray-900">{setup.other_install_method_note}</dd>
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:gap-4">
            <dt className="text-gray-500 sm:w-44 shrink-0">Material type</dt>
            <dd className="font-medium text-gray-900">
              {PAVING_MATERIAL_TYPE_LABELS_V2[setup.material_type] ?? setup.material_type}
            </dd>
          </div>

          <div className="flex flex-col sm:flex-row sm:gap-4">
            <dt className="text-gray-500 sm:w-44 shrink-0">Area uses</dt>
            <dd className="font-medium text-gray-900">
              {setup.area_uses.map((u) => PAVING_AREA_USE_LABELS[u] ?? u).join(', ')}
            </dd>
          </div>

          {setup.other_area_use_note && (
            <div className="flex flex-col sm:flex-row sm:gap-4">
              <dt className="text-gray-500 sm:w-44 shrink-0">Area use note</dt>
              <dd className="font-medium text-gray-900">{setup.other_area_use_note}</dd>
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

      {otherMixed && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900">
          <p className="font-semibold">Supervisor review required</p>
          <p className="mt-1">
            This run uses an other / mixed install method. Only universal QA sections are included
            until a supervisor or admin reviews the method and determines which additional sections apply.
          </p>
        </div>
      )}

      <div>
        <h2 className="text-sm font-semibold text-gray-700 mb-2">
          Applicable QA sections ({sectionStates.length})
        </h2>
        <ul className="space-y-2">
          {sectionStates.map((s, index) => {
            const cfg = STATUS_CONFIG[s.status] ?? STATUS_CONFIG.pending;
            const href = `/t/${orgSlug}/jobs/${jobId}/qa/paving/${runId}/${encodeURIComponent(s.code)}`;
            const cardTone = resolveQaSectionCardTone({
              cleared: s.cleared,
              activated:
                s.status === 'submitted' ||
                s.status === 'issue_raised' ||
                Boolean(s.submissionStatus),
              isActiveStep: s.code === activeSectionCode,
            });
            return (
              <QaSectionCard key={s.code} tone={cardTone}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <span className="mt-0.5 flex-none w-6 h-6 rounded-full bg-gray-100 text-gray-500 text-xs font-medium flex items-center justify-center">
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900">{s.title}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{s.description}</p>
                    </div>
                  </div>
                  <span className={`flex-none px-2 py-0.5 text-xs rounded-full whitespace-nowrap ${cfg.pill}`}>
                    {cfg.label}
                  </span>
                </div>

                {s.status === 'blocked' && s.blockedBy && s.blockedBy.length > 0 && (
                  <ul className="mt-2 text-xs text-amber-800 list-disc pl-10 space-y-0.5">
                    {s.blockedBy.map((b) => (
                      <li key={`${b.section}:${b.reason}`}>{b.reason}</li>
                    ))}
                  </ul>
                )}

                {s.status === 'submitted' && s.clearReasons.length > 0 && (
                  <ul className="mt-2 text-xs text-gray-600 list-disc pl-10 space-y-0.5">
                    {s.clearReasons.slice(0, 4).map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                )}

                {s.status === 'issue_raised' && (
                  <p className="mt-2 text-xs text-red-700 pl-9">
                    This section has an unresolved issue. Supervisor action required.
                  </p>
                )}

                <Link
                  href={href}
                  className="mt-3 inline-block text-xs text-[#698F00] font-medium hover:underline pl-9"
                >
                  {s.status === 'blocked' ? 'View blocking reasons →' : 'Open section →'}
                </Link>
              </QaSectionCard>
            );
          })}
        </ul>
      </div>

      <div className="flex flex-wrap items-center gap-4 pt-2">
        <Link
          href={`/t/${orgSlug}/jobs/${jobId}/qa/paving/${runId}/supervisor`}
          className="text-sm font-medium text-[#698F00] hover:underline"
        >
          Supervisor →
        </Link>
        <Link
          href={`/t/${orgSlug}/jobs/${jobId}/qa`}
          className="text-sm text-[#698F00] hover:underline"
        >
          ← Back to QA hub
        </Link>
      </div>
    </div>
  );
}
