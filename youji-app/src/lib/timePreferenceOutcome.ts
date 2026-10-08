export interface TimePreferenceDraft { value: string; baseline: string; revision: number }

/** Phase marker only. It does not publish state or assert which later value is current. */
export class PreferenceDisplayReadError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : '偏好显示读取未完成', { cause });
    this.name = 'PreferenceDisplayReadError';
  }
}

/** Only a definite quota refusal offers direct retry; other errors need a fresh read. */
export function needsTimePreferenceVerification(cause: unknown): boolean {
  if (cause instanceof PreferenceDisplayReadError) return true;
  return !(cause instanceof Error && (cause.name === 'QuotaExceededError' || /\bQuotaExceededError\b/.test(cause.message)));
}

/** Matching current data is not a receipt attributing it to the earlier save. */
export function reconcileTimePreferenceRead(started: TimePreferenceDraft | null, current: TimePreferenceDraft | null, stored: string) {
  if (started?.revision !== current?.revision) return { draft: current, needsVerification: true };
  return {
    draft: current && current.value !== stored ? { ...current, baseline: stored } : null,
    needsVerification: false,
  };
}
