import { APP_NAME } from '@/lib/app-branding';

type AppBrandMarkProps = {
  className?: string;
};

export function AppBrandMark({ className = '' }: AppBrandMarkProps) {
  return (
    <p className={`text-sm font-semibold uppercase tracking-wide text-[#698F00] ${className}`.trim()}>
      {APP_NAME}
    </p>
  );
}
