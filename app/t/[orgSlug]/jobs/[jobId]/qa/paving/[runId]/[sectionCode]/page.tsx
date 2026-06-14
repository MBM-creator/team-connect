'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { getV2SectionDefinition, getV2SectionItemsForSetup, isV2SectionCode, type PavingSectionCodeV2 } from '@/lib/paving-qa-v2-catalog';
import type { PavingQaSetupV2 } from '@/lib/paving-qa-v2-types';
import type { V2CatalogueItem } from '@/lib/paving-qa-v2-catalog';
import type { V2SectionUiState } from '@/lib/paving-qa-v2-graph';
import { compressImagesForUpload } from '@/lib/client-image-compression';
import { submitQaSectionWithPhotos } from '@/lib/qa-section-submit-client';

type Answers = Record<string, { result: string; note: string }>;

type V2PhotoRow = {
  id: string;
  item_key: string;
  content_type: string;
  created_at: string | null;
  signed_url: string | null;
};

// ---------------------------------------------------------------------------
// Shared: saved photo thumbnails
// ---------------------------------------------------------------------------

function SavedPhotos({
  savedCount,
  loadedPhotos,
}: {
  savedCount: number;
  loadedPhotos: V2PhotoRow[] | null;
}) {
  if (savedCount === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-gray-600">
        Saved evidence ({savedCount} photo{savedCount !== 1 ? 's' : ''})
      </p>
      {loadedPhotos === null ? (
        <p className="text-xs text-gray-400">Loading previews…</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {loadedPhotos.map((photo) =>
            photo.signed_url ? (
              <a
                key={photo.id}
                href={photo.signed_url}
                target="_blank"
                rel="noopener noreferrer"
                title={
                  photo.created_at
                    ? new Date(photo.created_at).toLocaleString('en-AU', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : 'View photo'
                }
              >
                <img
                  src={photo.signed_url}
                  alt="Evidence"
                  className="w-14 h-14 object-cover rounded border border-gray-200 hover:opacity-80 transition-opacity"
                />
              </a>
            ) : (
              <div
                key={photo.id}
                className="w-14 h-14 rounded border border-gray-200 bg-gray-50 flex items-center justify-center"
              >
                <span className="text-xs text-gray-400 text-center leading-tight px-1">No preview</span>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared: new-file previews (shown before submit)
// ---------------------------------------------------------------------------

function NewFilePreviews({ previews }: { previews: string[] }) {
  if (previews.length === 0) return null;
  return (
    <div className="mt-2 space-y-1.5">
      <p className="text-xs font-medium text-gray-600">
        {previews.length} new photo{previews.length !== 1 ? 's' : ''} selected
      </p>
      <div className="flex flex-wrap gap-1.5">
        {previews.map((url, i) => (
          <img
            key={i}
            src={url}
            alt={`New photo ${i + 1}`}
            className="w-14 h-14 object-cover rounded border border-[#698F00]/40"
          />
        ))}
      </div>
    </div>
  );
}

type V2SubmissionMeta = { status: string; submittedAt: string | null } | null;

function V2SectionPage({
  orgSlug,
  jobId,
  runId,
  sectionCode,
  items,
  sectionState,
  runStatus,
  initialAnswers,
  submissionMeta,
  existingPhotoCounts,
  photosByItem,
  photosLoaded,
}: {
  orgSlug: string;
  jobId: string;
  runId: string;
  sectionCode: PavingSectionCodeV2;
  items: V2CatalogueItem[];
  sectionState: V2SectionUiState;
  runStatus: string;
  initialAnswers: Answers;
  submissionMeta: V2SubmissionMeta;
  existingPhotoCounts: Record<string, number>;
  photosByItem: Record<string, V2PhotoRow[]>;
  photosLoaded: boolean;
}) {
  const router = useRouter();
  const def = getV2SectionDefinition(sectionCode);
  const [answers, setAnswers] = useState<Answers>(initialAnswers);
  const [photoFiles, setPhotoFiles] = useState<Record<string, File[]>>({});
  const [photoPreviews, setPhotoPreviews] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const createdUrlsRef = useRef<string[]>([]);

  const isReadOnly = runStatus !== 'active';
  const isBlocked = sectionState.status === 'blocked';
  const canSubmit = !isReadOnly && !isBlocked;

  useEffect(() => {
    return () => {
      for (const url of createdUrlsRef.current) URL.revokeObjectURL(url);
    };
  }, []);

  function setResult(key: string, result: string) {
    if (!canSubmit) return;
    setAnswers((prev) => ({ ...prev, [key]: { result, note: prev[key]?.note ?? '' } }));
  }
  function setNote(key: string, note: string) {
    if (!canSubmit) return;
    setAnswers((prev) => ({ ...prev, [key]: { result: prev[key]?.result ?? '', note } }));
  }
  async function addFiles(key: string, files: FileList | null) {
    if (!canSubmit || !files?.length) return;
    setError(null);
    try {
      const newFiles = await compressImagesForUpload(Array.from(files));
      const newPreviews = newFiles.map((f) => {
        const url = URL.createObjectURL(f);
        createdUrlsRef.current.push(url);
        return url;
      });
      setPhotoFiles((prev) => ({ ...prev, [key]: [...(prev[key] ?? []), ...newFiles] }));
      setPhotoPreviews((prev) => ({ ...prev, [key]: [...(prev[key] ?? []), ...newPreviews] }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to prepare photo');
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const result = await submitQaSectionWithPhotos({
        submitUrl: `/api/jobs/${jobId}/qa/runs/${runId}/sections/${encodeURIComponent(sectionCode)}/submit?orgSlug=${encodeURIComponent(orgSlug)}`,
        answers,
        photoFiles,
      });
      if (!result.ok) {
        setError(result.errors?.join('\n') ?? result.message ?? 'Save failed');
        return;
      }
      setPhotoFiles({});
      setPhotoPreviews({});
      setSaved(true);
      setTimeout(() => router.push(`/t/${orgSlug}/jobs/${jobId}/qa/paving/${runId}`), 1500);
    } catch {
      setError('Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-xl mx-auto">
        <Link
          href={`/t/${orgSlug}/jobs/${jobId}/qa/paving/${runId}`}
          className="text-sm text-[#698F00] hover:underline"
        >
          ← Run overview
        </Link>

        <div className="flex items-center gap-2 mt-2">
          <h1 className="text-xl font-bold text-gray-900">{def?.title ?? sectionCode}</h1>
          <span className="px-1.5 py-0.5 text-xs rounded bg-[#698F00]/10 text-[#698F00] border border-[#698F00]/20">
            v2
          </span>
        </div>
        {def && <p className="text-sm text-gray-500 mt-1">{def.description}</p>}

        {isReadOnly && (
          <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-sm">
            This run is {runStatus || 'not active'} — evidence is read-only.
          </div>
        )}
        {isBlocked && sectionState.blockedBy && (
          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">
            <p className="font-semibold mb-1">This section is blocked:</p>
            <ul className="list-disc pl-4 space-y-0.5">
              {sectionState.blockedBy.map((b) => (
                <li key={`${b.section}:${b.reason}`}>{b.reason}</li>
              ))}
            </ul>
          </div>
        )}
        {sectionState.status === 'issue_raised' && (
          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">
            This section has an unresolved issue. Supervisor action required before it can be cleared.
          </div>
        )}
        {sectionState.status === 'cleared' && (
          <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm">
            This section is cleared. You can re-submit to update evidence.
          </div>
        )}

        {/* Existing submission banner */}
        {submissionMeta && (
          <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-900 text-sm flex items-center justify-between flex-wrap gap-1">
            <span>
              Evidence on file —&nbsp;
              <span className="font-medium capitalize">
                {submissionMeta.status.replace(/_/g, ' ')}
              </span>
            </span>
            {submissionMeta.submittedAt && (
              <span className="text-blue-700 text-xs">
                {new Date(submissionMeta.submittedAt).toLocaleString('en-AU', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            )}
          </div>
        )}

        {saved && (
          <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm font-medium">
            Evidence saved — returning to run overview…
          </div>
        )}
        {error && (
          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm space-y-1">
            {error.split('\n').map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        )}

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          {items.map((item) => {
            const result = answers[item.key]?.result ?? '';
            // Use signed-URL photos when loaded, fall back to bare count until then
            const loadedPhotos = photosLoaded ? (photosByItem[item.key] ?? []) : null;
            const savedPhotoCount =
              loadedPhotos !== null ? loadedPhotos.length : (existingPhotoCounts[item.key] ?? 0);
            const newPreviews = photoPreviews[item.key] ?? [];

            return (
              <div
                key={item.key}
                className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-gray-900">{item.label}</p>
                  {item.requirePhoto && (
                    <span className="flex-none text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                      Photo required
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap gap-3">
                  {!item.photoOnly &&
                    (item.allowNa
                      ? (['pass', 'fail', 'not_required'] as const)
                      : (['pass', 'fail'] as const)
                    ).map((r) => (
                      <label key={r} className="flex items-center gap-1.5 text-sm cursor-pointer">
                        <input
                          type="radio"
                          name={`r-${item.key}`}
                          checked={result === r}
                          disabled={!canSubmit}
                          onChange={() => setResult(item.key, r)}
                          className="accent-[#698F00]"
                        />
                        <span>{r === 'not_required' ? 'N/A' : r.charAt(0).toUpperCase() + r.slice(1)}</span>
                      </label>
                    ))}
                  {item.photoOnly && item.allowNa && (
                    <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={result === 'not_required'}
                        disabled={!canSubmit}
                        onChange={(e) =>
                          setResult(item.key, e.target.checked ? 'not_required' : '')
                        }
                        className="accent-[#698F00]"
                      />
                      <span>N/A</span>
                    </label>
                  )}
                </div>

                {/* Note field: always shown on fail; also shown when noteRequiredWhen matches
                    or when an existing note is present (so pre-populated notes remain visible) */}
                {!item.photoOnly &&
                  (result === 'fail' ||
                    (item.noteRequiredWhen ?? []).includes(result as 'pass' | 'fail' | 'not_required') ||
                    Boolean(answers[item.key]?.note)) &&
                  (() => {
                  const noteIsRequired =
                    result === 'fail' ||
                    (item.noteRequiredWhen ?? []).includes(result as 'pass' | 'fail' | 'not_required');
                  return (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-gray-700">
                        Note{noteIsRequired ? <span className="text-red-500 ml-0.5">*</span> : null}
                      </p>
                      <textarea
                        placeholder={
                          item.notePrompt ??
                          (result === 'fail' ? 'Describe the issue (required)' : 'Note (required)')
                        }
                        className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                        rows={2}
                        value={answers[item.key]?.note ?? ''}
                        disabled={!canSubmit}
                        onChange={(e) => setNote(item.key, e.target.value)}
                      />
                    </div>
                  );
                })()}

                {/* Saved photo evidence — always visible when photos exist */}
                <SavedPhotos savedCount={savedPhotoCount} loadedPhotos={loadedPhotos} />

                {/* Upload section — photo-only items always show upload; others hide when N/A selected */}
                {item.requirePhoto && (item.photoOnly || result !== 'not_required') && (
                  <div>
                    <p className="text-xs text-gray-600 mb-1.5">
                      {savedPhotoCount > 0 ? 'Add more photos (optional)' : 'Photos'}
                    </p>
                    <label
                      className={`inline-flex items-center gap-2 py-1.5 px-3 rounded-lg border text-sm font-medium transition-colors ${
                        !canSubmit
                          ? 'border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed'
                          : 'border-gray-300 bg-white hover:bg-gray-50 text-gray-700 cursor-pointer'
                      }`}
                    >
                      <svg className="w-4 h-4 flex-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      {newPreviews.length > 0
                        ? `${newPreviews.length} photo${newPreviews.length !== 1 ? 's' : ''} selected`
                        : 'Choose photos'}
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        disabled={!canSubmit}
                        className="sr-only"
                        onChange={(e) => addFiles(item.key, e.target.files)}
                      />
                    </label>
                    <NewFilePreviews previews={newPreviews} />
                  </div>
                )}
              </div>
            );
          })}

          {isBlocked ? (
            <p className="text-sm text-center text-gray-500">
              Submission unavailable — unblock upstream sections first.
            </p>
          ) : (
            <button
              type="submit"
              disabled={saving || !canSubmit}
              className="w-full bg-[#698F00] text-white py-2 rounded-lg font-medium disabled:bg-gray-400"
            >
              {saving ? 'Saving…' : 'Submit section evidence'}
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root page — detects version and renders the correct sub-component
// ---------------------------------------------------------------------------

export default function PavingQaSectionPage() {
  const params = useParams();
  const orgSlug = (params?.orgSlug as string) ?? '';
  const jobId = (params?.jobId as string) ?? '';
  const runId = (params?.runId as string) ?? '';
  const sectionCodeRaw = decodeURIComponent((params?.sectionCode as string) ?? '');

  const [items, setItems] = useState<V2CatalogueItem[]>([]);
  const [sectionStates, setSectionStates] = useState<V2SectionUiState[]>([]);
  const [initialAnswers, setInitialAnswers] = useState<Answers>({});
  const [submissionMeta, setSubmissionMeta] = useState<V2SubmissionMeta>(null);
  const [existingPhotoCounts, setExistingPhotoCounts] = useState<Record<string, number>>({});
  const [photosByItem, setPhotosByItem] = useState<Record<string, V2PhotoRow[]>>({});
  const [photosLoaded, setPhotosLoaded] = useState(false);
  const [runStatus, setRunStatus] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgSlug || !jobId || !runId) return;
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setPhotosByItem({});
      setPhotosLoaded(false);

      try {
        const r = await fetch(
          `/api/jobs/${jobId}/qa/runs/${runId}?orgSlug=${encodeURIComponent(orgSlug)}`
        );
        const d = await r.json();
        if (cancelled) return;
        if (!r.ok) {
          setError(typeof d?.message === 'string' ? d.message : 'Failed to load');
          return;
        }

        setRunStatus(String(d.run?.status ?? ''));

        if (isV2SectionCode(sectionCodeRaw)) {
          const setup = d.setup as PavingQaSetupV2 | undefined;
          if (setup?.area_uses?.length) {
            setItems(getV2SectionItemsForSetup(sectionCodeRaw as PavingSectionCodeV2, setup));
          } else {
            const def = getV2SectionDefinition(sectionCodeRaw as PavingSectionCodeV2);
            setItems(def?.items ?? []);
          }
        }
        setSectionStates(Array.isArray(d.sectionStates) ? (d.sectionStates as V2SectionUiState[]) : []);

        const subs = Array.isArray(d.submissions) ? d.submissions : [];
        const mine = subs.find(
          (x: { section_code: string }) => x.section_code === sectionCodeRaw
        ) as
          | {
              section_code: string;
              submission_status?: string;
              answers?: unknown;
              submitted_at?: string | null;
            }
          | undefined;

        if (mine?.answers && typeof mine.answers === 'object' && !Array.isArray(mine.answers)) {
          const next: Answers = {};
          for (const [k, val] of Object.entries(
            mine.answers as Record<string, { result?: string; note?: string }>
          )) {
            next[k] = { result: String(val?.result ?? ''), note: String(val?.note ?? '') };
          }
          setInitialAnswers(next);
        } else {
          setInitialAnswers({});
        }

        setSubmissionMeta(
          mine
            ? {
                status: String(mine.submission_status ?? ''),
                submittedAt: mine.submitted_at ? String(mine.submitted_at) : null,
              }
            : null
        );

        const allPhotoRows = Array.isArray(d.photoRows)
          ? (d.photoRows as { section_code: string; item_key: string }[])
          : [];
        const counts: Record<string, number> = {};
        for (const row of allPhotoRows) {
          if (row.section_code === sectionCodeRaw) {
            counts[row.item_key] = (counts[row.item_key] ?? 0) + 1;
          }
        }
        setExistingPhotoCounts(counts);

        fetch(
          `/api/jobs/${jobId}/qa/runs/${runId}/sections/${encodeURIComponent(sectionCodeRaw)}/photos?orgSlug=${encodeURIComponent(orgSlug)}`
        )
          .then((pr) => pr.json())
          .then((pd: { ok?: boolean; photos?: V2PhotoRow[] }) => {
            if (cancelled || !pd?.ok) return;
            const byItem: Record<string, V2PhotoRow[]> = {};
            for (const photo of pd.photos ?? []) {
              if (!byItem[photo.item_key]) byItem[photo.item_key] = [];
              byItem[photo.item_key].push(photo);
            }
            setPhotosByItem(byItem);
            setPhotosLoaded(true);
          })
          .catch(() => {
            if (!cancelled) setPhotosLoaded(true);
          });

        setError(null);
      } catch {
        if (!cancelled) setError('Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [orgSlug, jobId, runId, sectionCodeRaw]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 py-8 px-4">
        <p className="text-gray-600">Loading…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 py-8 px-4">
        <Link
          href={`/t/${orgSlug}/jobs/${jobId}/qa/paving/${runId}`}
          className="text-sm text-[#698F00] hover:underline"
        >
          ← Run overview
        </Link>
        <p className="mt-4 text-red-800">{error}</p>
      </div>
    );
  }

  if (!isV2SectionCode(sectionCodeRaw)) {
    return (
      <div className="min-h-screen bg-gray-50 py-8 px-4">
        <Link
          href={`/t/${orgSlug}/jobs/${jobId}/qa/paving/${runId}`}
          className="text-sm text-[#698F00] hover:underline"
        >
          ← Run overview
        </Link>
        <p className="mt-4 text-red-800">Unknown section code: {sectionCodeRaw}</p>
      </div>
    );
  }

  const sectionCode = sectionCodeRaw as PavingSectionCodeV2;
  const myState = sectionStates.find((s) => s.code === sectionCode) ?? null;
  if (!myState) {
    return (
      <div className="min-h-screen bg-gray-50 py-8 px-4">
        <Link
          href={`/t/${orgSlug}/jobs/${jobId}/qa/paving/${runId}`}
          className="text-sm text-[#698F00] hover:underline"
        >
          ← Run overview
        </Link>
        <p className="mt-4 text-amber-800">
          Section <strong>{sectionCodeRaw}</strong> is not part of this run&apos;s setup.
        </p>
      </div>
    );
  }

  return (
    <V2SectionPage
      orgSlug={orgSlug}
      jobId={jobId}
      runId={runId}
      sectionCode={sectionCode}
      items={items}
      sectionState={myState}
      runStatus={runStatus}
      initialAnswers={initialAnswers}
      submissionMeta={submissionMeta}
      existingPhotoCounts={existingPhotoCounts}
      photosByItem={photosByItem}
      photosLoaded={photosLoaded}
    />
  );
}
