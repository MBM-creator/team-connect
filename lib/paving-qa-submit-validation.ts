import type { V2CatalogueItem } from './paving-qa-v2-catalog';
import type { IrrigationCatalogueItem } from './irrigation-qa-v1-catalog';
import type { FencingCatalogueItem } from './fencing-qa-v1-catalog';

// v2 valid results — 'not_required' replaces 'na'; all stored in answers JSONB
const V2_VALID_RESULTS = ['pass', 'fail', 'not_required'] as const;
type V2ItemResult = (typeof V2_VALID_RESULTS)[number];

export type CrewSectionFieldErrorKind = 'answer' | 'note' | 'photo';

export type CrewSectionFieldError = {
  itemKey: string;
  kind: CrewSectionFieldErrorKind;
  /** Distinguishes fail-note vs noteRequiredWhen for server error string parity */
  noteReason?: 'fail' | 'required_when';
  /** Distinguishes missing answer vs disallowed N/A */
  answerReason?: 'missing' | 'na_not_allowed';
};

type AnswersMap = Record<string, { result?: string; note?: string }>;

function formatV2FieldError(
  item: { key: string; label: string },
  error: CrewSectionFieldError
): string {
  switch (error.kind) {
    case 'answer':
      return `Item "${item.label}": result required (pass, fail, or not_required)`;
    case 'note':
      return error.noteReason === 'required_when'
        ? `Item "${item.label}": note required for this answer`
        : `Item "${item.label}": note required when failed`;
    case 'photo':
      return `Item "${item.label}": at least one photo required`;
  }
}

function formatIrrigationFieldError(
  item: { key: string; label: string; requireMarkedImage?: boolean },
  error: CrewSectionFieldError
): string {
  switch (error.kind) {
    case 'answer':
      if (error.answerReason === 'na_not_allowed') {
        return `Item "${item.label}": N/A is not allowed`;
      }
      return `Item "${item.label}": result required (pass, fail, or not_required)`;
    case 'note':
      return error.noteReason === 'required_when'
        ? `Item "${item.label}": note required for this answer`
        : `Item "${item.label}": note required when failed`;
    case 'photo':
      return item.requireMarkedImage
        ? `Item "${item.label}": at least one marked-up image required`
        : `Item "${item.label}": at least one photo required`;
  }
}

/**
 * Field-level validation for paving v2 sections. Browser-safe (type-only imports).
 */
export function validateCrewSectionPayloadV2Fields(
  items: V2CatalogueItem[],
  answers: AnswersMap,
  photoCountByItem: Record<string, number>
): CrewSectionFieldError[] {
  const fieldErrors: CrewSectionFieldError[] = [];

  for (const item of items) {
    if (item.photoOnly) {
      const result = (answers[item.key]?.result ?? '').trim();
      if (item.allowNa && result === 'not_required') {
        continue;
      }
      if (item.requirePhoto) {
        const n = photoCountByItem[item.key] ?? 0;
        if (n < 1) {
          fieldErrors.push({ itemKey: item.key, kind: 'photo' });
        }
      }
      continue;
    }

    const a = answers[item.key];
    const result = (a?.result ?? '').trim() as V2ItemResult | '';

    if (!V2_VALID_RESULTS.includes(result as V2ItemResult)) {
      fieldErrors.push({ itemKey: item.key, kind: 'answer' });
      continue;
    }

    if (result === 'fail') {
      const note = (a?.note ?? '').trim();
      if (!note) {
        fieldErrors.push({ itemKey: item.key, kind: 'note', noteReason: 'fail' });
      }
    } else {
      const nrw = item.noteRequiredWhen ?? [];
      if (nrw.includes(result as V2ItemResult) && !(a?.note ?? '').trim()) {
        fieldErrors.push({ itemKey: item.key, kind: 'note', noteReason: 'required_when' });
      }
    }

    if (item.requirePhoto && result !== 'not_required') {
      const n = photoCountByItem[item.key] ?? 0;
      if (n < 1) {
        fieldErrors.push({ itemKey: item.key, kind: 'photo' });
      }
    }
  }

  return fieldErrors;
}

/**
 * Validate a crew section submission payload for a v2 section.
 * Valid results are: pass, fail, not_required.
 */
export function validateCrewSectionPayloadV2(
  items: V2CatalogueItem[],
  answers: AnswersMap,
  photoCountByItem: Record<string, number>
): { ok: true } | { ok: false; errors: string[] } {
  const fieldErrors = validateCrewSectionPayloadV2Fields(items, answers, photoCountByItem);
  if (fieldErrors.length) {
    const errors = fieldErrors.map((fe) => {
      const item = items.find((i) => i.key === fe.itemKey);
      return formatV2FieldError(item ?? { key: fe.itemKey, label: fe.itemKey }, fe);
    });
    return { ok: false, errors };
  }
  return { ok: true };
}

/**
 * Field-level validation for irrigation/fencing sections. Browser-safe (type-only imports).
 */
export function validateCrewSectionPayloadIrrigationFields(
  items: IrrigationCatalogueItem[] | FencingCatalogueItem[],
  answers: AnswersMap,
  photoCountByItem: Record<string, number>
): CrewSectionFieldError[] {
  const fieldErrors: CrewSectionFieldError[] = [];

  for (const item of items) {
    if ('photoOnly' in item && item.photoOnly) {
      const result = (answers[item.key]?.result ?? '').trim();
      if (item.allowNa && result === 'not_required') {
        continue;
      }
      if (item.requirePhoto || item.requireMarkedImage) {
        const n = photoCountByItem[item.key] ?? 0;
        if (n < 1) {
          fieldErrors.push({ itemKey: item.key, kind: 'photo' });
        }
      }
      continue;
    }

    const a = answers[item.key];
    const result = (a?.result ?? '').trim() as V2ItemResult | '';

    if (!V2_VALID_RESULTS.includes(result as V2ItemResult)) {
      fieldErrors.push({ itemKey: item.key, kind: 'answer' });
      continue;
    }

    if (result === 'not_required' && !item.allowNa) {
      fieldErrors.push({ itemKey: item.key, kind: 'answer', answerReason: 'na_not_allowed' });
      continue;
    }

    if (result === 'fail') {
      const note = (a?.note ?? '').trim();
      if (!note) fieldErrors.push({ itemKey: item.key, kind: 'note', noteReason: 'fail' });
    } else {
      const nrw = item.noteRequiredWhen ?? [];
      if (nrw.includes(result as V2ItemResult) && !(a?.note ?? '').trim()) {
        fieldErrors.push({ itemKey: item.key, kind: 'note', noteReason: 'required_when' });
      }
    }

    if ((item.requirePhoto || item.requireMarkedImage) && result !== 'not_required') {
      const n = photoCountByItem[item.key] ?? 0;
      if (n < 1) {
        fieldErrors.push({ itemKey: item.key, kind: 'photo' });
      }
    }
  }

  return fieldErrors;
}

export function validateCrewSectionPayloadIrrigation(
  items: IrrigationCatalogueItem[] | FencingCatalogueItem[],
  answers: AnswersMap,
  photoCountByItem: Record<string, number>
): { ok: true } | { ok: false; errors: string[] } {
  const fieldErrors = validateCrewSectionPayloadIrrigationFields(items, answers, photoCountByItem);
  if (fieldErrors.length) {
    const errors = fieldErrors.map((fe) => {
      const item = items.find((i) => i.key === fe.itemKey);
      return formatIrrigationFieldError(
        item ?? { key: fe.itemKey, label: fe.itemKey },
        fe
      );
    });
    return { ok: false, errors };
  }
  return { ok: true };
}
