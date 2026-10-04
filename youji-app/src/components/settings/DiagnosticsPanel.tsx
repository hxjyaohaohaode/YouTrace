import { useState } from 'react';
import { diagnosticSnapshot, clearDiagnostics } from '../../services/diagnostics';
import { Button } from '../ui/Button';

export function DiagnosticsPanel() {
  const [snapshot, setSnapshot] = useState(diagnosticSnapshot);
  const errors = snapshot.filter((row) => row.kind === 'runtime-error' || row.kind === 'request-failed').length;
  return <details className="rounded-2xl border border-[var(--border-light)] bg-[var(--surface)] p-4">
    <summary className="cursor-pointer text-sm font-semibold">本次运行状态</summary>
    <p className="mt-2 text-xs text-[var(--text-3)]">构建：{__BUILD_REVISION__}</p>
    <p className="mt-3 text-xs leading-relaxed text-[var(--text-2)]">仅当前页面内存保留最近 120 条页面、控件类型、请求状态和耗时计数。不会记录输入内容、账号、记录标题、URL 参数，也不上传任何统计。刷新或退出即清空。</p>
    <div className="mt-3 flex gap-2"><Button size="sm" variant="ghost" onClick={() => setSnapshot(diagnosticSnapshot())}>刷新状态</Button><Button size="sm" variant="ghost" onClick={() => { clearDiagnostics(); setSnapshot([]); }}>清空本次计数</Button></div>
    <p className="mt-2 text-xs" role="status">本次 {snapshot.length} 条运行事件 · {errors} 次请求失败或运行异常</p>
    <ul className="mt-3 max-h-48 overflow-auto text-xs leading-6 text-[var(--text-3)]">{snapshot.slice(-12).reverse().map((row, index) => <li key={`${row.at}-${index}`}>{row.area} · {row.kind}{row.elapsedMs !== undefined ? ` · ${row.elapsedMs} ms` : ''}{row.status ? ` · HTTP ${row.status}` : ''}</li>)}</ul>
  </details>;
}
