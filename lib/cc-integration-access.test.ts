import { afterEach, describe, expect, it } from 'vitest';
import { isCcIntegrationOrgAllowed } from '@/lib/cc-integration-access';

const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('isCcIntegrationOrgAllowed', () => {
  const original = process.env.CC_INTEGRATION_ORG_IDS;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.CC_INTEGRATION_ORG_IDS;
    } else {
      process.env.CC_INTEGRATION_ORG_IDS = original;
    }
  });

  it('defaults to deny when env is unset', () => {
    delete process.env.CC_INTEGRATION_ORG_IDS;
    expect(isCcIntegrationOrgAllowed(ORG_A)).toBe(false);
  });

  it('defaults to deny when env is empty', () => {
    process.env.CC_INTEGRATION_ORG_IDS = '  ,  ';
    expect(isCcIntegrationOrgAllowed(ORG_A)).toBe(false);
  });

  it('allows only explicitly listed organisation IDs', () => {
    process.env.CC_INTEGRATION_ORG_IDS = `${ORG_A}`;
    expect(isCcIntegrationOrgAllowed(ORG_A)).toBe(true);
    expect(isCcIntegrationOrgAllowed(ORG_A.toUpperCase())).toBe(true);
    expect(isCcIntegrationOrgAllowed(ORG_B)).toBe(false);
  });

  it('ignores invalid UUID tokens in the allowlist', () => {
    process.env.CC_INTEGRATION_ORG_IDS = `not-a-uuid,${ORG_A}`;
    expect(isCcIntegrationOrgAllowed(ORG_A)).toBe(true);
    expect(isCcIntegrationOrgAllowed('not-a-uuid')).toBe(false);
  });
});
