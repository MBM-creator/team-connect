import { describe, expect, it } from 'vitest';
import {
  ccClientDisplayName,
  ccClientPhone,
  clientFacingDetails,
  extractSuburbFromAddress,
  formatAustralianMobileDisplay,
  isDisplayableClientPhone,
  sanitizeClientNameSnapshot,
  siteLocationForList,
} from '@/lib/cc-client-display';

describe('cc-client-display', () => {
  it('rejects pipeline emails and lead ids as phone numbers', () => {
    expect(
      isDisplayableClientPhone('lead-7e817678-93d7-4404-b351-ab0d81dc6b91@pipeline.local')
    ).toBe(false);
    expect(isDisplayableClientPhone('client@example.com')).toBe(false);
    expect(isDisplayableClientPhone('0412 345 678')).toBe(true);
    expect(isDisplayableClientPhone('+61 412 345 678')).toBe(true);
  });

  it('returns client name only from display helper', () => {
    expect(
      ccClientDisplayName({
        client_name: 'Justin Manchester',
      })
    ).toBe('Justin Manchester');
  });

  it('only returns phone when contact is displayable', () => {
    expect(
      ccClientPhone({
        client_contact: 'lead-7e817678-93d7-4404-b351-ab0d81dc6b91@pipeline.local',
      })
    ).toBeNull();
    expect(ccClientPhone({ client_contact: '0412 345 678' })).toBe('0412 345 678');
  });

  it('strips rubbish suffixes from stored snapshots', () => {
    expect(
      sanitizeClientNameSnapshot(
        'Justin Manchester — lead-7e817678-93d7-4404-b351-ab0d81dc6b91@pipeline.local'
      )
    ).toBe('Justin Manchester');
    expect(sanitizeClientNameSnapshot('Justin Manchester — 0412 345 678')).toBe('Justin Manchester');
  });

  it('builds client-facing details from live project fields', () => {
    expect(
      clientFacingDetails({
        project: {
          client_name: 'Justin Manchester',
          client_contact: 'lead-abc@pipeline.local',
          site_address: '12 Example St',
        },
      })
    ).toEqual({
      name: 'Justin Manchester',
      phone: null,
      address: '12 Example St',
    });
  });

  it('falls back to stored site address snapshot when project sync is unavailable', () => {
    expect(
      clientFacingDetails({
        clientNameSnapshot: 'Justin Manchester',
        siteAddressSnapshot: '8 Ruabon Road, Toorak, VIC 3142',
        jobName: 'Justin Manchester',
      })
    ).toEqual({
      name: 'Justin Manchester',
      phone: null,
      address: '8 Ruabon Road, Toorak, VIC 3142',
    });
  });

  it('shows suburb on list cards when parseable from address', () => {
    expect(siteLocationForList('8 Ruabon Road, Toorak, VIC 3142')).toBe('Toorak');
    expect(siteLocationForList('Richmond')).toBe('Richmond');
    expect(siteLocationForList(null)).toBeNull();
  });

  it('extracts suburb from common Australian address formats', () => {
    expect(extractSuburbFromAddress('8 Ruabon Road, Toorak, VIC 3142')).toBe('Toorak');
    expect(extractSuburbFromAddress('123 Street, Richmond, 3121')).toBe('Richmond');
  });

  it('formats recognised Australian mobiles for display without mutating originals', () => {
    expect(formatAustralianMobileDisplay('0409797414')).toBe('0409 797 414');
    expect(formatAustralianMobileDisplay('0409 797 414')).toBe('0409 797 414');
    expect(formatAustralianMobileDisplay('+61409797414')).toBe('0409 797 414');
    expect(formatAustralianMobileDisplay('61409797414')).toBe('0409 797 414');
    expect(formatAustralianMobileDisplay('+61 409 797 414')).toBe('0409 797 414');
  });

  it('leaves unrecognised phone patterns unchanged', () => {
    expect(formatAustralianMobileDisplay('0398765432')).toBe('0398765432');
    expect(formatAustralianMobileDisplay('0412 345')).toBe('0412 345');
    expect(formatAustralianMobileDisplay('+1 415 555 2671')).toBe('+1 415 555 2671');
    expect(formatAustralianMobileDisplay('not-a-phone')).toBe('not-a-phone');
    expect(formatAustralianMobileDisplay(null)).toBeNull();
    expect(formatAustralianMobileDisplay('')).toBeNull();
  });
});
