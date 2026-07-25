/**
 * Temporary Site Connect feature gate for the Client Connect project feed.
 *
 * This is NOT Client Connect tenant isolation. Both systems currently share a
 * single CC_BASE_URL / CC_INTERNAL_API_KEY credential (Made By Mobbs).
 * `CC_INTEGRATION_ORG_IDS` only lists which Site Connect organisation UUIDs may
 * use that shared bridge.
 *
 * A proper Site Connect organisation → Client Connect tenant mapping is required
 * before onboarding another integrated customer.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseIntegrationOrgIds(raw: string | undefined): Set<string> {
  if (!raw || raw.trim() === '') return new Set();
  const ids = new Set<string>();
  for (const part of raw.split(',')) {
    const id = part.trim().toLowerCase();
    if (UUID_RE.test(id)) {
      ids.add(id);
    }
  }
  return ids;
}

/** Default deny: unset, empty, or unlisted organisation IDs are not allowed. */
export function isCcIntegrationOrgAllowed(organisationId: string): boolean {
  const id = organisationId.trim().toLowerCase();
  if (!UUID_RE.test(id)) return false;
  return parseIntegrationOrgIds(process.env.CC_INTEGRATION_ORG_IDS).has(id);
}

export function ccIntegrationUnavailableWarning(): string {
  return 'Project sync is unavailable for this organisation.';
}
