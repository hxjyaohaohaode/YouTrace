/** Describe storage refusal without changing the editor's save or draft path. */
export function todoSaveFailure(reason: unknown): string {
  let name = '', message = '';
  try {
    if (typeof reason === 'string') message = reason;
    else if (reason instanceof Error) {
      const errorName = reason.name, errorMessage = reason.message;
      if (typeof errorName === 'string') name = errorName;
      if (typeof errorMessage === 'string') message = errorMessage;
    }
  } catch { /* Error display must not interrupt the retained editor. */ }
  if (name === 'QuotaExceededError' || /\bQuotaExceededError\b/.test(message)) {
    return '本设备存储空间不足，本次待办未保存。输入仍保留在当前编辑器；释放一些设备空间后，请核对输入并重试保存。';
  }
  return message || '未保存，输入已保留，请重试';
}
