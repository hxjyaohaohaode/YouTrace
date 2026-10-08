export interface TimePreferenceDraft { value: string; baseline: string; revision: number }

/** Emitted only after the requested local transaction completes and refreshView fails.
 * This historical write fact is not a receipt for the current value or cloud sync. */
export class PreferenceDisplayReadError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : '偏好显示读取未完成', { cause });
    this.name = 'PreferenceDisplayReadError';
  }
}

export type TimePreferenceFailureKind = 'committed-display-read' | 'precommit-refusal' | 'unknown';

/** Error wording/name alone cannot claim a committed write. */
export function timePreferenceFailureKind(cause: unknown): TimePreferenceFailureKind {
  if (cause instanceof PreferenceDisplayReadError) return 'committed-display-read';
  if (cause instanceof Error && (cause.name === 'QuotaExceededError' || /\bQuotaExceededError\b/.test(cause.message))) return 'precommit-refusal';
  return 'unknown';
}

/** Both a known prior commit and an unknown result prohibit blind resubmission. */
export function needsTimePreferenceVerification(cause: unknown): boolean {
  return timePreferenceFailureKind(cause) !== 'precommit-refusal';
}

/** Matching current data is not a receipt attributing it to the earlier save. */
export function reconcileTimePreferenceRead(started: TimePreferenceDraft | null, current: TimePreferenceDraft | null, stored: string) {
  if (started?.revision !== current?.revision) return { draft: current, needsVerification: true };
  return {
    draft: current && current.value !== stored ? { ...current, baseline: stored } : null,
    needsVerification: false,
  };
}
