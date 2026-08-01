export const JOB_PLAN_MAX_BYTES = 20 * 1024 * 1024;
export const JOB_PLAN_MAX_PER_JOB = 50;

export const JOB_PLAN_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type JobPlanMimeType = (typeof JOB_PLAN_MIME_TYPES)[number];

export function isAllowedJobPlanMimeType(value: string): value is JobPlanMimeType {
  const lower = value.toLowerCase();
  if (JOB_PLAN_MIME_TYPES.includes(lower as JobPlanMimeType)) return true;
  return lower.startsWith('image/');
}
