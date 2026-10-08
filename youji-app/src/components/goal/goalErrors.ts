/** Write failures are separate from a committed result whose view needs refresh. */
export function goalFailureMessage(cause: unknown): string {
  const name = cause && typeof cause === 'object' && 'name' in cause ? String(cause.name) : '';
  const message = cause instanceof Error ? cause.message : '';
  if (/QuotaExceededError/i.test(`${name} ${message}`)) return '本机存储空间不足，这次操作没有保存，原目标保持不变。输入仍保留，请释放空间后重试；也可以先到设置导出备份';
  if (/[\u3400-\u9fff]/.test(message)) return message;
  return '这次操作没有保存，原目标和输入仍保留。请重试；若仍失败，可先到设置导出备份';
}

export function goalLoadingMessage(loading: boolean, readError: string | null): string {
  return loading ? '正在读取目标…' : readError ? '目标暂未读取，请使用上方“刷新核对”重试' : '尚未读取目标';
}

export function goalSummaryLabel(loaded: boolean, loading: boolean, readError: string | null, done: number, total: number, average: number): string {
  if (!loaded) return loading ? '正在读取目标统计…' : '目标统计暂未读取';
  if (total === 0) return readError ? '上次读取时还没有目标' : '还没有目标';
  return `${readError ? '上次读取：' : ''}${done}/${total} 完成 · 平均进度 ${average}%`;
}

/** A confirmed later snapshot retires an old display-read recovery notice. */
export function goalNeedsRefresh(refreshRevision: number | undefined, publishedRevision: number, readFailed: boolean, readError: string | null): boolean {
  return refreshRevision !== undefined && publishedRevision < refreshRevision && (readFailed || Boolean(readError));
}
