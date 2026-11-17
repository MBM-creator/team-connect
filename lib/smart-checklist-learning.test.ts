import { describe, expect, it } from 'vitest';
import {
  learnChecklistSuggestions, similarActivity, type ChecklistLearningObservation,
} from './smart-checklist-learning';

const observation = (
  jobId: string, status: ChecklistLearningObservation['status'],
  description = 'Diamond blade', workDate = '2026-11-12',
  activity = 'Lay bluestone paving',
): ChecklistLearningObservation => ({
  jobId, status, description, workDate, activity, category: 'tool',
});

describe('cross-job Smart Checklist learning', () => {
  it('only compares meaningfully related activities', () => {
    expect(similarActivity('Lay bluestone paving', 'Bluestone paving courtyard')).toBe(true);
    expect(similarActivity('Install irrigation', 'Lay bluestone paving')).toBe(false);
    expect(similarActivity('general site work', 'site inspection')).toBe(false);
  });

  it('learns previously loaded equipment on another relevant job', () => {
    const result = learnChecklistSuggestions('Lay bluestone paving', [], [
      observation('job-a', 'loaded'), observation('job-b', 'pending', 'Unverified saw'),
      observation('job-c', 'loaded', 'Irrigation fittings', '2026-11-12', 'Install irrigation'),
    ], 'new-job');
    expect(result.find(item => item.description === 'Diamond blade')).toMatchObject({
      learning: 'previously_loaded', loadedJobs: 1, notRequiredJobs: 0,
    });
    expect(result.some(item => item.description === 'Unverified saw')).toBe(false);
    expect(result.some(item => item.description === 'Irrigation fittings')).toBe(false);
  });

  it('never treats a job-specific exclusion as a general recommendation or rejection', () => {
    const result = learnChecklistSuggestions('Lay bluestone paving', [], [
      observation('job-a', 'not_required_for_job'),
      observation('job-b', 'loaded'),
    ], 'new-job');
    expect(result.find(item => item.description === 'Diamond blade')).toMatchObject({
      loadedJobs: 1, notRequiredJobs: 0, learning: 'previously_loaded',
    });
  });

  it('does not learn from the current job or duplicate multiple days of one job', () => {
    const result = learnChecklistSuggestions('Lay bluestone paving', [], [
      observation('current', 'loaded'),
      observation('old', 'loaded', 'Diamond blade', '2026-11-10'),
      observation('old', 'not_required', 'Diamond blade', '2026-11-12'),
    ], 'current');
    expect(result.some(item => item.description === 'Diamond blade')).toBe(false);
  });

  it('downgrades repeatedly not-required standard suggestions instead of suppressing them', () => {
    const result = learnChecklistSuggestions('Lay bluestone paving', [], [
      observation('a', 'not_required', 'Wet saw'),
      observation('b', 'not_required', 'Wet saw'),
    ], 'new-job');
    expect(result.find(item => item.description === 'Wet saw')).toMatchObject({
      learning: 'often_not_required', notRequiredJobs: 2,
    });
  });

  it('keeps other tools suggestible and does not auto-add already selected items', () => {
    const result = learnChecklistSuggestions('Lay bluestone paving', ['Diamond blade'], [
      observation('old', 'loaded'),
    ], 'new-job');
    expect(result.some(item => item.description === 'Diamond blade')).toBe(false);
    expect(result.some(item => item.description === '5 mm spacers')).toBe(true);
  });
});
