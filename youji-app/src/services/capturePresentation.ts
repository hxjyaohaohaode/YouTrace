import type { CaptureContext } from './parser';

/** A changed capture day or original timestamp must never reuse old corrections. */
export function sameCaptureInput(review: { input?: string; context?: CaptureContext }, text: string, context: CaptureContext): boolean {
  const basis = review.context;
  if (!basis) return false;
  const complete = (value: CaptureContext) => Object.keys(value).sort().join(',') === 'capturedAt,date,timeZone';
  return review.input === text && complete(basis) && complete(context)
    && Object.is(basis.capturedAt, context.capturedAt) && basis.date === context.date && basis.timeZone === context.timeZone;
}

/** Describe the existing precommit refusal without changing the save path. */
export function captureSaveFailure(reason: unknown): string {
  let name = '', message = '';
  try {
    if (reason instanceof Error) {
      const errorName = reason.name, errorMessage = reason.message;
      if (typeof errorName === 'string') name = errorName;
      if (typeof errorMessage === 'string') message = errorMessage;
    }
  } catch { /* Error display must not interrupt the retained review. */ }
  if (name === 'QuotaExceededError' || /\bQuotaExceededError\b/.test(message)) {
    return '本设备存储空间不足，本次记录未保存。原文和修正仍保留在当前页面；可先复制确认稿备份，释放一些设备空间后，核对内容并点击“确认保存所选记录”重试。';
  }
  return message || '保存未完成，确认稿仍保留，请重试';
}
