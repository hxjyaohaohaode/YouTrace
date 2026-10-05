export function habitErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  const name = error instanceof Error ? error.name : '';
  if (/QuotaExceeded|quota|storage.*full/i.test(`${name} ${message}`)) return '设备存储空间不足，这次修改没有保存，原习惯和打卡记录已保留。请释放空间后重试，或先到设置导出备份';
  if (/[\u4e00-\u9fff]/.test(message)) return message;
  return '这次修改没有保存，原习惯和打卡记录已保留。请重试；若仍失败，可先到设置导出备份';
}
