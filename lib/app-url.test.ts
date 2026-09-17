import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAppOrigin, LEGACY_QA_APP_URL, PRODUCTION_APP_URL } from './app-url';

describe('getAppOrigin', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses the configured app URL without a trailing slash', () => {
    vi.stubEnv('APP_URL', 'https://preview.example.com/');

    expect(getAppOrigin()).toBe('https://preview.example.com');
  });

  it('does not use the retired QA URL', () => {
    vi.stubEnv('APP_URL', LEGACY_QA_APP_URL);
    vi.stubEnv('NODE_ENV', 'production');

    expect(getAppOrigin()).toBe(PRODUCTION_APP_URL);
  });

  it('uses the Team Connect domain in production when APP_URL is absent', () => {
    vi.stubEnv('APP_URL', '');
    vi.stubEnv('NODE_ENV', 'production');

    expect(getAppOrigin()).toBe('https://team.madebymobbs.com.au');
  });
});
