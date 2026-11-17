'use client';

import { formatAustralianCalendarDate } from '@/lib/australian-date';

type Props = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
  required?: boolean;
};

/**
 * A native calendar picker with a consistent dd/mm/yyyy visual field.
 * Native date input values remain ISO YYYY-MM-DD for API and database safety.
 */
export function AustralianDatePicker({ id, value, onChange, className = '', disabled = false, required = false }: Props) {
  return (
    <div className="relative">
      <input
        type="text"
        className={className}
        value={formatAustralianCalendarDate(value)}
        placeholder="dd/mm/yyyy"
        readOnly
        aria-hidden="true"
        tabIndex={-1}
        disabled={disabled}
      />
      <input
        id={id}
        type="date"
        lang="en-AU"
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        value={value}
        disabled={disabled}
        required={required}
        aria-label="Choose date (day/month/year)"
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
