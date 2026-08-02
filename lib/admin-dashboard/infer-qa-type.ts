import type { QaType } from '@/lib/qa-run-bundle';

type StageHint = {
  name: string;
  cc_section_trade?: string | null;
  templateName?: string | null;
};

function haystack(stage: StageHint): string {
  return [
    stage.name,
    stage.cc_section_trade ?? '',
  ]
    .join(' ')
    .toLowerCase()
    .replace(/_/g, ' ');
}

export function inferQaTypesFromStage(stage: StageHint | null): QaType[] {
  if (!stage) return [];
  const text = haystack(stage);
  const templateName = (stage.templateName ?? '').toLowerCase();
  const types: QaType[] = [];
  if (text.includes('paving') || templateName.includes('paving')) types.push('paving');
  if (text.includes('irrigation') || templateName.includes('irrigation')) types.push('irrigation');
  if (
    text.includes('fencing') ||
    templateName.includes('fencing') ||
    templateName.includes('fence')
  ) {
    types.push('fencing');
  }
  return types;
}

export function inferMissingQaTypes(
  stage: StageHint | null,
  activeRunTypes: Set<string>
): QaType[] {
  return inferQaTypesFromStage(stage).filter((type) => !activeRunTypes.has(type));
}
