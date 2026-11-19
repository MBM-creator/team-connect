import { suggestChecklistItems, type Suggestion } from '@/lib/smart-checklist';
import type { ChecklistStatus } from '@/lib/smart-checklist';

export type ChecklistLearningObservation = {
  jobId: string;
  workDate: string;
  activity: string;
  description: string;
  category: 'tool' | 'material';
  status: ChecklistStatus;
};

export type LearnedChecklistSuggestion = Suggestion & {
  learning: 'previously_loaded' | 'often_not_required' | 'standard';
  loadedJobs: number;
  notRequiredJobs: number;
  notRequiredStreak: number;
};

const STOP_WORDS = new Set([
  'about', 'after', 'before', 'clean', 'complete', 'completed', 'finish', 'finished',
  'from', 'into', 'install', 'installed', 'installation', 'job', 'lay', 'laying',
  'material', 'materials', 'next', 'prep', 'prepare', 'prepared', 'site', 'some',
  'start', 'starting', 'the', 'then', 'this', 'today', 'tomorrow', 'tool', 'tools',
  'with', 'work', 'works', 'working', 'and', 'for', 'all',
]);
function tokens(value: string): Set<string> {
  return new Set(value.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
    .filter(word => word.length >= 4 && !STOP_WORDS.has(word))
    .map(word => word.endsWith('ing') && word.length > 6 ? word.slice(0, -3) : word));
}
export function similarActivity(current: string, historical: string): boolean {
  const left = tokens(current), right = tokens(historical);
  if (!left.size || !right.size) return false;
  const matches = [...left].filter(word => right.has(word));
  if (!matches.length) return false;
  return matches.length >= 2 || (matches.length >= 1 &&
    matches.length / Math.min(left.size, right.size) >= 0.5);
}
function key(category: string, description: string) {
  return `${category}:${description.trim().toLowerCase().replace(/\s+/g, ' ')}`;
}

/**
 * Positive evidence is only explicit Loaded decisions from comparable work on OTHER jobs.
 * 'Not required for this particular job' is deliberately excluded from all cross-job scoring.
 * General Not required reduces priority but never permanently removes an item.
 * Multiple days of one job count only once, with the newest decision taking precedence.
 */
export function learnChecklistSuggestions(
  activity: string,
  existingDescriptions: string[],
  observations: ChecklistLearningObservation[],
  currentJobId: string,
): LearnedChecklistSuggestion[] {
  const known = new Set(existingDescriptions.map(value => value.trim().toLowerCase()));
  const latestByJobAndItem = new Map<string, ChecklistLearningObservation>();
  for (const item of [...observations].sort((a, b) => b.workDate.localeCompare(a.workDate))) {
    if (item.jobId === currentJobId || !similarActivity(activity, item.activity)) continue;
    const signature = `${item.jobId}:${key(item.category, item.description)}`;
    if (!latestByJobAndItem.has(signature)) latestByJobAndItem.set(signature, item);
  }
  const sequences = new Map<string, ChecklistLearningObservation[]>();
  for (const item of latestByJobAndItem.values()) {
    if (item.status === 'pending' || item.status === 'not_required_for_job') continue;
    const signature = key(item.category, item.description);
    sequences.set(signature, [...(sequences.get(signature) ?? []), item]);
  }

  const totals = new Map<string, {
    category: 'tool' | 'material'; description: string;
    loaded: number; notRequired: number; streak: number;
  }>();
  for (const [signature, records] of sequences) {
    const ordered = records.sort((a, b) => b.workDate.localeCompare(a.workDate));
    const streak = ordered.findIndex(item => item.status === 'loaded');
    totals.set(signature, {
      category: ordered[0].category, description: ordered[0].description,
      loaded: ordered.filter(item => item.status === 'loaded').length,
      notRequired: ordered.filter(item => item.status === 'not_required').length,
      streak: streak === -1 ? ordered.length : streak,
    });
  }

  const baseline = suggestChecklistItems(activity, existingDescriptions);
  const results: LearnedChecklistSuggestion[] = baseline.map(suggestion => {
    const history = totals.get(key(suggestion.category, suggestion.description));
    const loadedJobs = history?.loaded ?? 0;
    const notRequiredJobs = history?.notRequired ?? 0;
    const notRequiredStreak = history?.streak ?? 0;
    const discouraged = notRequiredStreak >= 3;
    return {
      ...suggestion, loadedJobs, notRequiredJobs, notRequiredStreak,
      learning: discouraged ? 'often_not_required' as const :
        loadedJobs > 0 ? 'previously_loaded' as const : 'standard' as const,
      why: discouraged
        ? `${suggestion.why}. Not required on ${notRequiredStreak} consecutive comparable jobs; shown occasionally as a reminder.`
        : loadedJobs > 0
          ? `${suggestion.why}. Loaded on ${loadedJobs} comparable job(s).`
          : suggestion.why,
    };
  });

  for (const history of totals.values()) {
    if (history.loaded === 0 || known.has(history.description.trim().toLowerCase())) continue;
    if (results.some(item => key(item.category, item.description) === key(history.category, history.description))) continue;
    const discouraged = history.streak >= 3;
    results.push({
      category: history.category,
      description: history.description,
      why: `Loaded on ${history.loaded} comparable job(s)` +
        (discouraged ? `; rejected on the last ${history.streak} comparable jobs. Occasional reminder.` : '.'),
      learning: discouraged ? 'often_not_required' : 'previously_loaded',
      loadedJobs: history.loaded,
      notRequiredJobs: history.notRequired,
      notRequiredStreak: history.streak,
    });
  }
  return results.sort((a, b) =>
    Number(a.learning === 'often_not_required') - Number(b.learning === 'often_not_required') ||
    b.loadedJobs - a.loadedJobs || a.description.localeCompare(b.description));
}

/**
 * Three consecutive rejections start reducing reminders.
 * Use a stable job/date/item hash, so edits and refreshes do not make an item
 * randomly appear and disappear. Continued rejections lower the frequency.
 */
export function shouldDisplayLearnedSuggestion(
  suggestion: Pick<LearnedChecklistSuggestion, 'category' | 'description' | 'notRequiredStreak'>,
  jobId: string,
  workDate: string,
): boolean {
  const streak = suggestion.notRequiredStreak;
  if (streak < 3) return true;
  const interval = streak >= 10 ? 16 : streak >= 6 ? 8 : 4;
  const signature = `${jobId}:${workDate}:${key(suggestion.category, suggestion.description)}`;
  let hash = 2166136261;
  for (let i = 0; i < signature.length; i++) {
    hash = Math.imul(hash ^ signature.charCodeAt(i), 16777619);
  }
  return (hash >>> 0) % interval === 0;
}
