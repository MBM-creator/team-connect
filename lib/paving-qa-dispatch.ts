/**
 * Version dispatch for paving QA runs.
 * Paving runs require setup_version === 2 (v1 retired).
 */
import type { PavingQaSetupV2 } from './paving-qa-v2-types';
import { validateSetupV2 } from './paving-qa-v2-setup';

export type RunVersionInfo =
  | { version: 2; setup: PavingQaSetupV2 }
  | { version: 'unknown' };

/**
 * Detect the version of a paving QA run from its raw DB row.
 */
export function detectRunVersion(
  rawSetup: unknown,
  setupVersion: number | null | undefined
): RunVersionInfo {
  if (setupVersion === 2) {
    const parsed = validateSetupV2(rawSetup);
    if (parsed.ok) {
      return { version: 2, setup: parsed.setup };
    }
  }
  return { version: 'unknown' };
}

export function isV2Run(info: RunVersionInfo): info is { version: 2; setup: PavingQaSetupV2 } {
  return info.version === 2;
}
