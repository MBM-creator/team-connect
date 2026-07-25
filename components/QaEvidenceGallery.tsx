'use client';

/* eslint-disable react-hooks/set-state-in-effect */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { qaRunPath, qaSupervisorPath } from '@/lib/admin-dashboard/qa-links';
import { sanitizeClientNameSnapshot } from '@/lib/cc-client-display';
import type { QaType } from '@/lib/qa-run-bundle';

type EvidenceSection = {
  code: string;
  title: string;
  status: string;
  cleared: boolean;
  photoCount: number;
  issueCount: number;
  notes: Array<{ itemKey: string; note: string }>;
  issues: Array<{ id: string; item_key: string; status: string; title: string | null; detail: string | null }>;
};

type EvidencePayload = {
  ok: boolean;
  job?: {
    id: string;
    name: string;
    cc_project_title_snapshot: string | null;
    cc_client_name_snapshot: string | null;
  };
  run?: {
    id: string;
    status: string;
    qa_type: QaType;
    qa_type_label: string;
    setup_version: number | null;
  };
  sections?: EvidenceSection[];
  message?: string;
};

type PhotoRow = {
  id: string;
  item_key: string;
  signed_url: string | null;
};

function EvidenceSectionPhotos({
  orgSlug,
  jobId,
  runId,
  sectionCode,
}: {
  orgSlug: string;
  jobId: string;
  runId: string;
  sectionCode: string;
}) {
  const [photos, setPhotos] = useState<PhotoRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(
      `/api/jobs/${jobId}/qa/runs/${runId}/sections/${encodeURIComponent(sectionCode)}/photos?orgSlug=${encodeURIComponent(orgSlug)}`
    )
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setPhotos(Array.isArray(data?.photos) ? data.photos : []);
      })
      .catch(() => {
        if (!cancelled) setPhotos([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orgSlug, jobId, runId, sectionCode]);

  if (loading) return <p className="text-xs text-gray-500">Loading photos…</p>;
  if (photos.length === 0) return <p className="text-xs text-gray-500">No photos saved.</p>;

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {photos.map((photo) =>
        photo.signed_url ? (
          <a key={photo.id} href={photo.signed_url} target="_blank" rel="noopener noreferrer">
            <img
              src={photo.signed_url}
              alt="Evidence"
              className="h-16 w-16 rounded border border-gray-200 object-cover"
            />
          </a>
        ) : (
          <span key={photo.id} className="text-xs text-gray-400">
            Unavailable
          </span>
        )
      )}
    </div>
  );
}

export function QaEvidenceGallery({
  orgSlug,
  jobId,
  runId,
}: {
  orgSlug: string;
  jobId: string;
  runId: string;
}) {
  const [data, setData] = useState<EvidencePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/jobs/${jobId}/qa/runs/${runId}/evidence?orgSlug=${encodeURIComponent(orgSlug)}`)
      .then((res) => res.json())
      .then((json: EvidencePayload) => {
        if (cancelled) return;
        if (!json.ok) {
          setError(json.message ?? 'Failed to load evidence');
          return;
        }
        setData(json);
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load evidence');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orgSlug, jobId, runId]);

  if (loading) return <p className="text-gray-600">Loading evidence…</p>;
  if (error) return <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>;
  if (!data?.job || !data.run || !data.sections) return null;

  const qaType = data.run.qa_type;
  const runHref = qaRunPath(orgSlug, jobId, runId, qaType);
  const supervisorHref = qaSupervisorPath(orgSlug, jobId, runId, qaType);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <h1 className="text-xl font-bold text-gray-900">{data.job.cc_project_title_snapshot ?? data.job.name}</h1>
        {sanitizeClientNameSnapshot(data.job.cc_client_name_snapshot) && (
          <p className="text-sm text-gray-600">
            {sanitizeClientNameSnapshot(data.job.cc_client_name_snapshot)}
          </p>
        )}
        <p className="mt-2 text-sm text-gray-700">
          {data.run.qa_type_label}
          {data.run.setup_version ? ` v${data.run.setup_version}` : ''} · {data.run.status}
        </p>
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          <Link href={`/t/${orgSlug}/jobs/${jobId}`} className="text-[#698F00] hover:underline">
            Job
          </Link>
          <Link href={runHref} className="text-[#698F00] hover:underline">
            QA run
          </Link>
          <Link href={supervisorHref} className="text-[#698F00] hover:underline">
            Supervisor / issues
          </Link>
          <Link href={`/t/${orgSlug}/admin`} className="text-[#698F00] hover:underline">
            Admin dashboard
          </Link>
        </div>
      </div>

      {data.sections.map((section) => (
        <section key={section.code} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold text-gray-900">{section.title}</h2>
            <span className="text-xs text-gray-500">
              {section.status.replace(/_/g, ' ')}
              {section.cleared ? ' · cleared' : ''}
            </span>
          </div>

          <EvidenceSectionPhotos
            orgSlug={orgSlug}
            jobId={jobId}
            runId={runId}
            sectionCode={section.code}
          />

          {section.notes.length > 0 && (
            <div className="mt-3 space-y-2">
              <h3 className="text-xs font-semibold uppercase text-gray-500">Notes</h3>
              {section.notes.map((note) => (
                <div key={`${section.code}-${note.itemKey}`} className="rounded bg-gray-50 p-2 text-sm text-gray-800">
                  <span className="text-xs text-gray-500">{note.itemKey}: </span>
                  {note.note}
                </div>
              ))}
            </div>
          )}

          {section.issues.length > 0 && (
            <div className="mt-3 space-y-2">
              <h3 className="text-xs font-semibold uppercase text-gray-500">Issues</h3>
              {section.issues.map((issue) => (
                <div key={issue.id} className="rounded border border-amber-200 bg-amber-50 p-2 text-sm">
                  <div className="font-medium text-amber-900">{issue.title ?? issue.item_key}</div>
                  <div className="text-xs text-amber-800">{issue.status.replace(/_/g, ' ')}</div>
                  {issue.detail && <p className="mt-1 text-amber-900">{issue.detail}</p>}
                </div>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
