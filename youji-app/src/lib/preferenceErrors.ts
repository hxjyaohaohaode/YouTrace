/** A storage refusal needs an action the person can take, while preserving the draft. */
export function preferenceSaveError(cause: unknown): string {
  if (cause instanceof Error) {
    if (cause.name === 'QuotaExceededError' || /\bQuotaExceededError\b/.test(cause.message)) {
      return '本机存储空间不足。你的输入仍保留，请释放一些空间后再点保存重试。';
    }
    // Other result categories retain their existing behavior. In particular,
    // this copy change cannot decide whether a display failure followed a commit.
    return cause.message;
  }
  return '时间未保存，输入仍保留，请重试';
}
