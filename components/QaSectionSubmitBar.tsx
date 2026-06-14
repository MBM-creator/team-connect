import { qaSectionSubmitDisabledReason } from '@/lib/qa-section-display';

export function QaSectionSubmitBar({
  saving,
  canSubmit,
  isReadOnly,
  isBlocked,
  runStatus,
  label = 'Submit section evidence',
  savingLabel = 'Saving…',
}: {
  saving: boolean;
  canSubmit: boolean;
  isReadOnly: boolean;
  isBlocked: boolean;
  runStatus: string;
  label?: string;
  savingLabel?: string;
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
