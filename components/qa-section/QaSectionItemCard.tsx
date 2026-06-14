import { formatItemPhotoStatus, qaSectionNoteLabel } from '@/lib/qa-section-display';
import { QaSectionPhotoOnlyNaControl } from './QaSectionPhotoOnlyNaControl';
import { QaSectionResultControl } from './QaSectionResultControl';

export type QaSectionItemCardItem = {
  key: string;
  label: string;
  staffNote?: string;
  allowNa?: boolean;
  requirePhoto?: boolean;
  requireMarkedImage?: boolean;
  photoOnly?: boolean;
  noteRequiredWhen?: ('pass' | 'fail' | 'not_required')[];
  notePrompt?: string;
};

type PhotoRow = {
  id: string;
  signed_url: string | null;
};

function SavedPhotos({ photos, savedCount }: { photos: PhotoRow[]; savedCount: number }) {
  if (savedCount === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-gray-600">
        Saved evidence ({savedCount} photo{savedCount !== 1 ? 's' : ''})
      </p>
      {photos.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {photos.map((photo) =>
            photo.signed_url ? (
              <a key={photo.id} href={photo.signed_url} target="_blank" rel="noopener noreferrer">
                <img
                  src={photo.signed_url}
                  alt="Evidence"
                  className="h-14 w-14 rounded border border-gray-200 object-cover hover:opacity-80"
                />
              </a>
            ) : (
              <div
                key={photo.id}
                className="flex h-14 w-14 items-center justify-center rounded border border-gray-200 bg-gray-50"
              >
                <span className="text-xs text-gray-400">No preview</span>
              </div>
            )
          )}
        </div>
      ) : (
        <p className="text-xs text-gray-400">Loading previews…</p>
      )}
    </div>
  );
}

export function QaSectionItemCard({
  item,
  answer,
  canSubmit,
  savedPhotos,
  savedPhotoCount,
  previews,
  fieldErrors = [],
  isInvalid = false,
  onResult,
  onNote,
  onFiles,
}: {
  item: QaSectionItemCardItem;
  answer: { result?: string; note?: string } | undefined;
  canSubmit: boolean;
  savedPhotos: PhotoRow[];
  savedPhotoCount: number;
  previews: string[];
  fieldErrors?: string[];
  isInvalid?: boolean;
  onResult: (result: string) => void;
  onNote: (note: string) => void;
  onFiles: (files: FileList | null) => void;
}) {
  const result = answer?.result ?? '';
  const noteRequired =
    !item.photoOnly &&
    (result === 'fail' ||
      (item.noteRequiredWhen ?? []).includes(result as 'pass' | 'fail' | 'not_required'));
  const needsEvidence =
    (item.requirePhoto || item.requireMarkedImage) &&
    (item.photoOnly || result !== 'not_required');
  const isFail = result === 'fail';
  const photoStatus = formatItemPhotoStatus({
    savedCount: savedPhotoCount,
    pendingCount: previews.length,
    needsEvidence: Boolean(needsEvidence),
  });

  let cardClass = 'bg-white border border-gray-200';
  if (isInvalid) {
    cardClass = 'bg-red-50/30 border-red-400 ring-1 ring-red-200';
  } else if (isFail) {
    cardClass = 'bg-red-50/40 border-red-200';
  }

  return (
    <div
      id={`qa-item-${item.key}`}
      className={`rounded-lg p-4 shadow-sm space-y-3 ${cardClass}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-gray-900">{item.label}</p>
          {item.staffNote ? (
            <p className="mt-1 text-xs text-amber-800">{item.staffNote}</p>
          ) : null}
        </div>
        {(item.requirePhoto || item.requireMarkedImage) && !photoStatus.warning ? (
          <span className="flex-none rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
            {item.requireMarkedImage ? 'Marked-up image required' : 'Photo required'}
          </span>
        ) : null}
      </div>

      {photoStatus.warning ? (
        <p className="text-xs font-medium text-amber-800">{photoStatus.warning}</p>
      ) : null}
      {photoStatus.status ? (
        <p className="text-xs text-gray-600">{photoStatus.status}</p>
      ) : null}

      {!item.photoOnly ? (
        <QaSectionResultControl
          value={result}
          allowNa={Boolean(item.allowNa)}
          disabled={!canSubmit}
          onChange={onResult}
        />
      ) : item.allowNa ? (
        <QaSectionPhotoOnlyNaControl
          checked={result === 'not_required'}
          disabled={!canSubmit}
          onChange={(checked) => onResult(checked ? 'not_required' : '')}
        />
      ) : null}

      {!item.photoOnly && (noteRequired || Boolean(answer?.note)) ? (
        <div className="space-y-1">
          <p className="text-xs font-medium text-gray-700">
            {qaSectionNoteLabel({ result, noteRequired })}
            {noteRequired ? <span className="ml-0.5 text-red-500">*</span> : null}
          </p>
          <textarea
            rows={2}
            disabled={!canSubmit}
            value={answer?.note ?? ''}
            onChange={(e) => onNote(e.target.value)}
            placeholder={
              item.notePrompt ??
              (result === 'fail' ? 'Describe the issue' : 'Record required note')
            }
            className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
          />
        </div>
      ) : null}

      {fieldErrors.length > 0 ? (
        <ul className="space-y-0.5">
          {fieldErrors.map((message, index) => (
            <li key={`${index}:${message}`} className="text-xs font-medium text-red-700">
              {message}
            </li>
          ))}
        </ul>
      ) : null}

      <SavedPhotos photos={savedPhotos} savedCount={savedPhotoCount} />

      {needsEvidence ? (
        <div>
          <p className="mb-1.5 text-xs text-gray-600">
            {savedPhotoCount > 0
              ? 'Add more evidence (optional)'
              : item.requireMarkedImage
                ? 'Marked-up image'
                : 'Photos'}
          </p>
          <label
            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium ${
              canSubmit
                ? 'cursor-pointer border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                : 'cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400'
            }`}
          >
            Choose images
            <input
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              disabled={!canSubmit}
              className="sr-only"
              onChange={(e) => onFiles(e.target.files)}
            />
          </label>
          {previews.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {previews.map((url, i) => (
                <img
                  key={i}
                  src={url}
                  alt={`New evidence ${i + 1}`}
                  className="h-14 w-14 rounded border border-[#698F00]/40 object-cover"
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
