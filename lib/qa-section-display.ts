import { qaTypeDisplayLabel } from '@/lib/qa-hub-display';
import type { CrewSectionFieldError } from '@/lib/paving-qa-submit-validation';
import {
  validateCrewSectionPayloadIrrigationFields,
  validateCrewSectionPayloadV2Fields,
} from '@/lib/paving-qa-submit-validation';

export type QaSectionWorkflowStatus =
  | 'pending'
  | 'submitted'
  | 'cleared'
  | 'issue_raised'
  | 'rectification_required'
  | 'rectified_awaiting_supervisor'
  | 'supervisor_approved_to_proceed'
  | 'blocked_by_unresolved_issue';

export type QaSectionStatusConfig = {
  label: string;
  pill: string;
  banner: string;
  bannerClass: string;
};

const QA_SECTION_STATUS_CONFIG: Record<QaSectionWorkflowStatus, QaSectionStatusConfig> = {
  pending: {
    label: 'Not started',
    pill: 'bg-gray-100 text-gray-600',
    banner: 'Record checklist answers and evidence, then submit this section.',
    bannerClass: 'bg-white border-gray-200 text-gray-800',
  },
  submitted: {
    label: 'Submitted',
    pill: 'bg-blue-50 text-blue-800',
    banner: 'Evidence submitted and awaiting supervisor review.',
    bannerClass: 'bg-blue-50 border-blue-200 text-blue-900',
  },
  cleared: {
    label: 'Cleared',
    pill: 'bg-green-50 text-green-800',
    banner: 'This section has been cleared.',
    bannerClass: 'bg-green-50 border-green-200 text-green-900',
  },
  issue_raised: {
    label: 'Issue raised',
    pill: 'bg-red-50 text-red-800',
    banner: 'An issue was raised on this section and needs attention.',
    bannerClass: 'bg-red-50 border-red-200 text-red-900',
  },
  rectification_required: {
    label: 'Rectification required',
    pill: 'bg-red-50 text-red-800',
    banner: 'Rectification is required before this section can proceed.',
    bannerClass: 'bg-red-50 border-red-200 text-red-900',
  },
  rectified_awaiting_supervisor: {
    label: 'Awaiting supervisor',
    pill: 'bg-amber-50 text-amber-900',
    banner: 'Rectification submitted and awaiting supervisor review.',
    bannerClass: 'bg-amber-50 border-amber-200 text-amber-900',
  },
  supervisor_approved_to_proceed: {
    label: 'Approved to proceed',
    pill: 'bg-[#698F00]/10 text-[#4f6f00]',
    banner: 'Supervisor approved this section to proceed.',
    bannerClass: 'bg-[#698F00]/10 border-[#698F00]/30 text-[#4f6f00]',
  },
  blocked_by_unresolved_issue: {
    label: 'Blocked',
    pill: 'bg-amber-50 text-amber-900',
    banner: 'This section is blocked until earlier issues are resolved.',
    bannerClass: 'bg-amber-50 border-amber-200 text-amber-900',
  },
};

export function qaSectionStatusConfig(status: string | null | undefined): QaSectionStatusConfig {
  if (status && status in QA_SECTION_STATUS_CONFIG) {
    return QA_SECTION_STATUS_CONFIG[status as QaSectionWorkflowStatus];
  }
  return QA_SECTION_STATUS_CONFIG.pending;
}

export function qaSectionStatusLabel(status: string | null | undefined): string {
  return qaSectionStatusConfig(status).label;
}

export type QaSectionBlockedBy = {
  section: string;
  reason: string;
};

export type QaSectionBannerInput = {
  sectionStatus: string | null | undefined;
  runStatus: string;
  isReadOnly: boolean;
  isBlocked: boolean;
  blockedBy?: QaSectionBlockedBy[] | null;
  beforeCover?: boolean;
};

export type QaSectionBannerView = {
  title: string;
  message: string;
  className: string;
  blockedReasons?: string[];
  beforeCover?: boolean;
};

export function buildQaSectionBanner(input: QaSectionBannerInput): QaSectionBannerView {
  if (input.isReadOnly) {
    const runLabel = input.runStatus === 'completed' ? 'completed' : input.runStatus || 'not active';
    return {
      title: 'Read-only',
      message: `This QA run is ${runLabel}. Evidence on this section cannot be changed.`,
      className: 'bg-amber-50 border-amber-200 text-amber-900',
    };
  }

  if (input.isBlocked) {
    const blockedReasons = (input.blockedBy ?? []).map((entry) => entry.reason).filter(Boolean);
    return {
      title: 'Section blocked',
      message: qaSectionStatusConfig('blocked_by_unresolved_issue').banner,
      className: qaSectionStatusConfig('blocked_by_unresolved_issue').bannerClass,
      blockedReasons: blockedReasons.length > 0 ? blockedReasons : undefined,
    };
  }

  const statusConfig = qaSectionStatusConfig(input.sectionStatus);
  return {
    title: statusConfig.label,
    message: statusConfig.banner,
    className: statusConfig.bannerClass,
    beforeCover: input.beforeCover,
  };
}

export type QaSectionCatalogueItem = {
  key: string;
  requirePhoto?: boolean;
  requireMarkedImage?: boolean;
  photoOnly?: boolean;
};

export type QaSectionAnswers = Record<string, { result?: string; note?: string }>;

export type QaSectionEvidenceSummary = {
  itemCount: number;
  answeredCount: number;
  requiredPhotoCount: number;
  savedPhotoCount: number;
  newPhotoCount: number;
};

function savedPhotoCountForItem(
  itemKey: string,
  photosByItem: Record<string, unknown[]>,
  savedPhotoCountsByItem?: Record<string, number>
): number {
  if (savedPhotoCountsByItem && itemKey in savedPhotoCountsByItem) {
    return savedPhotoCountsByItem[itemKey] ?? 0;
  }
  return (photosByItem[itemKey] ?? []).length;
}

export function computeQaSectionEvidenceSummary(input: {
  items: QaSectionCatalogueItem[];
  answers: QaSectionAnswers;
  photosByItem: Record<string, unknown[]>;
  photoFiles: Record<string, unknown[]>;
  savedPhotoCountsByItem?: Record<string, number>;
}): QaSectionEvidenceSummary {
  const itemCount = input.items.length;
  let answeredCount = 0;
  let requiredPhotoCount = 0;

  for (const item of input.items) {
    if (item.requirePhoto || item.requireMarkedImage) {
      requiredPhotoCount += 1;
    }
    const result = input.answers[item.key]?.result?.trim();
    if (item.photoOnly) {
      const saved = savedPhotoCountForItem(
        item.key,
        input.photosByItem,
        input.savedPhotoCountsByItem
      );
      const pending = (input.photoFiles[item.key] ?? []).length;
      if (saved > 0 || pending > 0) answeredCount += 1;
    } else if (result) {
      answeredCount += 1;
    }
  }

  let savedPhotoCount = 0;
  if (input.savedPhotoCountsByItem) {
    for (const count of Object.values(input.savedPhotoCountsByItem)) {
      savedPhotoCount += count;
    }
  } else {
    for (const photos of Object.values(input.photosByItem)) {
      savedPhotoCount += photos.length;
    }
  }

  let newPhotoCount = 0;
  for (const files of Object.values(input.photoFiles)) {
    newPhotoCount += files.length;
  }

  return {
    itemCount,
    answeredCount,
    requiredPhotoCount,
    savedPhotoCount,
    newPhotoCount,
  };
}

export function qaSectionSubmitDisabledReason(input: {
  canSubmit: boolean;
  saving: boolean;
  isReadOnly: boolean;
  isBlocked: boolean;
  runStatus: string;
}): string | null {
  if (input.canSubmit || input.saving) return null;
  if (input.isReadOnly) {
    const runLabel = input.runStatus === 'completed' ? 'completed' : input.runStatus || 'not active';
    return `Submit is disabled because this QA run is ${runLabel}.`;
  }
  if (input.isBlocked) {
    return 'Submit is disabled because this section is blocked by an unresolved issue.';
  }
  return 'Submit is disabled.';
}

export function qaSectionJobDisplayName(job: {
  name?: string | null;
  cc_project_title_snapshot?: string | null;
} | null | undefined): string {
  const name = job?.name?.trim();
  if (name) return name;
  const ccTitle = job?.cc_project_title_snapshot?.trim();
  if (ccTitle) return ccTitle;
  return 'Job';
}

export function qaSectionTypeLabel(qaType: string | null | undefined): string {
  return qaTypeDisplayLabel(qaType);
}

// ---------------------------------------------------------------------------
// Phase 4B: client-side field helpers (browser-safe)
// ---------------------------------------------------------------------------

export function buildPhotoCountByItem(input: {
  photosByItem: Record<string, unknown[]>;
  photoFiles: Record<string, unknown[]>;
  existingPhotoCounts?: Record<string, number>;
}): Record<string, number> {
  const counts: Record<string, number> = { ...(input.existingPhotoCounts ?? {}) };

  for (const [key, photos] of Object.entries(input.photosByItem)) {
    counts[key] = photos.length;
  }

  for (const [key, files] of Object.entries(input.photoFiles)) {
    counts[key] = (counts[key] ?? 0) + files.length;
  }

  return counts;
}

export function fieldErrorToUserMessage(error: CrewSectionFieldError): string {
  switch (error.kind) {
    case 'answer':
      return 'Answer this checklist item';
    case 'note':
      return 'Add a required note';
    case 'photo':
      return 'Add at least one photo';
  }
}

export type QaSectionClientValidationResult =
  | { ok: true }
  | {
      ok: false;
      summaryErrors: string[];
      fieldErrors: { itemKey: string; message: string }[];
      invalidItemKeys: string[];
    };

export function validateQaSectionClient(input: {
  qaType: 'paving' | 'irrigation' | 'fencing';
  items: QaSectionCatalogueItem[];
  answers: QaSectionAnswers;
  photosByItem: Record<string, unknown[]>;
  photoFiles: Record<string, unknown[]>;
  existingPhotoCounts?: Record<string, number>;
}): QaSectionClientValidationResult {
  const photoCountByItem = buildPhotoCountByItem({
    photosByItem: input.photosByItem,
    photoFiles: input.photoFiles,
    existingPhotoCounts: input.existingPhotoCounts,
  });

  const rawFieldErrors =
    input.qaType === 'paving'
      ? validateCrewSectionPayloadV2Fields(
          input.items as Parameters<typeof validateCrewSectionPayloadV2Fields>[0],
          input.answers,
          photoCountByItem
        )
      : validateCrewSectionPayloadIrrigationFields(
          input.items as Parameters<typeof validateCrewSectionPayloadIrrigationFields>[0],
          input.answers,
          photoCountByItem
        );

  if (rawFieldErrors.length === 0) {
    return { ok: true };
  }

  const fieldErrors = rawFieldErrors.map((error) => ({
    itemKey: error.itemKey,
    message: fieldErrorToUserMessage(error),
  }));

  const summaryErrors = [...new Set(fieldErrors.map((fe) => fe.message))];
  const invalidItemKeys = [...new Set(fieldErrors.map((fe) => fe.itemKey))];

  return { ok: false, summaryErrors, fieldErrors, invalidItemKeys };
}

export function formatItemPhotoStatus(input: {
  savedCount: number;
  pendingCount: number;
  needsEvidence: boolean;
}): { warning: string | null; status: string | null } {
  if (!input.needsEvidence) {
    return { warning: null, status: null };
  }

  const parts: string[] = [];
  if (input.savedCount > 0) {
    parts.push(`${input.savedCount} saved photo${input.savedCount !== 1 ? 's' : ''}`);
  }
  if (input.pendingCount > 0) {
    parts.push(`${input.pendingCount} new photo${input.pendingCount !== 1 ? 's' : ''} selected`);
  }

  const status = parts.length > 0 ? parts.join(', ') : null;
  const warning =
    input.savedCount + input.pendingCount === 0 ? 'Photo required' : null;

  return { warning, status };
}

export function qaSectionNoteLabel(input: {
  result: string;
  noteRequired: boolean;
}): string {
  if (input.result === 'fail') {
    return 'Failure / issue note';
  }
  if (input.noteRequired) {
    return 'Required note';
  }
  return 'Note';
}

export function scrollToQaSectionItem(itemKey: string): void {
  const el = document.getElementById(`qa-item-${itemKey}`);
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

const QA_SUBMISSION_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** Deterministic AU-style timestamp from ISO digits (no locale APIs). */
export function formatQaSubmissionTimestamp(iso: string | null | undefined): string {
  if (!iso) return '';
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!match) return iso.slice(0, 16).replace('T', ' ');
  const [, year, month, day, hour, minute] = match;
  const monthLabel = QA_SUBMISSION_MONTHS[parseInt(month, 10) - 1] ?? month;
  return `${day} ${monthLabel} ${year}, ${hour}:${minute}`;
}
