/** Storage engine diagnostics are useful internally, not as the user's remedy. */
export function scheduleFailureMessage(reason: unknown, removing = false): string {
  const prefix = removing ? '删除失败：' : '保存失败：';
  const message = reason instanceof Error ? reason.message : '';
  const name = reason && typeof reason === 'object' && 'name' in reason ? String(reason.name) : '';
  if (name === 'QuotaExceededError' || /quotaexceeded|quota exceeded/i.test(message)) {
    return `${prefix}本机存储空间不足，原日程没有改变。输入仍保留，请先复制需要的内容，释放空间后重试`;
  }
  if (/[\u3400-\u9fff]/.test(message)) return `${prefix}${message}`;
  return `${prefix}这次操作未完成，输入仍保留。请重试；离开前可以先复制需要的内容`;
}
