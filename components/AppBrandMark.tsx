import {
  APP_LOGO_FULL_SRC,
  APP_LOGO_ICON_SRC,
  APP_NAME,
} from '@/lib/app-branding';

type AppBrandMarkProps = {
  className?: string;
  variant?: 'full' | 'icon';
};

export function AppBrandMark({ className = '', variant = 'icon' }: AppBrandMarkProps) {
  if (variant === 'full') {
    return (
      <img
        src={APP_LOGO_FULL_SRC}
        alt={APP_NAME}
        width={188}
        height={32}
        className={`h-8 w-auto ${className}`.trim()}
      />
    );
  }

  return (
    <img
      src={APP_LOGO_ICON_SRC}
      alt={APP_NAME}
      width={32}
      height={32}
      className={`h-8 w-8 ${className}`.trim()}
    />
  );
}
