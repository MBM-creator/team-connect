'use client';

/* eslint-disable react-hooks/set-state-in-effect */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { buildJobNotesHref, type JobNotesMode } from '@/lib/job-notes-routes';

interface NotePreview {
  id: string;
  author_name: string;
  body: string;
  report_date: string | null;
  created_at: string;
  attachments: { media_type: 'image' | 'video' }[];
}

interface JobNotesEntryCardProps {
  orgSlug: string;
  jobId: string;
  variant: JobNotesMode;
  returnTo: string;
  reportDate?: string;
  stageId?: string | null;
  showPreview?: boolean;
}

const COPY: Record<
  JobNotesMode,
  { title: string; helper: string; cta: string; ctaClass: string }
> = {
  capture: {
    title: 'Site notes and photos',
    helper: 'Quickly add today\u2019s notes, photos or videos for this job.',
    cta: 'Add site note / photo',
    ctaClass:
      'block w-full rounded-lg bg-sc-euca px-4 py-3 text-center text-sm font-medium text-white transition-colors hover:bg-sc-euca-hover sm:inline-block sm:w-auto',
  },
  archive: {
    title: 'Job notes, photos and videos',
    helper: 'View the full history of site notes, progress photos and videos for this job.',
    cta: 'View job notes',
    ctaClass:
      'inline-block rounded-lg border border-sc-euca/30 px-4 py-2 text-sm font-medium text-sc-euca transition-colors hover:bg-sc-euca-tint',
  },
};

function formatPreviewDate(iso: string): string {
  try {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? ''
      : d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '';
  }
}

function previewSummary(note: NotePreview): string {
  const trimmed = note.body.trim();
  if (trimmed) {
    return trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed;
  }
  const images = note.attachments.filter((a) => a.media_type === 'image').length;
  const videos = note.attachments.filter((a) => a.media_type === 'video').length;
  const parts: string[] = [];
  if (images > 0) parts.push(`${images} photo${images === 1 ? '' : 's'}`);
  if (videos > 0) parts.push(`${videos} video${videos === 1 ? '' : 's'}`);
  return parts.length > 0 ? parts.join(', ') : 'Note';
}

export function JobNotesEntryCard({
  orgSlug,
  jobId,
  variant,
  returnTo,
  reportDate,
  stageId = null,
  showPreview = false,
}: JobNotesEntryCardProps) {
  const copy = COPY[variant];
  const href = buildJobNotesHref(orgSlug, jobId, {
    mode: variant,
    returnTo,
    reportDate,
    stageId,
  });

  const [previewNotes, setPreviewNotes] = useState<NotePreview[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    if (!showPreview || variant !== 'archive' || !orgSlug || !jobId) return;
    let cancelled = false;
    setPreviewLoading(true);
    fetch(`/api/jobs/${jobId}/notes?orgSlug=${encodeURIComponent(orgSlug)}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled || !data?.ok || !Array.isArray(data.notes)) return;
        setPreviewNotes(data.notes.slice(0, 3));
      })
      .catch(() => {
        if (!cancelled) setPreviewNotes([]);
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showPreview, variant, orgSlug, jobId]);

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">{copy.title}</h2>
        <p className="mt-1 text-sm text-gray-600">{copy.helper}</p>

        {showPreview && variant === 'archive' && (
          <div className="mt-3">
            {previewLoading && <p className="text-xs text-gray-500">Loading recent notes…</p>}
            {!previewLoading && previewNotes.length > 0 && (
              <ul className="space-y-2 border-t border-gray-100 pt-3">
                {previewNotes.map((note) => (
                  <li key={note.id} className="text-sm text-gray-700">
                    <span className="font-medium text-gray-900">{note.author_name}</span>
                    <span className="text-gray-500"> · {formatPreviewDate(note.created_at)}</span>
                    <p className="mt-0.5 text-gray-600">{previewSummary(note)}</p>
                  </li>
                ))}
              </ul>
            )}
            {!previewLoading && previewNotes.length === 0 && (
              <p className="text-xs text-gray-500">No site notes recorded yet.</p>
            )}
          </div>
        )}

        <Link href={href} className={`mt-4 ${copy.ctaClass}`}>
          {copy.cta}
        </Link>
      </div>
    </section>
  );
}
