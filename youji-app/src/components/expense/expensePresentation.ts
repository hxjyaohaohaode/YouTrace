type ExpenseWriteOperation = 'save' | 'budget' | 'delete' | 'draft';

/** Explain a refused quota write without changing its retry or transaction path. */
export function expenseWriteFailure(reason: unknown, operation: ExpenseWriteOperation): string {
  let name = '', message = '';
  try {
    if (typeof reason === 'string') message = reason;
    else if (reason instanceof Error) {
      const errorName = reason.name, errorMessage = reason.message;
      if (typeof errorName === 'string') name = errorName;
      if (typeof errorMessage === 'string') message = errorMessage;
    }
  } catch { /* A malformed error must not interrupt the retained editor. */ }
  const quota = name === 'QuotaExceededError' || /\bQuotaExceededError\b/.test(message);
  if (quota) {
    if (operation === 'draft') return '本设备存储空间不足，草稿尚未保存。输入暂时保留在当前页面；请先复制输入，释放一些设备空间后重试保留草稿。';
    if (operation === 'delete') return '本设备存储空间不足，删除未完成。编辑输入仍保留；可先在设置中导出备份，释放一些设备空间后重试。';
    if (operation === 'budget') return '本设备存储空间不足，本次预算未保存。输入仅在本页保留，离开前请先复制本次金额。可在设置中导出备份；释放一些设备空间后，核对输入再重试保存。';
    return '本设备存储空间不足，本次记账未保存。输入仍保留；可先在设置中导出备份，释放一些设备空间后重试保存。';
  }
  return message || (operation === 'delete' ? '删除未完成，输入已保留，请重试' : '未保存，输入已保留，请重试');
}

/** Signed difference is expense minus income, not either gross total. */
export function expenseDayNetLabel(expenseMinusIncome: number): string {
  const label = expenseMinusIncome > 0 ? '净支出' : expenseMinusIncome < 0 ? '净收入' : '净额';
  return `${label} ¥${(Math.abs(expenseMinusIncome) / 100).toFixed(2)}`;
}
