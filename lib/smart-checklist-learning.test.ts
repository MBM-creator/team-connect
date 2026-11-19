import { describe, expect, it } from 'vitest';
import {
  learnChecklistSuggestions, similarActivity, shouldDisplayLearnedSuggestion, type ChecklistLearningObservation,
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

  it('does not reuse stale Loaded evidence after a later job-only exclusion', () => {
    const result = learnChecklistSuggestions('Lay bluestone paving', [], [
      observation('old', 'loaded', 'Diamond blade', '2026-11-10'),
      observation('old', 'not_required_for_job', 'Diamond blade', '2026-11-12'),
    ], 'new-job');
    expect(result.some(item => item.description === 'Diamond blade')).toBe(false);
  });

  it('starts tapering suggestions after three consecutive not-required decisions', () => {
    const data = [
      observation('a', 'not_required', 'Wet saw', '2026-11-10'),
      observation('b', 'not_required', 'Wet saw', '2026-11-11'),
      observation('c', 'not_required', 'Wet saw', '2026-11-12'),
    ];
    const two = learnChecklistSuggestions('Lay bluestone paving', [], data.slice(0, 2), 'new-job');
    expect(two.find(item => item.description === 'Wet saw')).toMatchObject({
      learning: 'standard', notRequiredStreak: 2,
    });
    const three = learnChecklistSuggestions('Lay bluestone paving', [], data, 'new-job');
    const wetSaw = three.find(item => item.description === 'Wet saw')!;
    expect(wetSaw).toMatchObject({ learning: 'often_not_required', notRequiredStreak: 3 });
    expect(Array.from({length: 80}, (_, n) => shouldDisplayLearnedSuggestion(
      wetSaw, `job-${n}`, '2026-11-19',
    )).filter(Boolean).length).toBeLessThan(40);
  });

  it('resets the consecutive rejection streak when an item is loaded', () => {
    const result = learnChecklistSuggestions('Lay bluestone paving', [], [
      observation('a', 'not_required', 'Wet saw', '2026-11-10'),
      observation('b', 'not_required', 'Wet saw', '2026-11-11'),
      observation('c', 'loaded', 'Wet saw', '2026-11-12'),
      observation('d', 'not_required', 'Wet saw', '2026-11-13'),
    ], 'new-job');
    expect(result.find(item => item.description === 'Wet saw')).toMatchObject({
      learning: 'previously_loaded', notRequiredStreak: 1, loadedJobs: 1,
    });
  });

  it('makes reminder frequency increasingly sparse after continued rejection', () => {
    const sample = (streak: number) => Array.from({ length: 300 }, (_, n) =>
      shouldDisplayLearnedSuggestion({
        category: 'tool', description: 'Wet saw', notRequiredStreak: streak,
      }, `job-${n}`, '2026-11-19')).filter(Boolean).length;
    expect(sample(2)).toBe(300);
    expect(sample(3)).toBeGreaterThan(sample(6));
    expect(sample(6)).toBeGreaterThan(sample(10));
    expect(sample(10)).toBeGreaterThan(0);
  });

  it('keeps other tools suggestible and does not auto-add already selected items', () => {
    const result = learnChecklistSuggestions('Lay bluestone paving', ['Diamond blade'], [
      observation('old', 'loaded'),
    ], 'new-job');
    expect(result.some(item => item.description === 'Diamond blade')).toBe(false);
    expect(result.some(item => item.description === '5 mm spacers')).toBe(true);
  });
});
