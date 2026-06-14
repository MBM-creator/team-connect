import Link from 'next/link';
import { qaSectionJobDisplayName, qaSectionTypeLabel } from '@/lib/qa-section-display';

export function QaSectionHeader({
  backHref,
  backLabel = 'Run overview',
  job,
  qaType,
  sectionTitle,
  sectionDescription,
}: {
  backHref: string;
  backLabel?: string;
  job: { name?: string | null; cc_project_title_snapshot?: string | null } | null;
  qaType: string;
  sectionTitle: string;
  sectionDescription?: string;
}) {
  const jobName = qaSectionJobDisplayName(job);
  const typeLabel = qaSectionTypeLabel(qaType);

  return (
    <header className="space-y-2">
      <Link href={backHref} className="text-sm text-[#698F00] hover:underline">
        ← {backLabel}
      </Link>
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
          {jobName} · {typeLabel}
        </p>
        <h1 className="text-xl font-bold text-gray-900">{sectionTitle}</h1>
        {sectionDescription ? <p className="text-sm text-gray-500">{sectionDescription}</p> : null}
      </div>
    </header>
  );
}
