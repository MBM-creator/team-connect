'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { QaSectionEvidenceSummary } from '@/components/QaSectionEvidenceSummary';
import { QaSectionHeader } from '@/components/QaSectionHeader';
import { QaSectionItemCard } from '@/components/qa-section/QaSectionItemCard';
import { QaSectionStateBanner } from '@/components/QaSectionStateBanner';
import { QaSectionSubmitBar } from '@/components/QaSectionSubmitBar';
import { getV2SectionDefinition, getV2SectionItemsForSetup, isV2SectionCode, type PavingSectionCodeV2 } from '@/lib/paving-qa-v2-catalog';
import type { PavingQaSetupV2 } from '@/lib/paving-qa-v2-types';
import type { V2CatalogueItem } from '@/lib/paving-qa-v2-catalog';
import type { V2SectionUiState } from '@/lib/paving-qa-v2-graph';
import { compressImagesForUpload } from '@/lib/client-image-compression';
import { computeQaSectionEvidenceSummary, formatQaSubmissionTimestamp, scrollToQaSectionItem, validateQaSectionClient } from '@/lib/qa-section-display';
import { submitQaSectionWithPhotos } from '@/lib/qa-section-submit-client';

type Answers = Record<string, { result: string; note: string }>;
type JobContext = { name?: string | null; cc_project_title_snapshot?: string | null };

type V2PhotoRow = {
  id: string;
  item_key: string;
  content_type: string;
  created_at: string | null;
  signed_url: string | null;
};

type V2SubmissionMeta = { status: string; submittedAt: string | null } | null;

function QaSectionLoadingShell() {
  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-xl mx-auto animate-pulse space-y-4" aria-busy="true" aria-label="Loading section">
        <div className="h-4 w-28 rounded bg-gray-200" />
        <div className="h-8 w-72 max-w-full rounded bg-gray-200" />
        <div className="h-20 rounded-lg bg-gray-200" />
        <div className="h-24 rounded-lg bg-gray-200" />
      </div>
    </div>
  );
}

function V2SectionPage({
  orgSlug,
  jobId,
  runId,
  sectionCode,
  items,
  sectionState,
  runStatus,
  job,
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
  job: JobContext | null;
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
  const [validationSummary, setValidationSummary] = useState<string[]>([]);
  const [fieldErrorsByItem, setFieldErrorsByItem] = useState<Record<string, string[]>>({});
  const [invalidItemKeys, setInvalidItemKeys] = useState<Set<string>>(new Set());
  const createdUrlsRef = useRef<string[]>([]);

  const isReadOnly = runStatus !== 'active';
  const isBlocked = sectionState.status === 'blocked';
  const canSubmit = !isReadOnly && !isBlocked;

  const evidenceSummary = useMemo(
    () =>
      computeQaSectionEvidenceSummary({
        items,
        answers,
        photosByItem: photosLoaded ? photosByItem : {},
        photoFiles,
        savedPhotoCountsByItem: photosLoaded ? undefined : existingPhotoCounts,
      }),
    [items, answers, photosByItem, photoFiles, photosLoaded, existingPhotoCounts]
  );

  function clearValidation() {
    setValidationSummary([]);
    setFieldErrorsByItem({});
    setInvalidItemKeys(new Set());
  }

  useEffect(() => {
    return () => {
      for (const url of createdUrlsRef.current) URL.revokeObjectURL(url);
    };
  }, []);

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

    const clientValidation = validateQaSectionClient({
      qaType: 'paving',
      items,
      answers,
      photosByItem: photosLoaded ? photosByItem : {},
      photoFiles,
      existingPhotoCounts: photosLoaded ? undefined : existingPhotoCounts,
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
        <QaSectionHeader
          backHref={`/t/${orgSlug}/jobs/${jobId}/qa/paving/${runId}`}
          job={job}
          qaType="paving"
          sectionTitle={def?.title ?? sectionCode}
          sectionDescription={def?.description}
        />

        <QaSectionStateBanner
          sectionStatus={sectionState.status}
          runStatus={runStatus}
          isReadOnly={isReadOnly}
          isBlocked={isBlocked}
          blockedBy={sectionState.blockedBy}
        />
        <QaSectionEvidenceSummary summary={evidenceSummary} />

        {submissionMeta ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-1 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
            <span>
              Evidence on file —&nbsp;
              <span className="font-medium capitalize">
                {submissionMeta.status.replace(/_/g, ' ')}
              </span>
            </span>
            {submissionMeta.submittedAt ? (
              <span className="text-xs text-blue-700">
                {formatQaSubmissionTimestamp(submissionMeta.submittedAt)}
              </span>
            ) : null}
          </div>
        ) : null}

        {saved ? (
          <div className="mt-3 rounded-lg border border-green-200 bg-green-50 p-3 text-sm font-medium text-green-800">
            Evidence saved — returning to run overview…
          </div>
        ) : null}
        {error ? (
          <div className="mt-3 space-y-1 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {error.split('\n').map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        ) : null}

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          {items.map((item) => {
            const loadedPhotos = photosLoaded ? (photosByItem[item.key] ?? []) : [];
            const savedPhotoCount = photosLoaded
              ? loadedPhotos.length
              : (existingPhotoCounts[item.key] ?? 0);

            return (
              <QaSectionItemCard
                key={item.key}
                item={item}
                answer={answers[item.key]}
                canSubmit={canSubmit}
                savedPhotos={loadedPhotos}
                savedPhotoCount={savedPhotoCount}
                previews={photoPreviews[item.key] ?? []}
                fieldErrors={fieldErrorsByItem[item.key]}
                isInvalid={invalidItemKeys.has(item.key)}
                onResult={(result) => setResult(item.key, result)}
                onNote={(note) => setNote(item.key, note)}
                onFiles={(files) => addFiles(item.key, files)}
              />
            );
          })}

          {isBlocked ? (
            <p className="text-center text-sm text-gray-500">
              Submission unavailable — unblock upstream sections first.
            </p>
          ) : (
            <QaSectionSubmitBar
              saving={saving}
              canSubmit={canSubmit}
              isReadOnly={isReadOnly}
              isBlocked={isBlocked}
              runStatus={runStatus}
              validationErrors={validationSummary}
            />
          )}
        </form>
      </div>
    </div>
  );
}

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
  const [job, setJob] = useState<JobContext | null>(null);
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
        setJob(d.job && typeof d.job === 'object' ? (d.job as JobContext) : null);

        if (isV2SectionCode(sectionCodeRaw)) {
          const setup = d.setup as PavingQaSetupV2 | undefined;
          if (setup?.area_uses?.length) {
            setItems(getV2SectionItemsForSetup(sectionCodeRaw as PavingSectionCodeV2, setup));
          } else {
            const sectionDef = getV2SectionDefinition(sectionCodeRaw as PavingSectionCodeV2);
            setItems(sectionDef?.items ?? []);
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
    return <QaSectionLoadingShell />;
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
      job={job}
      initialAnswers={initialAnswers}
      submissionMeta={submissionMeta}
      existingPhotoCounts={existingPhotoCounts}
      photosByItem={photosByItem}
      photosLoaded={photosLoaded}
    />
  );
}
