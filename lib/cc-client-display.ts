import type { CcProject } from '@/lib/cc-client';

/** True when a contact string looks like a real phone/mobile, not an email or internal id. */
export function isDisplayableClientPhone(value: string | null | undefined): boolean {
  const contact = value?.trim() ?? '';
  if (!contact) return false;
  if (contact.includes('@')) return false;
  if (/pipeline\.local/i.test(contact)) return false;
  if (/^lead[-_]/i.test(contact)) return false;
  const digits = contact.replace(/\D/g, '');
  return digits.length >= 8;
}

/** Phone/mobile only — never emails or internal pipeline identifiers. */
export function ccClientPhone(
  project: Pick<CcProject, 'client_contact'>
): string | null {
  const contact = project.client_contact?.trim() ?? '';
  return isDisplayableClientPhone(contact) ? contact : null;
}

/**
 * Format recognised Australian mobile numbers for display (e.g. 0409 797 414).
 * Returns the original string unchanged when the pattern is not recognised.
 * Does not mutate stored/API values — use the original for tel: links.
 */
export function formatAustralianMobileDisplay(
  value: string | null | undefined
): string | null {
  if (value == null) return null;
  const original = value.trim();
  if (!original) return null;

  const digits = original.replace(/\D/g, '');
  let localMobile: string | null = null;

  if (/^04\d{8}$/.test(digits)) {
    localMobile = digits;
  } else if (/^614\d{8}$/.test(digits)) {
    localMobile = `0${digits.slice(2)}`;
  }

  if (!localMobile) return original;
  return `${localMobile.slice(0, 4)} ${localMobile.slice(4, 7)} ${localMobile.slice(7)}`;
}

/** Client name only (no contact suffix). */
export function ccClientDisplayName(
  project: Pick<CcProject, 'client_name'>
): string {
  return project.client_name.trim();
}

/**
 * Strip contact/rubbish suffixes from stored snapshots like
 * "Justin Manchester — lead-…@pipeline.local".
 */
export function sanitizeClientNameSnapshot(
  value: string | null | undefined
): string | null {
  const raw = value?.trim() ?? '';
  if (!raw) return null;

  const separators = [' — ', ' - ', ' – '];
  for (const sep of separators) {
    const idx = raw.indexOf(sep);
    if (idx === -1) continue;
    const left = raw.slice(0, idx).trim();
    if (left) return left;
  }

  if (raw.includes('@') || /pipeline\.local/i.test(raw) || /^lead[-_]/i.test(raw)) {
    return null;
  }

  return raw;
}

export type ClientFacingDetails = {
  name: string;
  phone: string | null;
  address: string | null;
};

function normalizeSiteAddress(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed || null;
}

/** Extract suburb from a comma-separated Australian site address. */
export function extractSuburbFromAddress(address: string | null | undefined): string | null {
  const normalized = normalizeSiteAddress(address);
  if (!normalized) return null;

  const parts = normalized.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];

  const lastPart = parts[parts.length - 1];
  const isPostcode = /^\d{4}$/.test(lastPart);
  const isState = /^(VIC|NSW|QLD|SA|WA|TAS|NT|ACT)$/i.test(lastPart);
  const isStatePostcode = /^(VIC|NSW|QLD|SA|WA|TAS|NT|ACT)\s+\d{4}$/i.test(lastPart);

  if ((isPostcode || isState || isStatePostcode) && parts.length >= 2) {
    return parts[parts.length - 2];
  }

  return lastPart;
}

/** Compact location for list cards: suburb when parseable, otherwise full address. */
export function siteLocationForList(address: string | null | undefined): string | null {
  const normalized = normalizeSiteAddress(address);
  if (!normalized) return null;
  return extractSuburbFromAddress(normalized) ?? normalized;
}

/** Prefer live project fields; fall back to clean snapshots / job name. */
export function clientFacingDetails(input: {
  project?: Pick<CcProject, 'client_name' | 'client_contact' | 'site_address'> | null;
  clientNameSnapshot?: string | null;
  projectTitleSnapshot?: string | null;
  siteAddressSnapshot?: string | null;
  jobName?: string | null;
}): ClientFacingDetails {
  const project = input.project ?? null;
  const snapshotAddress = normalizeSiteAddress(input.siteAddressSnapshot);

  if (project) {
    return {
      name: ccClientDisplayName(project),
      phone: ccClientPhone(project),
      address: normalizeSiteAddress(project.site_address) ?? snapshotAddress,
    };
  }

  return {
    name:
      sanitizeClientNameSnapshot(input.clientNameSnapshot) ||
      input.projectTitleSnapshot?.trim() ||
      input.jobName?.trim() ||
      'Job',
    phone: null,
    address: snapshotAddress,
  };
}

/** Label for project pickers: client name and site address only. */
export function ccProjectPickerLabel(
  project: Pick<CcProject, 'client_name' | 'site_address'>
): string {
  return [project.client_name.trim(), project.site_address?.trim()].filter(Boolean).join(' — ');
}

export function clientConnectAbsoluteUrl(portalBaseUrl: string | null | undefined, path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  if (!portalBaseUrl) return path;
  const base = portalBaseUrl.replace(/\/+$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}
