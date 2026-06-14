'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { QaSectionEvidenceSummary } from '@/components/QaSectionEvidenceSummary';
import { QaSectionHeader } from '@/components/QaSectionHeader';
import { QaSectionItemCard } from '@/components/qa-section/QaSectionItemCard';
import { QaSectionStateBanner } from '@/components/QaSectionStateBanner';
import { QaSectionSubmitBar } from '@/components/QaSectionSubmitBar';
import { getIrrigationSectionDefinition, isIrrigationSectionCode, type IrrigationSectionCode } from '@/lib/irrigation-qa-v1-catalog';
import type { IrrigationSectionUiState } from '@/lib/irrigation-qa-v1-graph';
import { compressImagesForUpload } from '@/lib/client-image-compression';
import { computeQaSectionEvidenceSummary, scrollToQaSectionItem, validateQaSectionClient } from '@/lib/qa-section-display';
import { submitQaSectionWithPhotos } from '@/lib/qa-section-submit-client';

type Answers = Record<string, { result: string; note: string }>;
type PhotoRow = { id: string; item_key: string; content_type: string; created_at: string | null; signed_url: string | null };
type JobContext = { name?: string | null; cc_project_title_snapshot?: string | null };

export default function IrrigationQaSectionPage() {
  const params = useParams();
  const router = useRouter();
  const orgSlug = (params?.orgSlug as string) ?? '';
  const jobId = (params?.jobId as string) ?? '';
  const runId = (params?.runId as string) ?? '';
  const sectionCodeRaw = decodeURIComponent((params?.sectionCode as string) ?? '');

  const sectionCode = isIrrigationSectionCode(sectionCodeRaw) ? (sectionCodeRaw as IrrigationSectionCode) : null;
  const def = sectionCode ? getIrrigationSectionDefinition(sectionCode) : null;
  const items = useMemo(() => def?.items ?? [], [def]);

  const [sectionState, setSectionState] = useState<IrrigationSectionUiState | null>(null);
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
  const [validationSummary, setValidationSummary] = useState<string[]>([]);
  const [fieldErrorsByItem, setFieldErrorsByItem] = useState<Record<string, string[]>>({});
  const [invalidItemKeys, setInvalidItemKeys] = useState<Set<string>>(new Set());
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

  function clearValidation() {
    setValidationSummary([]);
    setFieldErrorsByItem({});
    setInvalidItemKeys(new Set());
  }

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
        if (!r.ok || d.qaType !== 'irrigation') {
          setError(typeof d?.message === 'string' ? d.message : 'Failed to load section');
          return;
        }
        setJob(d.job && typeof d.job === 'object' ? (d.job as JobContext) : null);
        setRunStatus(String(d.run?.status ?? ''));
        const state = Array.isArray(d.sectionStates)
          ? (d.sectionStates as IrrigationSectionUiState[]).find((s) => s.code === sectionCode) ?? null
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
    clearValidation();
    setAnswers((prev) => ({ ...prev, [key]: { result, note: prev[key]?.note ?? '' } }));
  }

  function setNote(key: string, note: string) {
    if (!canSubmit) return;
    clearValidation();
    setAnswers((prev) => ({ ...prev, [key]: { result: prev[key]?.result ?? '', note } }));
  }

  async function addFiles(key: string, files: FileList | null) {
    if (!canSubmit || !files?.length) return;
    setError(null);
    clearValidation();
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

    const clientValidation = validateQaSectionClient({
      qaType: 'irrigation',
      items,
      answers,
      photosByItem,
      photoFiles,
    });

    if (!clientValidation.ok) {
      const byItem: Record<string, string[]> = {};
      for (const fe of clientValidation.fieldErrors) {
        byItem[fe.itemKey] = [...(byItem[fe.itemKey] ?? []), fe.message];
      }
      setValidationSummary(clientValidation.summaryErrors);
      setFieldErrorsByItem(byItem);
      setInvalidItemKeys(new Set(clientValidation.invalidItemKeys));
      if (clientValidation.invalidItemKeys[0]) {
        scrollToQaSectionItem(clientValidation.invalidItemKeys[0]);
      }
      return;
    }

    setSaving(true);
    setError(null);
    setSaved(false);
    clearValidation();
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
      setTimeout(() => router.push(`/t/${orgSlug}/jobs/${jobId}/qa/irrigation/${runId}`), 1200);
    } catch {
      setError('Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (!sectionCode || !def) {
    return <div className="min-h-screen bg-gray-50 py-8 px-4"><div className="max-w-xl mx-auto text-red-800">Unknown irrigation section.</div></div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-xl mx-auto">
        <QaSectionHeader
          backHref={`/t/${orgSlug}/jobs/${jobId}/qa/irrigation/${runId}`}
          job={job}
          qaType="irrigation"
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
              beforeCover={def.beforeCover}
            />
            <QaSectionEvidenceSummary summary={evidenceSummary} />
          </>
        )}
        {saved && <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm font-medium">Evidence saved; returning to run overview…</div>}
        {error && <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm space-y-1">{error.split('\n').map((line, i) => <p key={i}>{line}</p>)}</div>}

        {!loading && (
          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            {items.map((item) => (
              <QaSectionItemCard
                key={item.key}
                item={item}
                answer={answers[item.key]}
                canSubmit={canSubmit}
                savedPhotos={photosByItem[item.key] ?? []}
                savedPhotoCount={(photosByItem[item.key] ?? []).length}
                previews={photoPreviews[item.key] ?? []}
                fieldErrors={fieldErrorsByItem[item.key]}
                isInvalid={invalidItemKeys.has(item.key)}
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
              validationErrors={validationSummary}
            />
          </form>
        )}
      </div>
    </div>
  );
}
