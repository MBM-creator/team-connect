import { describe, expect, it } from 'vitest';
import { buildMorningChecklists, morningChecklistWindow, previousWorkingDate, type ChecklistSource } from './morning-checklist';

const staff = [
  { id: 'steve', org_id: 'mbm', email: 'steve@example.com', active: true },
  { id: 'other', org_id: 'mbm', email: 'other@example.com', active: true },
  { id: 'inactive', org_id: 'mbm', email: 'inactive@example.com', active: false },
];
const source: ChecklistSource = {
  creatorId: 'steve', jobId: 'job', orgId: 'mbm', jobName: 'Glass Street',
  jobNumber: '173', orgSlug: 'made-by-mobbs', equipment: ['Plate compactor', 'Laser level'],
  materials: ['Crushed rock (2 m3)'], notes: 'Collect turf', kind: 'plan',
};

describe('morning checklist schedule', () => {
  it.each([
    ['2026-11-08T19:15:00Z', true], // Monday, daylight saving
    ['2026-11-08T20:15:00Z', false], // second UTC invocation must not send
    ['2026-07-05T20:15:00Z', true], // Monday, standard time
    ['2026-07-05T19:15:00Z', false],
    ['2026-11-13T19:15:00Z', true], // Saturday
    ['2026-11-14T19:15:00Z', false], // Sunday
    ['2026-11-08T19:14:00Z', false],
    ['2026-11-08T19:25:00Z', true], // delivery retry
    ['2026-11-08T19:30:00Z', false],
    ['2026-11-08T20:30:00Z', true], // 07:30
    ['2026-11-08T20:40:00Z', true], // hourly delivery retry
    ['2026-11-09T06:30:00Z', true], // 17:30
    ['2026-11-09T07:30:00Z', false], // 18:30
    ['2026-07-06T07:30:00Z', true], // standard-time 17:30
    ['2026-07-06T08:30:00Z', false],
    ['2026-11-14T20:30:00Z', false], // Sunday hourly reminder
    ['2026-10-03T19:15:00Z', false], // daylight saving starts on Sunday
  ])('evaluates %s in Melbourne', (now, due) => {
    expect(morningChecklistWindow(new Date(now)).due).toBe(due);
  });
  it('uses the Melbourne date across the UTC date boundary', () => {
    expect(morningChecklistWindow(new Date('2026-11-08T19:15:00Z')).workDate).toBe('2026-11-09');
  });
  it('carries Saturday notes into Monday and weekday notes into the next day', () => {
    expect(previousWorkingDate('2026-11-09')).toBe('2026-11-07');
    expect(previousWorkingDate('2026-11-10')).toBe('2026-11-09');
    expect(previousWorkingDate('2027-01-01')).toBe('2026-12-31');
  });
});

describe('creator-addressed email', () => {
  const build = (sources: ChecklistSource[]) => buildMorningChecklists(sources, staff, '2026-11-09', 'https://team.example.com');
  it('includes the actual list, job identity and dated plan link', () => {
    const [email] = build([source]);
    expect(email.to).toBe('steve@example.com');
    for (const text of ['Job #173', 'Glass Street', 'Plate compactor', 'Laser level', 'Crushed rock (2 m3)', 'Collect turf', 'workDate=2026-11-09']) {
      expect(email.text).toContain(text);
    }
  });
  it('combines a creator’s jobs into one email without copying another creator’s list', () => {
    const emails = build([source, { ...source, jobId: 'job2', jobName: 'Second job' },
      { ...source, creatorId: 'other', equipment: ['Private equipment'], notes: null, materials: [] }]);
    expect(emails).toHaveLength(2);
    const steve = emails.find(e => e.staffId === 'steve')!;
    expect(steve.text).toContain('Second job');
    expect(steve.text).not.toContain('Private equipment');
    expect(emails.find(e => e.staffId === 'other')!.to).toBe('other@example.com');
  });
  it('does not send to inactive, unknown or cross-organisation creators', () => {
    expect(build([{ ...source, creatorId: 'inactive' }, { ...source, creatorId: 'missing' },
      { ...source, orgId: 'another-org' }])).toEqual([]);
  });
  it('skips empty lists and includes standalone notes for tomorrow', () => {
    expect(build([{ ...source, equipment: [], materials: [], notes: '  ' }])).toEqual([]);
    const [email] = build([{ ...source, kind: 'tomorrow', equipment: [], materials: [], notes: 'Bring wet saw' }]);
    expect(email.text).toContain('Notes for today:\nBring wet saw');
  });
});
