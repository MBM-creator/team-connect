import {
  formatCcStatusLabel,
  lifecycleStatusChipTone,
  type LifecycleStatusChipTone,
} from '@/lib/jobs-list';

const STATUS_CHIP_TONE_CLASS: Record<LifecycleStatusChipTone, string> = {
  active: 'border-sc-status-active-border bg-sc-status-active-bg text-sc-status-active',
  info: 'border-sc-status-info-border bg-sc-status-info-bg text-sc-status-info',
  neutral: 'border-sc-status-neutral-border bg-sc-status-neutral-bg text-sc-status-neutral',
};

type LifecycleStatusChipProps = {
  status: string | null | undefined;
  className?: string;
};

/** Shared lifecycle status chip (Jobs list + job workspace). Colour is stage only — not health. */
export function LifecycleStatusChip({ status, className = '' }: LifecycleStatusChipProps) {
  const label = formatCcStatusLabel(status);
  if (!label) return null;
  const tone = lifecycleStatusChipTone(status);
  return (
    <span
      className={`inline-flex shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium ${STATUS_CHIP_TONE_CLASS[tone]} ${className}`.trim()}
    >
      {label}
    </span>
  );
}
