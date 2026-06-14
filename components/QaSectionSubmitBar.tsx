import { qaSectionSubmitDisabledReason } from '@/lib/qa-section-display';

export function QaSectionSubmitBar({
  saving,
  canSubmit,
  isReadOnly,
  isBlocked,
  runStatus,
  label = 'Submit section evidence',
  savingLabel = 'Saving…',
  validationErrors,
}: {
  saving: boolean;
  canSubmit: boolean;
  isReadOnly: boolean;
  isBlocked: boolean;
  runStatus: string;
  label?: string;
  savingLabel?: string;
  validationErrors?: string[];
}) {
  const disabledReason = qaSectionSubmitDisabledReason({
    canSubmit,
    saving,
    isReadOnly,
    isBlocked,
    runStatus,
  });

  return (
    <div className="space-y-2">
      {validationErrors && validationErrors.length > 0 ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <p className="font-semibold">Fix these items before submitting:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {validationErrors.map((message, index) => (
              <li key={`${index}:${message}`}>{message}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <button
        type="submit"
        disabled={saving || !canSubmit}
        className="w-full rounded-lg bg-[#698F00] py-2 font-medium text-white disabled:bg-gray-400"
      >
        {saving ? savingLabel : label}
      </button>
      {disabledReason ? <p className="text-xs text-gray-500">{disabledReason}</p> : null}
    </div>
  );
}
