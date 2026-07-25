import { describe, expect, it } from 'vitest';
import { enrichJobsWithSiteLocation, jobSiteLocation } from '@/lib/job-site-location';

describe('job-site-location', () => {
  it('derives suburb for list cards from linked project address', () => {
    const location = jobSiteLocation(
      {
        id: 'job-1',
        name: 'Justin Manchester',
        cc_project_id: 'b1bf9341-fa8b-4255-843d-b2db29e068c2',
      },
      [
        {
          project_id: 'b1bf9341-fa8b-4255-843d-b2db29e068c2',
          quote_id: null,
          cc_job_id: null,
          cc_job_number: null,
          client_id: 'client-1',
          project_title: 'Justin Manchester',
          client_name: 'Justin Manchester',
          client_contact: null,
          site_address: '64 Glass St, Essendon',
          status: 'wip',
          trades: [],
          sections: [],
        },
      ]
    );

    expect(location).toBe('Essendon');
  });

  it('enriches jobs with site_location for API responses', () => {
    const [job] = enrichJobsWithSiteLocation(
      [
        {
          id: 'job-1',
          name: 'Volume Builder',
          cc_project_id: '7633cbc5-7f08-4b30-b11c-561a25f6bc2d',
        },
      ],
      [
        {
          project_id: '7633cbc5-7f08-4b30-b11c-561a25f6bc2d',
          quote_id: null,
          cc_job_id: null,
          cc_job_number: null,
          client_id: 'client-2',
          project_title: 'Volume Builder',
          client_name: 'Urban Green',
          client_contact: null,
          site_address: 'Various, Tarneit',
          status: 'wip',
          trades: [],
          sections: [],
        },
      ]
    );

    expect(job.site_location).toBe('Tarneit');
  });
});
