'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { QaSectionEvidenceSummary } from '@/components/QaSectionEvidenceSummary';
import { QaSectionHeader } from '@/components/QaSectionHeader';
import { QaSectionStateBanner } from '@/components/QaSectionStateBanner';
import { QaSectionSubmitBar } from '@/components/QaSectionSubmitBar';
import { getFencingSectionDefinition, getFencingSectionItemsForSetup, isFencingSectionCode, type FencingCatalogueItem, type FencingSectionCode } from '@/lib/fencing-qa-v1-catalog';
import type { FencingQaSetupV1 } from '@/lib/fencing-qa-v1-types';
import { validateFencingSetupV1 } from '@/lib/fencing-qa-v1-setup';
import type { FencingSectionUiState } from '@/lib/fencing-qa-v1-graph';
import { compressImagesForUpload } from '@/lib/client-image-compression';
import { computeQaSectionEvidenceSummary } from '@/lib/qa-section-display';
import { submitQaSectionWithPhotos } from '@/lib/qa-section-submit-client';

type Answers = Record<string, { result: string; note: string }>;
type PhotoRow = { id: string; item_key: string; content_type: string; created_at: string | null; signed_url: string | null };
type JobContext = { name?: string | null; cc_project_title_snapshot?: string | null };

function SavedPhotos({ photos }: { photos: PhotoRow[] }) {
  if (photos.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-gray-600">Saved evidence ({photos.length})</p>
      <div className="flex flex-wrap gap-1.5">
        {photos.map((photo) => photo.signed_url ? (
          <a key={photo.id} href={photo.signed_url} target="_blank" rel="noopener noreferrer">
            <img src={photo.signed_url} alt="Evidence" className="w-14 h-14 object-cover rounded border border-gray-200 hover:opacity-80 transition-opacity" />
          </a>
        ) : (
          <div key={photo.id} className="w-14 h-14 rounded border border-gray-200 bg-gray-50 flex items-center justify-center">
            <span className="text-xs text-gray-400">No preview</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ItemCard({
  item,
  answer,
  canSubmit,
  savedPhotos,
  previews,
  onResult,
  onNote,
  onFiles,
}: {
  item: FencingCatalogueItem;
  answer: { result?: string; note?: string } | undefined;
  canSubmit: boolean;
  savedPhotos: PhotoRow[];
  previews: string[];
  onResult: (result: string) => void;
  onNote: (note: string) => void;
  onFiles: (files: FileList | null) => void;
}) {
  const result = answer?.result ?? '';
  const noteRequired = !item.photoOnly && (result === 'fail' || (item.noteRequiredWhen ?? []).includes(result as 'pass' | 'fail' | 'not_required'));
  const needsEvidence = (item.requirePhoto || item.requireMarkedImage) && (item.photoOnly || result !== 'not_required');
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-gray-900">{item.label}</p>
          {item.staffNote && <p className="mt-1 text-xs text-amber-800">{item.staffNote}</p>}
        </div>
        {(item.requirePhoto || item.requireMarkedImage) && (
          <span className="flex-none text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
            {item.requireMarkedImage ? 'Marked-up image required' : 'Photo required'}
          </span>
        )}
      </div>

      {!item.photoOnly && (
        <div className="flex flex-wrap gap-3">
          {(['pass', 'fail', ...(item.allowNa ? ['not_required'] : [])] as string[]).map((value) => (
            <label key={value} className="flex items-center gap-1.5 text-sm cursor-pointer">
              <input type="radio" name={`r-${item.key}`} checked={result === value} disabled={!canSubmit} onChange={() => onResult(value)} className="accent-[#698F00]" />
              <span>{value === 'not_required' ? 'N/A' : value.charAt(0).toUpperCase() + value.slice(1)}</span>
            </label>
          ))}
        </div>
      )}

      {!item.photoOnly && (noteRequired || Boolean(answer?.note)) && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-gray-700">Note{noteRequired ? <span className="text-red-500 ml-0.5">*</span> : null}</p>
          <textarea
            rows={2}
            disabled={!canSubmit}
            value={answer?.note ?? ''}
            onChange={(e) => onNote(e.target.value)}
            placeholder={item.notePrompt ?? (result === 'fail' ? 'Describe the issue' : 'Record required note')}
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
          />
        </div>
      )}

      <SavedPhotos photos={savedPhotos} />

      {needsEvidence && (
        <div>
          <p className="text-xs text-gray-600 mb-1.5">{savedPhotos.length > 0 ? 'Add more evidence (optional)' : item.requireMarkedImage ? 'Marked-up image' : 'Photos'}</p>
          <label className={`inline-flex items-center gap-2 py-1.5 px-3 rounded-lg border text-sm font-medium ${canSubmit ? 'border-gray-300 bg-white hover:bg-gray-50 text-gray-700 cursor-pointer' : 'border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed'}`}>
            Choose images
            <input type="file" accept="image/*" multiple disabled={!canSubmit} className="sr-only" onChange={(e) => onFiles(e.target.files)} />
          </label>
          {previews.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {previews.map((url, i) => <img key={i} src={url} alt={`New evidence ${i + 1}`} className="w-14 h-14 object-cover rounded border border-[#698F00]/40" />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function FencingQaSectionPage() {
  const params = useParams();
  const router = useRouter();
  const orgSlug = (params?.orgSlug as string) ?? '';
  const jobId = (params?.jobId as string) ?? '';
  const runId = (params?.runId as string) ?? '';
  const sectionCodeRaw = decodeURIComponent((params?.sectionCode as string) ?? '');

  const sectionCode = isFencingSectionCode(sectionCodeRaw) ? (sectionCodeRaw as FencingSectionCode) : null;
  const def = sectionCode ? getFencingSectionDefinition(sectionCode) : null;

  const [setup, setSetup] = useState<FencingQaSetupV1 | null>(null);
  const items = useMemo(
    () => (sectionCode && setup ? getFencingSectionItemsForSetup(sectionCode, setup) : []),
    [sectionCode, setup]
  );

  const [sectionState, setSectionState] = useState<FencingSectionUiState | null>(null);
  const [job, setJob] = useState<JobContext | null>(null);
  const [runStatus, setRunStatus] = useState('');
  const [answers, setAnswers] = useState<Answers>({});
  const [photoFiles, setPhotoFiles] = useState<Record<string, File[]>>({});
  const [photoPreviews, setPhotoPreviews] = useState<Record<string, string[]>>({});
  const [photosByItem, setPhotosByItem] = useState<Record<string, PhotoRow[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const createdUrlsRef = useRef<string[]>([]);

  const isReadOnly = runStatus !== 'active';
  const isBlocked = sectionState?.status === 'blocked_by_unresolved_issue';
  const canSubmit = Boolean(sectionCode && !isReadOnly && !isBlocked);
  const evidenceSummary = useMemo(
    () =>
      computeQaSectionEvidenceSummary({
        items,
        answers,
        photosByItem,
        photoFiles,
      }),
    [items, answers, photosByItem, photoFiles]
  );

  useEffect(() => () => {
    for (const url of createdUrlsRef.current) URL.revokeObjectURL(url);
  }, []);

  useEffect(() => {
    if (!orgSlug || !jobId || !runId || !sectionCode) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/jobs/${jobId}/qa/runs/${runId}?orgSlug=${encodeURIComponent(orgSlug)}`)
      .then((r) => r.json().then((d) => ({ r, d })))
      .then(async ({ r, d }) => {
        if (cancelled) return;
        if (!r.ok || d.qaType !== 'fencing') {
          setError(typeof d?.message === 'string' ? d.message : 'Failed to load section');
          return;
        }
        const setupResult = validateFencingSetupV1(d.setup);
        if (!setupResult.ok) {
          setError('Invalid fencing run setup');
          return;
        }
        setSetup(setupResult.setup);
        setJob(d.job && typeof d.job === 'object' ? (d.job as JobContext) : null);
        setRunStatus(String(d.run?.status ?? ''));
        const state = Array.isArray(d.sectionStates)
          ? (d.sectionStates as FencingSectionUiState[]).find((s) => s.code === sectionCode) ?? null
          : null;
        setSectionState(state);
        const submission = Array.isArray(d.submissions)
          ? d.submissions.find((s: { section_code: string }) => s.section_code === sectionCode)
          : null;
        setAnswers((submission?.answers as Answers) ?? {});

        const photoRes = await fetch(`/api/jobs/${jobId}/qa/runs/${runId}/sections/${encodeURIComponent(sectionCode)}/photos?orgSlug=${encodeURIComponent(orgSlug)}`);
        const photoData = await photoRes.json();
        if (!cancelled && photoData?.ok && Array.isArray(photoData.photos)) {
          const grouped: Record<string, PhotoRow[]> = {};
          for (const photo of photoData.photos as PhotoRow[]) {
            grouped[photo.item_key] = [...(grouped[photo.item_key] ?? []), photo];
          }
          setPhotosByItem(grouped);
        }
      })
      .catch(() => setError('Failed to load section'))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orgSlug, jobId, runId, sectionCode]);

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
      const nextFiles = await compressImagesForUpload(Array.from(files));
      const previews = nextFiles.map((file) => {
        const url = URL.createObjectURL(file);
        createdUrlsRef.current.push(url);
        return url;
      });
      setPhotoFiles((prev) => ({ ...prev, [key]: [...(prev[key] ?? []), ...nextFiles] }));
      setPhotoPreviews((prev) => ({ ...prev, [key]: [...(prev[key] ?? []), ...previews] }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to prepare photo');
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!sectionCode || !canSubmit) return;
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
      setSaved(true);
      setPhotoFiles({});
      setPhotoPreviews({});
      setTimeout(() => router.push(`/t/${orgSlug}/jobs/${jobId}/qa/fencing/${runId}`), 1200);
    } catch {
      setError('Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (!sectionCode || !def) {
    return <div className="min-h-screen bg-gray-50 py-8 px-4"><div className="max-w-xl mx-auto text-red-800">Unknown fencing section.</div></div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-xl mx-auto">
        <QaSectionHeader
          backHref={`/t/${orgSlug}/jobs/${jobId}/qa/fencing/${runId}`}
          job={job}
          qaType="fencing"
          sectionTitle={def.title}
          sectionDescription={def.description}
        />

        {loading && <p className="mt-4 text-gray-600">Loading…</p>}
        {!loading && (
          <>
            <QaSectionStateBanner
              sectionStatus={sectionState?.status}
              runStatus={runStatus}
              isReadOnly={isReadOnly}
              isBlocked={isBlocked}
              blockedBy={sectionState?.blockedBy}
            />
            <QaSectionEvidenceSummary summary={evidenceSummary} />
          </>
        )}
        {saved && <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm font-medium">Evidence saved; returning to run overview…</div>}
        {error && <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm space-y-1">{error.split('\n').map((line, i) => <p key={i}>{line}</p>)}</div>}

        {!loading && (
          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            {items.map((item) => (
              <ItemCard
                key={item.key}
                item={item}
                answer={answers[item.key]}
                canSubmit={canSubmit}
                savedPhotos={photosByItem[item.key] ?? []}
                previews={photoPreviews[item.key] ?? []}
                onResult={(result) => setResult(item.key, result)}
                onNote={(note) => setNote(item.key, note)}
                onFiles={(files) => addFiles(item.key, files)}
              />
            ))}
            <QaSectionSubmitBar
              saving={saving}
              canSubmit={canSubmit}
              isReadOnly={isReadOnly}
              isBlocked={isBlocked}
              runStatus={runStatus}
            />
          </form>
        )}
      </div>
    </div>
  );
}
