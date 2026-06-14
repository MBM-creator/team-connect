import type { V2CatalogueItem } from './paving-qa-v2-catalog';
import type { IrrigationCatalogueItem } from './irrigation-qa-v1-catalog';
import type { FencingCatalogueItem } from './fencing-qa-v1-catalog';

// v2 valid results — 'not_required' replaces 'na'; all stored in answers JSONB
const V2_VALID_RESULTS = ['pass', 'fail', 'not_required'] as const;
type V2ItemResult = (typeof V2_VALID_RESULTS)[number];

/**
 * Validate a crew section submission payload for a v2 section.
 * Valid results are: pass, fail, not_required.
 */
export function validateCrewSectionPayloadV2(
  items: V2CatalogueItem[],
  answers: Record<string, { result?: string; note?: string }>,
  photoCountByItem: Record<string, number>
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];

  for (const item of items) {
    if (item.photoOnly) {
      const result = (answers[item.key]?.result ?? '').trim();
      if (item.allowNa && result === 'not_required') {
        continue;
      }
      if (item.requirePhoto) {
        const n = photoCountByItem[item.key] ?? 0;
        if (n < 1) {
          errors.push(`Item "${item.label}": at least one photo required`);
        }
      }
      continue;
    }

    const a = answers[item.key];
    const result = (a?.result ?? '').trim() as V2ItemResult | '';

    if (!V2_VALID_RESULTS.includes(result as V2ItemResult)) {
      errors.push(`Item "${item.label}": result required (pass, fail, or not_required)`);
      continue;
    }

    if (result === 'fail') {
      const note = (a?.note ?? '').trim();
      if (!note) {
        errors.push(`Item "${item.label}": note required when failed`);
      }
    } else {
      const nrw = item.noteRequiredWhen ?? [];
      if (nrw.includes(result as V2ItemResult) && !(a?.note ?? '').trim()) {
        errors.push(`Item "${item.label}": note required for this answer`);
      }
    }

    if (item.requirePhoto && result !== 'not_required') {
      const n = photoCountByItem[item.key] ?? 0;
      if (n < 1) {
        errors.push(`Item "${item.label}": at least one photo required`);
      }
    }
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true };
}

export function validateCrewSectionPayloadIrrigation(
  items: IrrigationCatalogueItem[] | FencingCatalogueItem[],
  answers: Record<string, { result?: string; note?: string }>,
  photoCountByItem: Record<string, number>
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];

  for (const item of items) {
    if ('photoOnly' in item && item.photoOnly) {
      const result = (answers[item.key]?.result ?? '').trim();
      if (item.allowNa && result === 'not_required') {
        continue;
      }
      if (item.requirePhoto || item.requireMarkedImage) {
        const n = photoCountByItem[item.key] ?? 0;
        if (n < 1) {
          errors.push(
            item.requireMarkedImage
              ? `Item "${item.label}": at least one marked-up image required`
              : `Item "${item.label}": at least one photo required`
          );
        }
      }
      continue;
    }

    const a = answers[item.key];
    const result = (a?.result ?? '').trim() as V2ItemResult | '';

    if (!V2_VALID_RESULTS.includes(result as V2ItemResult)) {
      errors.push(`Item "${item.label}": result required (pass, fail, or not_required)`);
      continue;
    }

    if (result === 'not_required' && !item.allowNa) {
      errors.push(`Item "${item.label}": N/A is not allowed`);
      continue;
    }

    if (result === 'fail') {
      const note = (a?.note ?? '').trim();
      if (!note) errors.push(`Item "${item.label}": note required when failed`);
    } else {
      const nrw = item.noteRequiredWhen ?? [];
      if (nrw.includes(result as V2ItemResult) && !(a?.note ?? '').trim()) {
        errors.push(`Item "${item.label}": note required for this answer`);
      }
    }

    if ((item.requirePhoto || item.requireMarkedImage) && result !== 'not_required') {
      const n = photoCountByItem[item.key] ?? 0;
      if (n < 1) {
        errors.push(
          item.requireMarkedImage
            ? `Item "${item.label}": at least one marked-up image required`
            : `Item "${item.label}": at least one photo required`
        );
      }
    }
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true };
}
