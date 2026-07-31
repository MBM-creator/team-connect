import { randomUUID } from 'crypto';

export type CcProjectStatus =
  | 'planning'
  | 'active'
  | 'quote_accepted'
  | 'deposit_paid'
  | 'prestart_date_set'
  | 'prestart_paid'
  | 'wip';
export type CcProjectTrade =
  | 'paving'
  | 'concrete'
  | 'carpentry_decking'
  | 'demo'
  | 'fencing'
  | 'irrigation'
  | 'mulching'
  | 'planting'
  | 'electrical'
  | 'other';

export interface CcProjectSection {
  id: string;
  name: string;
  trade: CcProjectTrade | null;
}

/**
 * Operational Client Connect project fields used by Team Connect.
 *
 * `project_id` and `quote_id` are distinct identifiers — never collapse them
 * or treat a quote UUID as a confirmed project UUID.
 *
 * Commercial fields (variation amounts, invoices, costs, margins) are never
 * accepted into this model or returned to the browser.
 */
export interface CcProject {
  /** Client Connect project UUID — do not substitute quote_id. */
  project_id: string;
  /** Client Connect quote UUID when present — do not treat as project_id. */
  quote_id: string | null;
  cc_job_id: string | null;
  cc_job_number: string | null;
  client_id: string;
  project_title: string;
  client_name: string;
  client_contact: string | null;
  site_address: string | null;
  status: CcProjectStatus;
  trades: CcProjectTrade[];
  sections: CcProjectSection[];
}

/** Browser-safe alias — same operational shape; never includes commercial fields. */
export type CcProjectOperationalSummary = CcProject;

export interface CcProjectsResponseOk {
  ok: true;
  projects: CcProject[];
}

export interface CcProjectsResponseError {
  ok: false;
  error: string;
}

export type CcProjectsResponse = CcProjectsResponseOk | CcProjectsResponseError;

const CACHE_TTL_MS = 5 * 60 * 1000;

type OrgCacheEntry = {
  projects: CcProject[];
  timestampMs: number;
};

/** Cache keyed by verified Team Connect organisation id only — never global. */
const projectsCacheByOrgId = new Map<string, OrgCacheEntry>();

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function isCcProjectStatus(value: unknown): value is CcProjectStatus {
  return (
    value === 'planning' ||
    value === 'active' ||
    value === 'quote_accepted' ||
    value === 'deposit_paid' ||
    value === 'prestart_date_set' ||
    value === 'prestart_paid' ||
    value === 'wip'
  );
}

function isCcProjectTrade(value: unknown): value is CcProjectTrade {
  return (
    value === 'paving' ||
    value === 'concrete' ||
    value === 'carpentry_decking' ||
    value === 'demo' ||
    value === 'fencing' ||
    value === 'irrigation' ||
    value === 'mulching' ||
    value === 'planting' ||
    value === 'electrical' ||
    value === 'other'
  );
}

function optionalIdentifier(value: unknown, fieldName: string): string | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  throw new Error(`Invalid Client Connect response: ${fieldName} must be string, number, or null`);
}

function normalizeTrade(value: unknown): CcProjectTrade | null {
  if (value == null) return null;
  if (typeof value !== 'string') return null;

  const normalised = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (normalised === 'demolition') return 'demo';
  if (normalised === 'decking' || normalised === 'carpentry') return 'carpentry_decking';
  if (isCcProjectTrade(normalised)) {
    return normalised;
  }

  return 'other';
}

function optionalTrade(value: unknown): CcProjectTrade | null {
  return normalizeTrade(value);
}

function validateCcProjectSections(payload: unknown): CcProjectSection[] {
  if (payload == null) return [];
  if (!Array.isArray(payload)) {
    throw new Error('Invalid Client Connect response: sections must be an array');
  }

  return payload.map((item) => {
    if (!item || typeof item !== 'object') {
      throw new Error('Invalid Client Connect response: section must be an object');
    }
    const s = item as Record<string, unknown>;
    if (!isUuid(s.id)) {
      throw new Error('Invalid Client Connect response: section id must be a UUID');
    }
    if (typeof s.name !== 'string' || s.name.trim() === '') {
      throw new Error('Invalid Client Connect response: section name must be a non-empty string');
    }
    return {
      id: s.id,
      name: s.name,
      trade: optionalTrade(s.trade),
    };
  });
}

function validateCcProjectsResponse(payload: unknown): CcProjectsResponseOk {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid Client Connect response: expected object');
  }
  const obj = payload as Record<string, unknown>;
  if (obj.ok !== true) {
    throw new Error('Invalid Client Connect response: ok flag must be true for success');
  }
  if (!Array.isArray(obj.projects)) {
    throw new Error('Invalid Client Connect response: projects must be an array');
  }

  const projects: CcProject[] = [];
  for (const item of obj.projects) {
    if (!item || typeof item !== 'object') {
      throw new Error('Invalid Client Connect response: project must be an object');
    }
    const p = item as Record<string, unknown>;
    const project_id = p.project_id;
    const quote_id = p.quote_id;
    const cc_job_id = optionalIdentifier(p.cc_job_id ?? p.job_id, 'cc_job_id');
    const cc_job_number = optionalIdentifier(
      p.cc_job_number ?? p.job_number ?? p.job_no ?? p.jobNo,
      'cc_job_number'
    );
    const client_id = p.client_id;
    const project_title = p.project_title;
    const client_name = p.client_name;
    const client_contact = p.client_contact;
    const site_address = p.site_address;
    const status = p.status;
    const tradesRaw = p.trades;

    if (!isUuid(project_id)) {
      throw new Error('Invalid Client Connect response: project_id must be a UUID');
    }
    if (quote_id != null && !isUuid(quote_id)) {
      throw new Error('Invalid Client Connect response: quote_id must be a UUID or null');
    }
    if (!isUuid(client_id)) {
      throw new Error('Invalid Client Connect response: client_id must be a UUID');
    }
    if (typeof project_title !== 'string' || project_title.trim() === '') {
      throw new Error('Invalid Client Connect response: project_title must be a non-empty string');
    }
    if (typeof client_name !== 'string' || client_name.trim() === '') {
      throw new Error('Invalid Client Connect response: client_name must be a non-empty string');
    }
    if (client_contact !== null && client_contact !== undefined && typeof client_contact !== 'string') {
      throw new Error('Invalid Client Connect response: client_contact must be string or null');
    }
    if (site_address !== null && typeof site_address !== 'string') {
      throw new Error('Invalid Client Connect response: site_address must be string or null');
    }
    if (!isCcProjectStatus(status)) {
      throw new Error('Invalid Client Connect response: status is not supported');
    }
    if (tradesRaw != null && !Array.isArray(tradesRaw)) {
      throw new Error('Invalid Client Connect response: trades must be an array');
    }

    const trades = Array.isArray(tradesRaw)
      ? Array.from(new Set(tradesRaw.map(normalizeTrade).filter((trade): trade is CcProjectTrade => trade !== null)))
      : [];

    // Intentionally ignore upstream variations / commercial money fields.

    projects.push({
      project_id,
      quote_id: quote_id ?? null,
      cc_job_id,
      cc_job_number,
      client_id,
      project_title,
      client_name,
      client_contact: typeof client_contact === 'string' && client_contact.trim() !== ''
        ? client_contact
        : null,
      site_address: site_address ?? null,
      status,
      trades,
      sections: validateCcProjectSections(p.sections),
    });
  }

  return { ok: true, projects };
}

export function toCcProjectOperationalSummary(project: CcProject): CcProjectOperationalSummary {
  return {
    project_id: project.project_id,
    quote_id: project.quote_id,
    cc_job_id: project.cc_job_id,
    cc_job_number: project.cc_job_number,
    client_id: project.client_id,
    project_title: project.project_title,
    client_name: project.client_name,
    client_contact: project.client_contact,
    site_address: project.site_address,
    status: project.status,
    trades: [...project.trades],
    sections: project.sections.map((section) => ({ ...section })),
  };
}

export function ccProjectJobIdentity(
  project: Pick<CcProject, 'project_id' | 'quote_id' | 'cc_job_id' | 'cc_job_number'>
): string {
  if (project.cc_job_id) return `cc_job_id:${project.cc_job_id}`;
  if (project.cc_job_number) return `cc_job_number:${project.cc_job_number}`;
  if (project.quote_id) return `cc_quote_id:${project.quote_id}`;
  return `cc_project_id:${project.project_id}`;
}

export function dedupeCcProjectsByJobIdentity(projects: CcProject[]): CcProject[] {
  const seen = new Set<string>();
  const deduped: CcProject[] = [];

  for (const project of projects) {
    const identity = ccProjectJobIdentity(project);
    if (seen.has(identity)) continue;
    seen.add(identity);
    deduped.push(project);
  }

  return deduped;
}

/** Test helper — clears org-scoped process cache. */
export function clearCcProjectsCacheForTests(): void {
  projectsCacheByOrgId.clear();
}

/**
 * Fetch operational Client Connect projects for a verified Team Connect organisation.
 * Cache is scoped by organisationId and must never be shared across organisations.
 */
export async function fetchCcProjects(
  organisationId: string,
  requestId?: string
): Promise<CcProject[]> {
  const orgKey = organisationId.trim().toLowerCase();
  if (!isUuid(orgKey)) {
    throw new Error('organisationId must be a valid UUID');
  }

  const baseUrl = process.env.CC_BASE_URL;
  const internalKey = process.env.CC_INTERNAL_API_KEY;

  if (!baseUrl || !internalKey) {
    throw new Error('Client Connect configuration missing: CC_BASE_URL or CC_INTERNAL_API_KEY');
  }

  const url = `${baseUrl.replace(/\/+$/, '')}/api/internal/eod/projects`;

  const effectiveRequestId = requestId || randomUUID().slice(0, 8);
  const now = Date.now();

  console.log('[EOD->CC PROJECT FETCH]', {
    requestId: effectiveRequestId,
    organisationId: orgKey,
  });

  let liveError: unknown = null;

  try {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          'x-internal-key': internalKey,
          'x-request-id': effectiveRequestId,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to reach Client Connect: ${msg}`);
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new Error('Invalid Client Connect response: could not parse JSON');
    }

    if (!response.ok) {
      const obj = json as { ok?: unknown; error?: unknown };
      const errorMsg =
        typeof obj?.error === 'string' && obj.error.trim() !== ''
          ? obj.error
          : `Client Connect error: HTTP ${response.status}`;
      throw new Error(errorMsg);
    }

    const validated = validateCcProjectsResponse(json);
    const projects = dedupeCcProjectsByJobIdentity(validated.projects);
    projectsCacheByOrgId.set(orgKey, { projects, timestampMs: now });
    return projects.map(toCcProjectOperationalSummary);
  } catch (err) {
    liveError = err;
    const cached = projectsCacheByOrgId.get(orgKey);
    if (cached) {
      const ageMs = now - cached.timestampMs;
      if (ageMs >= 0 && ageMs <= CACHE_TTL_MS) {
        console.warn('[CC PROJECT FETCH FALLBACK]', {
          reason: err instanceof Error ? err.message : 'unknown',
          cacheAgeMs: ageMs,
          cachedCount: cached.projects.length,
          organisationId: orgKey,
        });
        return cached.projects.map(toCcProjectOperationalSummary);
      }
    }
  }

  if (liveError instanceof Error) {
    throw liveError;
  }
  throw new Error('Unknown error while fetching Client Connect projects');
}
