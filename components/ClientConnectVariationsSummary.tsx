import type { CcProjectVariation } from '@/lib/cc-client';

const VARIATIONS_APP_URL = 'https://variations.madebymobbs.com.au/';

type ClientConnectVariationsSummaryProps = {
  variations: CcProjectVariation[];
  className?: string;
};

function formatMoney(value: number | null): string | null {
  if (value == null) return null;
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(value);
}

function variationLabel(variation: CcProjectVariation): string {
  const number = variation.number != null ? `Variation ${variation.number}` : 'Variation';
  return variation.title ? `${number}: ${variation.title}` : number;
}

export function ClientConnectVariationsSummary({
  variations,
  className = '',
}: ClientConnectVariationsSummaryProps) {
  return (
    <section className={className}>
      <h2 className="text-lg font-semibold text-gray-900 mb-2">Variations</h2>
      {variations.length === 0 ? (
        <p className="text-sm text-gray-500">No variations linked to this project yet.</p>
      ) : (
        <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
          {variations.map((variation) => {
            const amount = formatMoney(variation.total_inc_gst);
            return (
              <li key={variation.id} className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{variationLabel(variation)}</p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {variation.section_name ?? 'Unassigned section'}
                      {variation.section_trade ? ` · ${variation.section_trade.replace('_', ' ')}` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-700">{amount ?? 'Amount not set'}</p>
                    <p className="mt-0.5 text-xs text-gray-500">{variation.variation_status ?? variation.status}</p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3">
        <a
          href={VARIATIONS_APP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium text-[#698F00] hover:underline"
        >
          Open variations app →
        </a>
      </p>
    </section>
  );
}
