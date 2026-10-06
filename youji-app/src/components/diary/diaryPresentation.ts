/** Describe a refused storage write without changing persistence or retry. */
export function diaryWriteFailure(reason: unknown, operation: 'save' | 'delete'): string {
  let name = '', message = '';
  try {
    if (typeof reason === 'string') message = reason;
    else if (reason instanceof Error) {
      const errorName = reason.name, errorMessage = reason.message;
      if (typeof errorName === 'string') name = errorName;
      if (typeof errorMessage === 'string') message = errorMessage;
    }
  } catch { /* Error formatting must not interrupt the retained editor. */ }
  if (name === 'QuotaExceededError' || /\bQuotaExceededError\b/.test(message)) {
    return `本设备存储空间不足，${operation === 'delete' ? '删除未完成' : '本次日记未保存'}。输入仍保留在当前编辑器；可先复制完整输入，释放一些设备空间后重试${operation === 'delete' ? '删除' : '保存'}。`;
  }
  return message || (operation === 'delete' ? '删除未完成，输入已保留，请重试' : '日记未保存，输入已保留，请重试');
}
