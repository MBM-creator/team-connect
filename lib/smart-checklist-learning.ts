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
    if (item.status === 'pending' || item.status === 'not_required_for_job') continue;
    const signature = `${item.jobId}:${key(item.category, item.description)}`;
    if (!latestByJobAndItem.has(signature)) latestByJobAndItem.set(signature, item);
  }
  const totals = new Map<string, { category: 'tool' | 'material'; description: string; loaded: number; notRequired: number }>();
  for (const item of latestByJobAndItem.values()) {
    const signature = key(item.category, item.description);
    const value = totals.get(signature) ?? {
      category: item.category, description: item.description, loaded: 0, notRequired: 0,
    };
    if (item.status === 'loaded') value.loaded += 1;
    if (item.status === 'not_required') value.notRequired += 1;
    totals.set(signature, value);
  }

  const baseline = suggestChecklistItems(activity, existingDescriptions);
  const results: LearnedChecklistSuggestion[] = baseline.map(suggestion => {
    const history = totals.get(key(suggestion.category, suggestion.description));
    const loadedJobs = history?.loaded ?? 0;
    const notRequiredJobs = history?.notRequired ?? 0;
    const discouraged = notRequiredJobs >= 2 && notRequiredJobs > loadedJobs;
    return {
      ...suggestion, loadedJobs, notRequiredJobs,
      learning: discouraged ? 'often_not_required' as const :
        loadedJobs > 0 ? 'previously_loaded' as const : 'standard' as const,
      why: discouraged
        ? `${suggestion.why}. Marked not required on ${notRequiredJobs} comparable job(s); check this job.`
        : loadedJobs > 0
          ? `${suggestion.why}. Loaded on ${loadedJobs} comparable job(s).`
          : suggestion.why,
    };
  });

  for (const history of totals.values()) {
    if (history.loaded === 0 || known.has(history.description.trim().toLowerCase())) continue;
    if (results.some(item => key(item.category, item.description) === key(history.category, history.description))) continue;
    const discouraged = history.notRequired >= 2 && history.notRequired > history.loaded;
    results.push({
      category: history.category,
      description: history.description,
      why: `Loaded on ${history.loaded} comparable job(s)` +
        (history.notRequired ? `; not required on ${history.notRequired} other job(s). Check site conditions.` : '.'),
      learning: discouraged ? 'often_not_required' : 'previously_loaded',
      loadedJobs: history.loaded,
      notRequiredJobs: history.notRequired,
    });
  }
  return results.sort((a, b) =>
    Number(a.learning === 'often_not_required') - Number(b.learning === 'often_not_required') ||
    b.loadedJobs - a.loadedJobs || a.description.localeCompare(b.description));
}
