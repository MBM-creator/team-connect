import type { QaSectionEvidenceSummary as QaSectionEvidenceSummaryData } from '@/lib/qa-section-display';

export function QaSectionEvidenceSummary({ summary }: { summary: QaSectionEvidenceSummaryData }) {
  const rows = [
    { label: 'Checklist items', value: summary.itemCount },
    { label: 'Answered', value: summary.answeredCount },
    { label: 'Photo-required items', value: summary.requiredPhotoCount },
    { label: 'Saved photos', value: summary.savedPhotoCount },
    { label: 'New photos', value: summary.newPhotoCount },
  ];

  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Evidence summary</p>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
        {rows.map((row) => (
          <div key={row.label}>
            <dt className="text-gray-500">{row.label}</dt>
            <dd className="font-medium text-gray-900">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
