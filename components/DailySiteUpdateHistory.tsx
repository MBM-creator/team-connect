'use client';

import { useState } from 'react';
import { formatAustralianDateTime } from '@/lib/australian-date';
import type { DailySiteUpdateApiRow, OnTrackStatus } from '@/lib/daily-site-update-shared';

interface DailySiteUpdateHistoryProps {
  orgSlug: string;
  jobId: string;
  updates: DailySiteUpdateApiRow[];
  showVoided: boolean;
  onToggleShowVoided: () => void;
  canViewVoided: boolean;
  onVoid: (updateId: string, voidReason: string) => Promise<void>;
  voidingId: string | null;
}

const ON_TRACK_LABELS: Record<OnTrackStatus, string> = {
  on_track: 'On track',
  at_risk: 'At risk',
  off_track: 'Off track',
  unknown: 'Unknown',
};

const ON_TRACK_CLASSES: Record<OnTrackStatus, string> = {
  on_track: 'bg-[#698F00]/10 text-[#4f6f00] border-[#698F00]/20',
  at_risk: 'bg-amber-50 text-amber-800 border-amber-200',
  off_track: 'bg-red-50 text-red-800 border-red-200',
  unknown: 'bg-gray-100 text-gray-700 border-gray-200',
};

function fieldBlock(label: string, value: string, noneFlag?: boolean, noneLabel?: string) {
  if (noneFlag) {
    return (
      <div>
        <p className="text-xs font-medium text-gray-500">{label}</p>
        <p className="mt-0.5 text-sm text-gray-600 italic">{noneLabel}</p>
      </div>
    );
  }
  if (!value.trim()) return null;
  return (
    <div>
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className="mt-0.5 text-sm text-gray-800 whitespace-pre-wrap">{value}</p>
    </div>
  );
}

function VoidControls({
  update,
  onVoid,
  voidingId,
}: {
  update: DailySiteUpdateApiRow;
  onVoid: (updateId: string, voidReason: string) => Promise<void>;
  voidingId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!update.canVoid) return null;

  async function submitVoid() {
    const trimmed = reason.trim();
    if (!trimmed) {
      setError('A reason is required to void this update');
      return;
    }
    setError(null);
    try {
      await onVoid(update.id, trimmed);
      setOpen(false);
      setReason('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to void update');
    }
  }

  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-sm font-medium text-red-700 hover:underline"
        >
          Void update
        </button>
      ) : (
        <div className="space-y-2">
          <label className="block text-xs font-medium text-gray-700" htmlFor={`void-reason-${update.id}`}>
            Void reason
          </label>
          <textarea
            id={`void-reason-${update.id}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            placeholder="Why is this update being voided?"
          />
          {error && <p className="text-sm text-red-700">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={voidingId === update.id}
              onClick={() => void submitVoid()}
              className="rounded-lg bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50"
            >
              {voidingId === update.id ? 'Voiding…' : 'Confirm void'}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setReason('');
                setError(null);
              }}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function DailySiteUpdateHistory({
  updates,
  showVoided,
  onToggleShowVoided,
  canViewVoided,
  onVoid,
  voidingId,
}: DailySiteUpdateHistoryProps) {
  if (updates.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-900">Daily site update history</h3>
        <p className="mt-2 text-sm text-gray-600">No daily site updates yet.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">Daily site update history</h3>
        {canViewVoided && (
          <button
            type="button"
            onClick={onToggleShowVoided}
            className="text-xs font-medium text-[#698F00] hover:underline"
          >
            {showVoided ? 'Hide voided' : 'Show voided'}
          </button>
        )}
      </div>

      <ul className="mt-4 space-y-4">
        {updates.map((update) => (
          <li
            key={update.id}
            className={`rounded-lg border p-4 ${update.voidedAt ? 'border-gray-200 bg-gray-50 opacity-80' : 'border-gray-200 bg-white'}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-gray-900">{update.authorName}</p>
                <p className="text-xs text-gray-500">
                  {update.reportDate}
                  {update.stageName ? ` · ${update.stageName}` : ' · Job level'}
                  {' · '}
                  {formatAustralianDateTime(update.submittedAt)}
                </p>
              </div>
              <span
                className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${ON_TRACK_CLASSES[update.onTrackStatus]}`}
              >
                {ON_TRACK_LABELS[update.onTrackStatus]}
              </span>
            </div>

            {update.voidedAt && (
              <p className="mt-2 text-xs font-medium text-red-700">
                Voided{update.voidReason ? `: ${update.voidReason}` : ''}
              </p>
            )}

            <div className="mt-3 space-y-3">
              {fieldBlock('Progress today', update.progressToday)}
              {fieldBlock('Issues faced', update.issuesFaced, update.issuesFacedNone, 'No issues today')}
              {fieldBlock(
                'Problems resolved',
                update.problemsResolved,
                update.problemsResolvedNone,
                'Nothing resolved today'
              )}
              {fieldBlock(
                'Prevention / future',
                update.preventionPlan,
                update.preventionPlanNone,
                'No prevention action required'
              )}
              {update.onTrackNotes && fieldBlock('On-track notes', update.onTrackNotes)}
            </div>

            {!update.voidedAt && (
              <VoidControls update={update} onVoid={onVoid} voidingId={voidingId} />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export type { DailySiteUpdateApiRow };
