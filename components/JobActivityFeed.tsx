'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Upload } from 'tus-js-client';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import { compressImageForUpload } from '@/lib/client-image-compression';
import type { JobNotesMode } from '@/lib/job-notes-routes';
import {
  JOB_NOTE_MAX_BODY_LENGTH,
  JOB_NOTE_IMAGE_MAX_BYTES,
  JOB_NOTE_IMAGE_MAX_PER_NOTE,
  JOB_NOTE_VIDEO_MAX_BYTES,
  JOB_NOTE_VIDEO_MAX_SECONDS,
  JOB_NOTE_VIDEO_MIME_TYPES,
} from '@/lib/job-notes';
import { todayReportDate } from '@/lib/report-date';

interface StageOption {
  id: string;
  name: string;
}

interface NoteAttachment {
  id: string;
  note_id: string;
  job_id: string;
  media_type: 'video' | 'image';
  mime_type: string;
  file_name: string | null;
  file_size_bytes: number;
  duration_seconds: number | null;
  created_at: string;
  url: string;
  can_delete: boolean;
}

interface JobNote {
  id: string;
  job_id: string;
  stage_id: string | null;
  stage_name: string | null;
  report_date: string | null;
  primary_context_type: string | null;
  primary_context_id: string | null;
  author_staff_profile_id: string | null;
  author_name: string;
  body: string;
  created_at: string;
  updated_at: string;
  can_delete: boolean;
  attachments: NoteAttachment[];
}

interface UploadPreflight {
  ok?: boolean;
  message?: string;
  upload?: {
    endpoint: string;
    bucket: string;
    path: string;
    metadata: Record<string, string>;
    headers: Record<string, string>;
  };
}

interface JobActivityFeedProps {
  orgSlug: string;
  jobId: string;
  stages?: StageOption[];
  activeStageId?: string | null;
  mode?: JobNotesMode;
  returnTo?: string | null;
  pageTitle?: string;
  pageDescription?: string;
  initialReportDate?: string;
  initialStageId?: string | null;
}

const ACCEPTED_VIDEO_TYPES = JOB_NOTE_VIDEO_MIME_TYPES.join(',');
const ACCEPTED_IMAGE_TYPES = 'image/jpeg,image/png,image/webp,image/heic,image/heif';

const MODE_COPY: Record<JobNotesMode, { title: string; description: string; submit: string }> = {
  capture: {
    title: 'Add site note / photo',
    description: 'Quickly add today\u2019s notes, photos or videos for this job.',
    submit: 'Add site note / photo',
  },
  archive: {
    title: 'Job notes, photos and videos',
    description: 'View the full history of site notes, progress photos and videos for this job.',
    submit: 'Post note',
  },
};

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? ''
      : d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '';
  }
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes > 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function formatReportDate(value: string | null): string {
  if (!value) return 'No date';
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

function noteMatchesReportDate(note: JobNote, reportDate: string): boolean {
  return (note.report_date ?? '').slice(0, 10) === reportDate;
}

function videoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(video.duration) ? video.duration : null);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    video.src = url;
  });
}

async function uploadTusFile(
  file: File,
  preflight: NonNullable<UploadPreflight['upload']>,
  onProgress: (pct: number) => void
): Promise<void> {
  const supabase = createSupabaseBrowserClient();
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) {
    throw new Error('Sign in again before uploading video');
  }

  await new Promise<void>((resolve, reject) => {
    const upload = new Upload(file, {
      endpoint: preflight.endpoint,
      chunkSize: 6 * 1024 * 1024,
      retryDelays: [0, 1000, 3000, 5000],
      removeFingerprintOnSuccess: true,
      metadata: preflight.metadata,
      headers: {
        ...preflight.headers,
        authorization: `Bearer ${accessToken}`,
        'x-upsert': 'false',
      },
      onError: (error) => reject(error),
      onProgress: (uploaded, total) => {
        if (total > 0) onProgress(Math.round((uploaded / total) * 100));
      },
      onSuccess: () => resolve(),
    });
    upload.start();
  });
}

export function JobActivityFeed({
  orgSlug,
  jobId,
  stages = [],
  activeStageId = null,
  mode = 'archive',
  returnTo = null,
  pageTitle,
  pageDescription,
  initialReportDate,
  initialStageId = null,
}: JobActivityFeedProps) {
  const copy = MODE_COPY[mode];
  const title = pageTitle ?? copy.title;
  const description = pageDescription ?? copy.description;
  const captureFilterDate = initialReportDate ?? todayReportDate();

  const [notes, setNotes] = useState<JobNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [stageId, setStageId] = useState<string>(initialStageId ?? activeStageId ?? '');
  const [reportDate, setReportDate] = useState(initialReportDate ?? todayReportDate());
  const [showAllNotes, setShowAllNotes] = useState(mode === 'archive');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imageError, setImageError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [uploadLabel, setUploadLabel] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setReportDate(initialReportDate ?? todayReportDate());
  }, [initialReportDate]);

  useEffect(() => {
    const nextStage = initialStageId ?? activeStageId ?? '';
    setStageId((current) => current || nextStage);
  }, [activeStageId, initialStageId]);

  useEffect(() => {
    setShowAllNotes(mode === 'archive');
  }, [mode]);

  const loadNotes = useCallback(async () => {
    if (!orgSlug || !jobId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/notes?orgSlug=${encodeURIComponent(orgSlug)}`);
      const data = await res.json();
      if (!res.ok || !data?.ok || !Array.isArray(data.notes)) {
        setError(typeof data?.message === 'string' ? data.message : 'Failed to load notes');
        return;
      }
      setNotes(data.notes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load notes');
    } finally {
      setLoading(false);
    }
  }, [jobId, orgSlug]);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  const displayedNotes = useMemo(() => {
    if (mode === 'archive' || showAllNotes) return notes;
    return notes.filter((note) => noteMatchesReportDate(note, captureFilterDate));
  }, [notes, mode, showAllNotes, captureFilterDate]);

  function handleVideoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setVideoError(null);
    if (!file) {
      setVideoFile(null);
      return;
    }
    if (!JOB_NOTE_VIDEO_MIME_TYPES.includes(file.type as (typeof JOB_NOTE_VIDEO_MIME_TYPES)[number])) {
      setVideoFile(null);
      setVideoError('Video must be MP4, MOV, or WebM.');
      if (videoRef.current) videoRef.current.value = '';
      return;
    }
    if (file.size > JOB_NOTE_VIDEO_MAX_BYTES) {
      setVideoFile(null);
      setVideoError('Video must be 50MB or smaller.');
      if (videoRef.current) videoRef.current.value = '';
      return;
    }
    setVideoFile(file);
  }

  function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []);
    setImageError(null);
    if (selected.length === 0) {
      setImageFiles([]);
      return;
    }

    const next: File[] = [];
    for (const file of selected) {
      if (!file.type.startsWith('image/')) {
        setImageError('Photos must be image files (JPEG, PNG, or WebP).');
        setImageFiles([]);
        if (imageRef.current) imageRef.current.value = '';
        return;
      }
      if (file.size > JOB_NOTE_IMAGE_MAX_BYTES) {
        setImageError('Each photo must be 10MB or smaller.');
        setImageFiles([]);
        if (imageRef.current) imageRef.current.value = '';
        return;
      }
      next.push(file);
    }

    if (next.length > JOB_NOTE_IMAGE_MAX_PER_NOTE) {
      setImageError(`You can add up to ${JOB_NOTE_IMAGE_MAX_PER_NOTE} photos per note.`);
      setImageFiles([]);
      if (imageRef.current) imageRef.current.value = '';
      return;
    }

    setImageFiles(next);
  }

  async function uploadNoteImage(noteId: string, file: File): Promise<void> {
    const compressed = await compressImageForUpload(file);
    const formData = new FormData();
    formData.append('file', compressed, compressed.name || file.name || 'photo.jpg');
    const res = await fetch(
      `/api/jobs/${jobId}/notes/${noteId}/attachments/image?orgSlug=${encodeURIComponent(orgSlug)}`,
      { method: 'POST', body: formData }
    );
    const data = await res.json();
    if (!res.ok || !data?.ok) {
      throw new Error(typeof data?.message === 'string' ? data.message : 'Failed to upload photo');
    }
  }

  async function createNote() {
    const trimmed = body.trim();
    const res = await fetch(`/api/jobs/${jobId}/notes?orgSlug=${encodeURIComponent(orgSlug)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        body: trimmed,
        stageId: stageId || null,
        reportDate,
        hasAttachmentIntent: Boolean(videoFile || imageFiles.length > 0),
      }),
    });
    const data = await res.json();
    if (!res.ok || !data?.ok || !data.note?.id) {
      throw new Error(typeof data?.message === 'string' ? data.message : 'Failed to save note');
    }
    return data.note as { id: string };
  }

  async function removeEmptyFailedNote(noteId: string) {
    if (body.trim()) return;
    try {
      await fetch(`/api/jobs/${jobId}/notes/${noteId}?orgSlug=${encodeURIComponent(orgSlug)}`, {
        method: 'DELETE',
      });
    } catch {
      // Best-effort cleanup only.
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setVideoError(null);
    setImageError(null);
    const trimmed = body.trim();
    if (!trimmed && !videoFile && imageFiles.length === 0) {
      setError('Add a note, photo, or video before posting.');
      return;
    }
    if (trimmed.length > JOB_NOTE_MAX_BODY_LENGTH) {
      setError(`Note must be at most ${JOB_NOTE_MAX_BODY_LENGTH} characters.`);
      return;
    }

    setSubmitting(true);
    setUploadPct(null);
    setUploadLabel(null);
    let noteId: string | null = null;
    try {
      const note = await createNote();
      noteId = note.id;

      if (imageFiles.length > 0) {
        for (let index = 0; index < imageFiles.length; index += 1) {
          setUploadLabel(`Uploading photo ${index + 1} of ${imageFiles.length}…`);
          setUploadPct(Math.round(((index + 0.5) / imageFiles.length) * 100));
          await uploadNoteImage(note.id, imageFiles[index]!);
          setUploadPct(Math.round(((index + 1) / imageFiles.length) * 100));
        }
      }

      if (videoFile) {
        setUploadLabel('Uploading video…');
        setUploadPct(0);
        const duration = await videoDuration(videoFile);
        if (duration != null && duration > JOB_NOTE_VIDEO_MAX_SECONDS + 1) {
          await removeEmptyFailedNote(note.id);
          throw new Error('Video must be 60 seconds or shorter.');
        }

        const preflightRes = await fetch(
          `/api/jobs/${jobId}/notes/${note.id}/attachments/preflight?orgSlug=${encodeURIComponent(orgSlug)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fileName: videoFile.name,
              mimeType: videoFile.type,
              fileSizeBytes: videoFile.size,
              durationSeconds: duration,
            }),
          }
        );
        const preflight = (await preflightRes.json()) as UploadPreflight;
        if (!preflightRes.ok || !preflight?.ok || !preflight.upload) {
          await removeEmptyFailedNote(note.id);
          throw new Error(preflight.message ?? 'Failed to prepare video upload');
        }

        await uploadTusFile(videoFile, preflight.upload, setUploadPct);

        const completeRes = await fetch(
          `/api/jobs/${jobId}/notes/${note.id}/attachments/complete?orgSlug=${encodeURIComponent(orgSlug)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              storagePath: preflight.upload.path,
              fileName: videoFile.name,
              mimeType: videoFile.type,
              fileSizeBytes: videoFile.size,
              durationSeconds: duration,
            }),
          }
        );
        const complete = await completeRes.json();
        if (!completeRes.ok || !complete?.ok) {
          await removeEmptyFailedNote(note.id);
          throw new Error(typeof complete?.message === 'string' ? complete.message : 'Failed to save uploaded video');
        }
      }

      setBody('');
      setReportDate(initialReportDate ?? todayReportDate());
      setVideoFile(null);
      setImageFiles([]);
      setUploadPct(null);
      setUploadLabel(null);
      if (videoRef.current) videoRef.current.value = '';
      if (imageRef.current) imageRef.current.value = '';
      await loadNotes();
    } catch (err) {
      if (noteId) await removeEmptyFailedNote(noteId);
      setError(err instanceof Error ? err.message : 'Failed to post note');
    } finally {
      setSubmitting(false);
      setUploadPct(null);
      setUploadLabel(null);
    }
  }

  async function deleteNote(note: JobNote) {
    if (!window.confirm('Delete this note and its photos/videos?')) return;
    setDeleteId(note.id);
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/notes/${note.id}?orgSlug=${encodeURIComponent(orgSlug)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setError(typeof data?.message === 'string' ? data.message : 'Failed to delete note');
        return;
      }
      await loadNotes();
    } catch {
      setError('Failed to delete note');
    } finally {
      setDeleteId(null);
    }
  }

  return (
    <section className="space-y-4">
      {returnTo && (
        <Link href={returnTo} className="text-sm text-[#698F00] hover:underline">
          ← Back
        </Link>
      )}

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
          <p className="mt-1 text-sm text-gray-600">{description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {mode === 'capture' && !showAllNotes && notes.length > displayedNotes.length && (
            <button
              type="button"
              onClick={() => setShowAllNotes(true)}
              className="text-sm font-medium text-[#698F00] hover:underline"
            >
              View all job notes
            </button>
          )}
          {mode === 'capture' && showAllNotes && (
            <button
              type="button"
              onClick={() => setShowAllNotes(false)}
              className="text-sm font-medium text-[#698F00] hover:underline"
            >
              Show today only
            </button>
          )}
          {!loading && notes.length > 0 && (
            <button type="button" onClick={loadNotes} className="text-sm font-medium text-[#698F00] hover:underline">
              Refresh
            </button>
          )}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm space-y-3">
        {stages.length > 0 && (
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Stage</label>
            <select
              value={stageId}
              onChange={(e) => setStageId(e.target.value)}
              disabled={submitting}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-transparent focus:ring-2 focus:ring-[#698F00] disabled:bg-gray-100"
            >
              <option value="">No stage</option>
              {stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Date</label>
          <input
            type="date"
            value={reportDate}
            onChange={(e) => setReportDate(e.target.value)}
            disabled={submitting}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-transparent focus:ring-2 focus:ring-[#698F00] disabled:bg-gray-100"
          />
          <p className="mt-1 text-xs text-gray-500">
            Links this note to the job timeline for the selected date.
          </p>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Note</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            maxLength={JOB_NOTE_MAX_BODY_LENGTH}
            placeholder="Add a site note..."
            disabled={submitting}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-transparent focus:ring-2 focus:ring-[#698F00] disabled:bg-gray-100"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Photos</label>
          <input
            ref={imageRef}
            type="file"
            accept={ACCEPTED_IMAGE_TYPES}
            multiple
            onChange={handleImageSelect}
            disabled={submitting}
            className="w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border file:border-gray-300 file:bg-white file:px-3 file:py-2 file:text-gray-700 hover:file:bg-gray-50 disabled:opacity-50"
          />
          <p className="mt-1 text-xs text-gray-500">
            JPEG, PNG, or WebP. Up to {JOB_NOTE_IMAGE_MAX_PER_NOTE} photos, 10MB each.
          </p>
          {imageFiles.length > 0 && (
            <p className="mt-1 text-xs font-medium text-gray-700">
              Selected: {imageFiles.length} photo{imageFiles.length === 1 ? '' : 's'}
            </p>
          )}
          {imageError && <p className="mt-1 text-sm text-red-700">{imageError}</p>}
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Video</label>
          <input
            ref={videoRef}
            type="file"
            accept={ACCEPTED_VIDEO_TYPES}
            capture="environment"
            onChange={handleVideoSelect}
            disabled={submitting}
            className="w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border file:border-gray-300 file:bg-white file:px-3 file:py-2 file:text-gray-700 hover:file:bg-gray-50 disabled:opacity-50"
          />
          <p className="mt-1 text-xs text-gray-500">
            MP4, MOV, or WebM. Max 60 seconds and 50MB.
          </p>
          {videoFile && (
            <p className="mt-1 text-xs font-medium text-gray-700">
              Selected: {videoFile.name} ({formatBytes(videoFile.size)})
            </p>
          )}
          {videoError && (
            <p className="mt-1 text-sm text-red-700">{videoError}</p>
          )}
        </div>
        {uploadPct != null && (
          <div>
            <div className="h-2 overflow-hidden rounded-full bg-gray-200">
              <div className="h-full rounded-full bg-[#698F00]" style={{ width: `${uploadPct}%` }} />
            </div>
            <p className="mt-1 text-xs text-gray-600">
              {uploadLabel ?? 'Uploading…'} {uploadPct}%
            </p>
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </div>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-[#698F00] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#5a7d00] disabled:cursor-not-allowed disabled:bg-gray-400 sm:w-auto"
        >
          {submitting ? 'Posting…' : copy.submit}
        </button>
      </form>

      {mode === 'capture' && !showAllNotes && (
        <p className="text-xs text-gray-500">
          Showing notes for {formatReportDate(captureFilterDate)}.
        </p>
      )}

      {loading && <p className="text-sm text-gray-600">Loading notes…</p>}
      {!loading && displayedNotes.length === 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">
          {mode === 'capture' && !showAllNotes
            ? `No notes, photos or videos for ${formatReportDate(captureFilterDate)} yet.`
            : 'No notes, photos or videos yet.'}
        </div>
      )}
      {!loading && displayedNotes.length > 0 && (
        <div className="space-y-3">
          {displayedNotes.map((note) => (
            <article key={note.id} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">{note.author_name}</p>
                  <p className="text-xs text-gray-500">
                    {formatDateTime(note.created_at)}
                    {note.stage_name ? ` · ${note.stage_name}` : ''}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="rounded-full bg-lime-50 px-2 py-0.5 text-[11px] font-medium text-lime-800 ring-1 ring-lime-200">
                      {note.stage_name ? `Stage: ${note.stage_name}` : 'Job-wide'}
                    </span>
                    <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-800 ring-1 ring-sky-200">
                      Date: {formatReportDate(note.report_date)}
                    </span>
                    <span className="rounded-full bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-700 ring-1 ring-gray-200">
                      Crew: {note.author_name}
                    </span>
                  </div>
                </div>
                {note.can_delete && (
                  <button
                    type="button"
                    onClick={() => deleteNote(note)}
                    disabled={deleteId === note.id}
                    className="shrink-0 text-sm font-medium text-red-700 hover:underline disabled:opacity-50"
                  >
                    {deleteId === note.id ? 'Deleting…' : 'Delete'}
                  </button>
                )}
              </div>
              {note.body && (
                <p className="mt-3 whitespace-pre-wrap break-words text-sm text-gray-800">{note.body}</p>
              )}
              {note.attachments.length > 0 && (
                <div className="mt-3 space-y-3">
                  {note.attachments.map((attachment) => (
                    <div key={attachment.id}>
                      {attachment.media_type === 'image' ? (
                        <a href={attachment.url} target="_blank" rel="noopener noreferrer" className="block">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={attachment.url}
                            alt={attachment.file_name ?? 'Site photo'}
                            className="max-h-80 w-full rounded-lg border border-gray-200 object-contain bg-gray-50"
                          />
                        </a>
                      ) : (
                        <video
                          src={attachment.url}
                          controls
                          preload="metadata"
                          playsInline
                          className="w-full rounded-lg border border-gray-200 bg-black"
                        />
                      )}
                      <p className="mt-1 text-xs text-gray-500">
                        {[attachment.file_name, formatBytes(attachment.file_size_bytes), formatReportDate(note.report_date)]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
