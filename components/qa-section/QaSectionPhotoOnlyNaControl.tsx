export function QaSectionPhotoOnlyNaControl({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={`flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
        checked
          ? 'border-gray-400 bg-gray-100 text-gray-800 font-semibold'
          : 'border-gray-200 bg-white text-gray-700'
      } ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-gray-50'}`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-[#698F00]"
      />
      <span>N/A — not applicable</span>
    </label>
  );
}
