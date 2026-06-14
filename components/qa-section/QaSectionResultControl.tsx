type ResultValue = 'pass' | 'fail' | 'not_required';

const OPTION_META: Record<
  ResultValue,
  { label: string; selectedClass: string; unselectedClass: string }
> = {
  pass: {
    label: 'Pass',
    selectedClass: 'border-[#698F00] bg-[#698F00]/10 text-[#4f6f00] font-semibold',
    unselectedClass: 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50',
  },
  fail: {
    label: 'Fail',
    selectedClass: 'border-red-500 bg-red-50 text-red-900 font-semibold',
    unselectedClass: 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50',
  },
  not_required: {
    label: 'N/A',
    selectedClass: 'border-gray-400 bg-gray-100 text-gray-800 font-semibold',
    unselectedClass: 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50',
  },
};

export function QaSectionResultControl({
  value,
  allowNa,
  disabled,
  onChange,
}: {
  value: string;
  allowNa: boolean;
  disabled: boolean;
  onChange: (result: ResultValue) => void;
}) {
  const options: ResultValue[] = allowNa
    ? ['pass', 'fail', 'not_required']
    : ['pass', 'fail'];

  return (
    <div
      className={`grid w-full gap-2 ${options.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}
      role="radiogroup"
      aria-label="Checklist result"
    >
      {options.map((option) => {
        const meta = OPTION_META[option];
        const selected = value === option;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(option)}
            className={`min-h-11 rounded-lg border px-3 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              selected ? meta.selectedClass : meta.unselectedClass
            }`}
          >
            {meta.label}
          </button>
        );
      })}
    </div>
  );
}
