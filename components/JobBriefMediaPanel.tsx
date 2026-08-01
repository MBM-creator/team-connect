'use client';

import { useEffect, useRef, useState } from 'react';
import { compressImageForUpload } from '@/lib/client-image-compression';
import { readVideoDurationSeconds, uploadTusFile, type TusUploadPreflight } from '@/lib/client-tus-upload';
import { JOB_MEDIA_VIDEO_MAX_SECONDS } from '@/lib/job-media';

const CONTROL_FOCUS =
  'focus:border-sc-euca focus:outline-none focus:ring-2 focus:ring-sc-euca/30';
const FOCUS_VISIBLE =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sc-euca';
const TRANSITION = 'motion-safe:transition motion-safe:duration-150 motion-reduce:transition-none';

type PanelTab = 'brief' | 'plans' | 'media';

interface JobBrief {
  id: string;
  job_id: string;
  content: string | null;
  updated_at: string;
}

interface PlanDocument {
  id: string;
  file_name: string | null;
  mime_type: string;
  file_size_bytes: number;
  created_at: string;
  url: string;
}

interface MediaItem {
  id: string;
  media_type: 'image' | 'video';
  file_name: string | null;
  mime_type: string;
  file_size_bytes: number;
  duration_seconds: number | null;
  created_at: string;
  url: string;
}

interface JobBriefMediaPanelProps {
  orgSlug: string;
  jobId: string;
}

const TABS: { id: PanelTab; label: string }[] = [
  { id: 'brief', label: 'Job brief' },
  { id: 'plans', label: 'Plans' },
  { id: 'media', label: 'Photos & Video' },
];

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatShortDate(iso: string): string {
  try {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { dateStyle: 'short' });
  } catch {
    return '';
  }
}

export function JobBriefMediaPanel({ orgSlug, jobId }: JobBriefMediaPanelProps) {
  const [activeTab, setActiveTab] = useState<PanelTab>('brief');

  const [brief, setBrief] = useState<JobBrief | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);
  const [isEditingBrief, setIsEditingBrief] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [isSavingBrief, setIsSavingBrief] = useState(false);

  const [plans, setPlans] = useState<PlanDocument[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);
  const [plansError, setPlansError] = useState<string | null>(null);
  const [isUploadingPlan, setIsUploadingPlan] = useState(false);
  const [planIdRemoving, setPlanIdRemoving] = useState<string | null>(null);
  const planInputRef = useRef<HTMLInputElement>(null);

  const [media, setMedia] = useState<MediaItem[]>([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);
  const [uploadLabel, setUploadLabel] = useState<string | null>(null);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [mediaIdRemoving, setMediaIdRemoving] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!orgSlug || !jobId) return;
    let cancelled = false;
    setBriefLoading(true);
    setBriefError(null);
    fetch(`/api/jobs/${jobId}/brief?orgSlug=${encodeURIComponent(orgSlug)}`)
      .then((res) => res.json())
      .then((data: { ok?: boolean; brief?: JobBrief | null; message?: string }) => {
        if (cancelled) return;
        if (!data?.ok) {
          setBriefError(typeof data?.message === 'string' ? data.message : 'Failed to load job brief');
          return;
        }
        setBrief(data.brief ?? null);
      })
      .catch((err) => {
        if (!cancelled) {
          setBriefError(err instanceof Error ? err.message : 'Failed to load job brief');
        }
      })
      .finally(() => {
        if (!cancelled) setBriefLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orgSlug, jobId]);

  useEffect(() => {
    if (activeTab !== 'plans' || !orgSlug || !jobId) return;
    let cancelled = false;
    setPlansLoading(true);
    setPlansError(null);
    fetch(`/api/jobs/${jobId}/plans?orgSlug=${encodeURIComponent(orgSlug)}`)
      .then((res) => res.json())
      .then((data: { ok?: boolean; plans?: PlanDocument[]; message?: string }) => {
        if (cancelled) return;
        if (!data?.ok || !Array.isArray(data.plans)) {
          setPlansError(typeof data?.message === 'string' ? data.message : 'Failed to load plans');
          return;
        }
        setPlans(data.plans);
      })
      .catch((err) => {
        if (!cancelled) {
          setPlansError(err instanceof Error ? err.message : 'Failed to load plans');
        }
      })
      .finally(() => {
        if (!cancelled) setPlansLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, orgSlug, jobId]);

  useEffect(() => {
    if (activeTab !== 'media' || !orgSlug || !jobId) return;
    let cancelled = false;
    setMediaLoading(true);
    setMediaError(null);
    fetch(`/api/jobs/${jobId}/media?orgSlug=${encodeURIComponent(orgSlug)}`)
      .then((res) => res.json())
      .then((data: { ok?: boolean; media?: MediaItem[]; message?: string }) => {
        if (cancelled) return;
        if (!data?.ok || !Array.isArray(data.media)) {
          setMediaError(typeof data?.message === 'string' ? data.message : 'Failed to load photos and videos');
          return;
        }
        setMedia(data.media);
      })
      .catch((err) => {
        if (!cancelled) {
          setMediaError(err instanceof Error ? err.message : 'Failed to load photos and videos');
        }
      })
      .finally(() => {
        if (!cancelled) setMediaLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, orgSlug, jobId]);

  function startEditingBrief() {
    setEditContent(brief?.content ?? '');
    setBriefError(null);
    setIsEditingBrief(true);
  }

  function cancelEditingBrief() {
    setIsEditingBrief(false);
  }

  async function saveBrief() {
    setBriefError(null);
    setIsSavingBrief(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}/brief?orgSlug=${encodeURIComponent(orgSlug)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editContent }),
      });
      const data = await res.json();
      if (res.ok && data?.ok && data.brief) {
        setBrief(data.brief);
        setIsEditingBrief(false);
      } else {
        setBriefError(typeof data?.message === 'string' ? data.message : 'Failed to save job brief');
      }
    } catch {
      setBriefError('Failed to save job brief');
    } finally {
      setIsSavingBrief(false);
    }
  }

  async function uploadPlan(file: File) {
    setPlansError(null);
    setIsUploadingPlan(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`/api/jobs/${jobId}/plans?orgSlug=${encodeURIComponent(orgSlug)}`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok || !data?.ok || !data.plan) {
        setPlansError(typeof data?.message === 'string' ? data.message : 'Failed to upload plan');
        return;
      }
      setPlans((prev) => [data.plan as PlanDocument, ...prev]);
    } catch {
      setPlansError('Failed to upload plan');
    } finally {
      setIsUploadingPlan(false);
      if (planInputRef.current) planInputRef.current.value = '';
    }
  }

  async function removePlan(planId: string) {
    if (!window.confirm('Remove this plan?')) return;
    setPlansError(null);
    setPlanIdRemoving(planId);
    try {
      const res = await fetch(
        `/api/jobs/${jobId}/plans/${planId}?orgSlug=${encodeURIComponent(orgSlug)}`,
        { method: 'DELETE' }
      );
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setPlansError(typeof data?.message === 'string' ? data.message : 'Failed to remove plan');
        return;
      }
      setPlans((prev) => prev.filter((p) => p.id !== planId));
    } catch {
      setPlansError('Failed to remove plan');
    } finally {
      setPlanIdRemoving(null);
    }
  }

  async function uploadImages(files: FileList | null) {
    if (!files || files.length === 0) return;
    setMediaError(null);
    setIsUploadingMedia(true);
    setUploadLabel('Uploading photos…');
    setUploadPct(0);
    try {
      const list = Array.from(files);
      for (let i = 0; i < list.length; i += 1) {
        const compressed = await compressImageForUpload(list[i]!);
        const formData = new FormData();
        formData.append('file', compressed);
        const res = await fetch(`/api/jobs/${jobId}/media/image?orgSlug=${encodeURIComponent(orgSlug)}`, {
          method: 'POST',
          body: formData,
        });
        const data = await res.json();
        if (!res.ok || !data?.ok || !data.media) {
          throw new Error(typeof data?.message === 'string' ? data.message : 'Failed to upload photo');
        }
        setMedia((prev) => [data.media as MediaItem, ...prev]);
        setUploadPct(Math.round(((i + 1) / list.length) * 100));
      }
    } catch (err) {
      setMediaError(err instanceof Error ? err.message : 'Failed to upload photo');
    } finally {
      setIsUploadingMedia(false);
      setUploadLabel(null);
      setUploadPct(null);
      if (imageInputRef.current) imageInputRef.current.value = '';
    }
  }

  async function uploadVideo(file: File | null) {
    if (!file) return;
    setMediaError(null);
    setIsUploadingMedia(true);
    setUploadLabel('Uploading video…');
    setUploadPct(0);
    try {
      const duration = await readVideoDurationSeconds(file);
      if (duration != null && duration > JOB_MEDIA_VIDEO_MAX_SECONDS + 1) {
        throw new Error('Video must be 60 seconds or shorter.');
      }

      const preflightRes = await fetch(
        `/api/jobs/${jobId}/media/video/preflight?orgSlug=${encodeURIComponent(orgSlug)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileName: file.name,
            mimeType: file.type,
            fileSizeBytes: file.size,
            durationSeconds: duration,
          }),
        }
      );
      const preflight = (await preflightRes.json()) as {
        ok?: boolean;
        message?: string;
        upload?: TusUploadPreflight;
      };
      if (!preflightRes.ok || !preflight?.ok || !preflight.upload) {
        throw new Error(preflight.message ?? 'Failed to prepare video upload');
      }

      await uploadTusFile(file, preflight.upload, setUploadPct);

      const completeRes = await fetch(
        `/api/jobs/${jobId}/media/video/complete?orgSlug=${encodeURIComponent(orgSlug)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            storagePath: preflight.upload.path,
            fileName: file.name,
            mimeType: file.type,
            fileSizeBytes: file.size,
            durationSeconds: duration,
          }),
        }
      );
      const complete = await completeRes.json();
      if (!completeRes.ok || !complete?.ok || !complete.media) {
        throw new Error(
          typeof complete?.message === 'string' ? complete.message : 'Failed to save uploaded video'
        );
      }
      setMedia((prev) => [complete.media as MediaItem, ...prev]);
    } catch (err) {
      setMediaError(err instanceof Error ? err.message : 'Failed to upload video');
    } finally {
      setIsUploadingMedia(false);
      setUploadLabel(null);
      setUploadPct(null);
      if (videoInputRef.current) videoInputRef.current.value = '';
    }
  }

  async function removeMedia(mediaId: string) {
    if (!window.confirm('Remove this item?')) return;
    setMediaError(null);
    setMediaIdRemoving(mediaId);
    try {
      const res = await fetch(
        `/api/jobs/${jobId}/media/${mediaId}?orgSlug=${encodeURIComponent(orgSlug)}`,
        { method: 'DELETE' }
      );
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setMediaError(typeof data?.message === 'string' ? data.message : 'Failed to remove item');
        return;
      }
      setMedia((prev) => prev.filter((m) => m.id !== mediaId));
    } catch {
      setMediaError('Failed to remove item');
    } finally {
      setMediaIdRemoving(null);
    }
  }

  return (
    <section className="mb-5" aria-labelledby="job-brief-media-heading">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="job-brief-media-heading" className="text-lg font-semibold text-sc-charcoal">
          Job brief
        </h2>
        <p className="text-sm text-sc-text-secondary">Brief, plans, and site media for the team</p>
      </div>

      <nav className="mb-4" aria-label="Job brief sections">
        <div className="flex flex-wrap gap-1 rounded-lg border border-sc-border bg-sc-surface-2 p-0.5">
          {TABS.map((tab) => {
            const isActive = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                aria-current={isActive ? 'true' : undefined}
                className={[
                  'inline-flex min-h-[44px] min-w-0 flex-1 items-center justify-center rounded-md px-3 py-2 text-center text-sm font-medium sm:flex-none sm:px-4',
                  TRANSITION,
                  FOCUS_VISIBLE,
                  isActive
                    ? 'bg-sc-euca-tint text-sc-euca-hover'
                    : 'text-sc-text-secondary hover:bg-sc-surface hover:text-sc-text',
                ].join(' ')}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </nav>

      {activeTab === 'brief' && (
        <div>
          {briefLoading && <p className="text-sm text-sc-text-secondary">Loading job brief…</p>}
          {!briefLoading && !isEditingBrief && briefError && (
            <div
              className="mb-3 rounded-xl border border-sc-danger-border bg-sc-danger-tint px-4 py-3 text-sm text-sc-danger"
              role="alert"
            >
              {briefError}
            </div>
          )}
          {!briefLoading && !isEditingBrief && (
            <>
              <div className="mb-3 rounded-xl border border-sc-border bg-sc-surface px-4 py-3.5 sm:px-5">
                {brief && brief.content !== null && brief.content !== '' ? (
                  <pre className="whitespace-pre-wrap break-words font-sans text-sm text-sc-text">
                    {brief.content}
                  </pre>
                ) : (
                  <p className="text-sm text-sc-text-secondary">No job brief yet.</p>
                )}
              </div>
              <button
                type="button"
                onClick={startEditingBrief}
                className={`text-sm font-medium text-sc-euca hover:text-sc-euca-hover hover:underline ${FOCUS_VISIBLE}`}
              >
                Edit
              </button>
            </>
          )}
          {!briefLoading && isEditingBrief && (
            <>
              {briefError && (
                <div
                  className="mb-3 rounded-xl border border-sc-danger-border bg-sc-danger-tint px-4 py-3 text-sm text-sc-danger"
                  role="alert"
                >
                  {briefError}
                </div>
              )}
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                rows={8}
                className={`w-full rounded-lg border border-sc-border bg-sc-surface px-4 py-2 text-sm text-sc-text placeholder:text-sc-text-secondary/70 ${CONTROL_FOCUS}`}
                placeholder="Enter job brief (plain text)..."
                disabled={isSavingBrief}
                aria-label="Job brief content"
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={saveBrief}
                  disabled={isSavingBrief}
                  className={`inline-flex h-11 items-center justify-center rounded-lg bg-sc-euca px-4 text-sm font-medium text-white hover:bg-sc-euca-hover disabled:cursor-not-allowed disabled:opacity-50 ${TRANSITION} ${FOCUS_VISIBLE}`}
                >
                  {isSavingBrief ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={cancelEditingBrief}
                  disabled={isSavingBrief}
                  className={`inline-flex h-11 items-center justify-center rounded-lg border border-sc-border bg-sc-surface px-4 text-sm font-medium text-sc-text hover:bg-sc-surface-2 disabled:opacity-50 ${TRANSITION} ${FOCUS_VISIBLE}`}
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {activeTab === 'plans' && (
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              ref={planInputRef}
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp,.pdf"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadPlan(file);
              }}
            />
            <button
              type="button"
              onClick={() => planInputRef.current?.click()}
              disabled={isUploadingPlan}
              className={`inline-flex h-11 items-center justify-center rounded-lg bg-sc-euca px-4 text-sm font-medium text-white hover:bg-sc-euca-hover disabled:cursor-not-allowed disabled:opacity-50 ${TRANSITION} ${FOCUS_VISIBLE}`}
            >
              {isUploadingPlan ? 'Uploading…' : 'Upload plan'}
            </button>
            <p className="text-sm text-sc-text-secondary">PDF or image drawings for this job.</p>
          </div>

          {plansError && (
            <div
              className="mb-3 rounded-xl border border-sc-danger-border bg-sc-danger-tint px-4 py-3 text-sm text-sc-danger"
              role="alert"
            >
              {plansError}
            </div>
          )}
          {plansLoading && <p className="text-sm text-sc-text-secondary">Loading plans…</p>}
          {!plansLoading && plans.length === 0 && (
            <p className="text-sm text-sc-text-secondary">No plans uploaded yet.</p>
          )}
          {!plansLoading && plans.length > 0 && (
            <ul className="space-y-2">
              {plans.map((plan) => {
                const isPdf = plan.mime_type === 'application/pdf';
                return (
                  <li
                    key={plan.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sc-border bg-sc-surface px-4 py-3"
                  >
                    <div className="min-w-0">
                      <a
                        href={plan.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`block truncate text-sm font-medium text-sc-euca hover:text-sc-euca-hover hover:underline ${FOCUS_VISIBLE}`}
                      >
                        {plan.file_name || (isPdf ? 'Plan.pdf' : 'Plan image')}
                      </a>
                      <p className="text-xs text-sc-text-secondary">
                        {[isPdf ? 'PDF' : 'Image', formatBytes(plan.file_size_bytes), formatShortDate(plan.created_at)]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void removePlan(plan.id)}
                      disabled={planIdRemoving === plan.id}
                      className={`text-sm font-medium text-sc-danger hover:underline disabled:opacity-50 ${FOCUS_VISIBLE}`}
                    >
                      {planIdRemoving === plan.id ? 'Removing…' : 'Remove'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {activeTab === 'media' && (
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              onChange={(e) => void uploadImages(e.target.files)}
            />
            <input
              ref={videoInputRef}
              type="file"
              accept="video/mp4,video/quicktime,video/webm"
              className="sr-only"
              onChange={(e) => void uploadVideo(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              disabled={isUploadingMedia}
              className={`inline-flex h-11 items-center justify-center rounded-lg bg-sc-euca px-4 text-sm font-medium text-white hover:bg-sc-euca-hover disabled:cursor-not-allowed disabled:opacity-50 ${TRANSITION} ${FOCUS_VISIBLE}`}
            >
              Upload photos
            </button>
            <button
              type="button"
              onClick={() => videoInputRef.current?.click()}
              disabled={isUploadingMedia}
              className={`inline-flex h-11 items-center justify-center rounded-lg border border-sc-border bg-sc-surface px-4 text-sm font-medium text-sc-text hover:bg-sc-surface-2 disabled:cursor-not-allowed disabled:opacity-50 ${TRANSITION} ${FOCUS_VISIBLE}`}
            >
              Upload video
            </button>
          </div>

          {isUploadingMedia && uploadLabel && (
            <p className="mb-3 text-sm text-sc-text-secondary" aria-live="polite">
              {uploadLabel}
              {uploadPct != null ? ` ${uploadPct}%` : ''}
            </p>
          )}

          {mediaError && (
            <div
              className="mb-3 rounded-xl border border-sc-danger-border bg-sc-danger-tint px-4 py-3 text-sm text-sc-danger"
              role="alert"
            >
              {mediaError}
            </div>
          )}
          {mediaLoading && <p className="text-sm text-sc-text-secondary">Loading photos and videos…</p>}
          {!mediaLoading && media.length === 0 && (
            <p className="text-sm text-sc-text-secondary">No photos or videos yet.</p>
          )}
          {!mediaLoading && media.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {media.map((item) => (
                <div key={item.id} className="group relative min-w-0 overflow-hidden rounded-xl border border-sc-border bg-sc-surface">
                  {item.media_type === 'image' ? (
                    <a href={item.url} target="_blank" rel="noopener noreferrer" className="block">
                      <img
                        src={item.url}
                        alt={item.file_name || 'Job photo'}
                        className="aspect-square w-full object-cover"
                      />
                    </a>
                  ) : (
                    <video
                      src={item.url}
                      controls
                      preload="metadata"
                      className="aspect-square w-full object-cover bg-sc-charcoal"
                    />
                  )}
                  <div className="flex items-center justify-between gap-2 px-2 py-1.5">
                    <span className="truncate text-xs text-sc-text-secondary">
                      {item.media_type === 'video' ? 'Video' : 'Photo'}
                      {formatShortDate(item.created_at) ? ` · ${formatShortDate(item.created_at)}` : ''}
                    </span>
                    <button
                      type="button"
                      onClick={() => void removeMedia(item.id)}
                      disabled={mediaIdRemoving === item.id}
                      className={`shrink-0 text-xs font-medium text-sc-danger hover:underline disabled:opacity-50 ${FOCUS_VISIBLE}`}
                    >
                      {mediaIdRemoving === item.id ? '…' : 'Remove'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
