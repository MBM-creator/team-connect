import { buildQaSectionBanner, type QaSectionBlockedBy } from '@/lib/qa-section-display';

export function QaSectionStateBanner({
  sectionStatus,
  runStatus,
  isReadOnly,
  isBlocked,
  blockedBy,
  beforeCover,
}: {
  sectionStatus: string | null | undefined;
  runStatus: string;
  isReadOnly: boolean;
  isBlocked: boolean;
  blockedBy?: QaSectionBlockedBy[] | null;
  beforeCover?: boolean;
}) {
  const banner = buildQaSectionBanner({
    sectionStatus,
    runStatus,
    isReadOnly,
    isBlocked,
    blockedBy,
    beforeCover,
  });

  return (
    <div className={`mt-4 rounded-lg border p-3 text-sm ${banner.className}`}>
      <p className="font-semibold">{banner.title}</p>
      <p className="mt-1">{banner.message}</p>
      {banner.beforeCover ? (
        <p className="mt-2 text-xs font-medium text-amber-800">Before-cover hold point</p>
      ) : null}
      {banner.blockedReasons && banner.blockedReasons.length > 0 ? (
        <ul className="mt-2 list-disc space-y-0.5 pl-4">
          {banner.blockedReasons.map((reason, index) => (
            <li key={`${index}:${reason}`}>{reason}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
