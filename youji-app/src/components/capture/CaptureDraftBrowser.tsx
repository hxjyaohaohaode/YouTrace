import { useCallback, useEffect, useRef, useState } from 'react';
import { liveQuery, type Subscription } from 'dexie';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { useAuthStore } from '../../stores/authStore';
import { assertLocalActorNow, captureLocalActor, type LocalActor } from '../../services/localActor';
import { assertCaptureCatalogContext, isCaptureCatalogContextCurrent, listCaptureDraftPage, readCaptureCatalogEntry, type CaptureCatalogCursor, type CaptureCatalogEntry, type CaptureCatalogPage } from '../../services/captureDraftCatalog';
import type { CaptureDraft } from '../../services/quickNoteIntegration';

/** Human-readable fields, not an import/export format. Never drop undefined/-0. */
function captureReadonlyFields(value: unknown, depth = 0): string {
  if (depth > 8) return '[无法完整显示，请保留原稿]';
  if (value === undefined) return 'undefined（字段存在）';
  if (value === null) return 'null';
  if (typeof value === 'number') return Object.is(value, -0) ? '-0' : String(value);
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (!value || typeof value !== 'object') return '[不支持的字段类型]';
  const pad = '  '.repeat(depth), child = '  '.repeat(depth + 1);
  if (Array.isArray(value)) return `[${value.map(item => `\n${child}${captureReadonlyFields(item, depth + 1)}`).join(',')}${value.length ? `\n${pad}` : ''}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(key => `\n${child}${JSON.stringify(key)}: ${captureReadonlyFields((value as Record<string, unknown>)[key], depth + 1)}`).join(',')}${keys.length ? `\n${pad}` : ''}}`;
}
const contextChanged = '账号或本机资料已变化，请重新打开查看；原稿未改动';
export function CaptureDraftBrowser({ disabled = false }: { disabled?: boolean }) {
  const user = useAuthStore(state => state.user);
  const [open, setOpen] = useState(false), [page, setPage] = useState<CaptureCatalogPage | null>(null);
  const [selected, setSelected] = useState<CaptureCatalogEntry | null>(null), [detail, setDetail] = useState<CaptureDraft | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const generation = useRef(0), isOpen = useRef(false), currentPage = useRef<CaptureCatalogPage | null>(null), detailSubscription = useRef<Subscription | null>(null);
  const stopDetail = () => { detailSubscription.current?.unsubscribe(); detailSubscription.current = null; };
  const invalidate = useCallback((message: string) => {
    ++generation.current; detailSubscription.current?.unsubscribe(); detailSubscription.current = null; currentPage.current = null;
    setPage(null); setSelected(null); setDetail(null); setBusy(false); setError(message);
  }, []);
  useEffect(() => () => { ++generation.current; isOpen.current = false; detailSubscription.current?.unsubscribe(); }, []);
  // IDB changes are observable. Authentication's real render/unmount flow and
  // synchronous guards cover identity; this is not polling arbitrary JS state.
  useEffect(() => {
    if (!open || !page) return;
    const subscription = liveQuery(async () => await assertCaptureCatalogContext(page)).subscribe({
      next: () => { if (isOpen.current && currentPage.current === page && !isCaptureCatalogContextCurrent(page)) invalidate(contextChanged); },
      error: () => { if (isOpen.current && currentPage.current === page) invalidate(contextChanged); },
    });
    return () => subscription.unsubscribe();
  }, [open, page, user, invalidate]);
  const load = async (cursor?: CaptureCatalogCursor) => {
    const request = ++generation.current; stopDetail(); currentPage.current = null;
    setPage(null); setSelected(null); setDetail(null); setError(''); setBusy(true);
    let actor: Omit<LocalActor, 'epoch'> | undefined;
    try {
      actor = captureLocalActor();
      const value = await listCaptureDraftPage({ cursor, limit: 20 });
      if (!isOpen.current || request !== generation.current) return;
      if (!isCaptureCatalogContextCurrent(value)) { invalidate(contextChanged); return; }
      currentPage.current = value; setPage(value);
    } catch (cause) {
      if (isOpen.current && request === generation.current) {
        let same = false; try { if (actor) { assertLocalActorNow(actor); same = true; } } catch { /* hide stale identity errors */ }
        setError(same ? `暂时无法读取本机未提交稿。${cause instanceof Error ? cause.message : '请稍后重试'} 原稿未改动，不会因此创建空稿。` : contextChanged);
      }
    } finally { if (isOpen.current && request === generation.current) setBusy(false); }
  };
  const choose = (entry: CaptureCatalogEntry) => {
    const request = ++generation.current; stopDetail(); setSelected(entry); setDetail(null); setError(''); setBusy(true);
    const subscription = liveQuery(async () => await readCaptureCatalogEntry(entry)).subscribe({
      next: value => {
        if (!isOpen.current || request !== generation.current) return;
        if (!isCaptureCatalogContextCurrent(entry)) { invalidate(contextChanged); return; }
        setDetail(value); setBusy(false);
      },
      error: cause => {
        if (isOpen.current && request === generation.current) invalidate(isCaptureCatalogContextCurrent(entry) ? `这份稿件暂时不能按所选版本查看，请重新读取目录。${cause instanceof Error ? cause.message : ''} 原稿未改动。` : contextChanged);
      },
    });
    if (request === generation.current && isOpen.current) detailSubscription.current = subscription;
    else subscription.unsubscribe();
  };
  const close = () => {
    isOpen.current = false; ++generation.current; stopDetail(); currentPage.current = null;
    setOpen(false); setPage(null); setSelected(null); setDetail(null); setBusy(false); setError('');
  };
  const back = () => { ++generation.current; stopDetail(); setSelected(null); setDetail(null); setError(''); setBusy(false); };
  const readable = page && isCaptureCatalogContextCurrent(page);
  const selectedReadable = selected && isCaptureCatalogContextCurrent(selected);
  const invalidIdentity = (page && !readable) || (selected && !selectedReadable);
  return <>
    <Button variant="ghost" disabled={disabled} onClick={() => { if (disabled) return; isOpen.current = true; setOpen(true); void load(); }}>查看本机未提交稿</Button>
    <Modal open={open} onClose={close} title="查看本机未提交稿（只读）" footer={<>{selected && !invalidIdentity && <Button variant="ghost" onClick={back}>返回目录</Button>}<Button variant="ghost" onClick={close}>关闭查看</Button></>}>
      <p className="mb-3 text-sm text-[var(--text-2)]">这里只读查看已写入本机的确认稿，不恢复、编辑或保存。原页仍在，尚未落盘的编辑不会被替换。</p>
      {invalidIdentity ? <p role="alert">{contextChanged}</p> : <>
        {busy && <p role="status">{selected ? '正在核验这一份原稿…' : '正在读取本机未提交稿…'}</p>}
        {error && <p role="alert" className="mb-3 whitespace-pre-wrap break-words text-sm text-[var(--danger)]">{error}</p>}
        {!selected && !busy && <Button variant="ghost" onClick={() => void load()}>重新读取目录</Button>}
        {readable && !selected && <div className="space-y-3">
          <p className="text-xs text-[var(--text-3)]">本次读取的主键顺序，本页检查 {page.scanned} 项；不是最近修改排序或全库总数。</p>
          {page.skipped > 0 && <p className="text-sm">本页 {page.skipped} 项不能按当前格式、归属或未提交状态安全列出，原件仍保留，可从原数据导出中核对。</p>}
          {!page.entries.length && <p role="status">{page.nextCursor ? '本页没有可显示的稿，仍有后续候选。可继续扫描。' : '本次读取没有可安全列出的未提交稿；不代表本机没有其它资料。'}</p>}
          {page.entries.map(entry => <article key={entry.id} className="space-y-2 rounded-lg border border-[var(--border)] p-3">
            <p className="whitespace-pre-wrap break-words text-sm">{entry.draft.input.slice(0, 120)}{entry.draft.input.length > 120 ? '…' : ''}</p>
            <p className="break-all text-xs">原编号：{entry.id}</p>
            <p className="text-xs">基准日期：{entry.draft.context?.date ?? '未知'} · 时区：{entry.draft.context?.timeZone ?? '未知'}；收支 {entry.draft.expenses.length}、待办 {entry.draft.todos.length}、习惯 {entry.draft.habits.length}</p>
            <Button variant="ghost" onClick={() => choose(entry)} aria-label={`查看原稿 ${entry.id}`}>查看这一份原稿</Button>
          </article>)}
          {page.nextCursor && <Button variant="ghost" onClick={() => void load(page.nextCursor!)}>继续扫描后续稿</Button>}
        </div>}
        {selectedReadable && detail && <article className="space-y-4" aria-label="已核验原稿只读详情">
          <p className="break-all text-xs">原编号：{detail.id} · 已核验的本机只读快照</p>
          <section><h3 className="font-semibold">完整原文</h3><p className="whitespace-pre-wrap break-words text-sm" aria-label="只读完整原文">{detail.input}</p></section>
          <p className="text-sm">原文基准日期：{detail.context?.date ?? '未知'} · 时区：{detail.context?.timeZone ?? '未知'}。原文时间不是最后修改时间。</p>
          <section className="space-y-2"><h3 className="font-semibold">当时修正与选择（只读）</h3>
            {detail.expenses.map(row => <p key={row.id} className="whitespace-pre-wrap break-words text-sm">收支 {row.id}：{row.confirmed ? '已选' : '未选'} · {row.name} · 金额原值 {captureReadonlyFields(row.amount)} 分 · 日期 {row.date ?? '未知'} · 类别 {row.category}{row.isIncome ? ' · 收入' : ' · 支出'}</p>)}
            {detail.todos.map(row => <p key={row.id} className="whitespace-pre-wrap break-words text-sm">待办 {row.id}：{row.confirmed ? '已选' : '未选'} · {row.text} · 日期 {row.dueDate ?? '无已知日期'}</p>)}
            {detail.habits.map(row => <p key={row.id} className="whitespace-pre-wrap break-words text-sm">习惯 {row.id}：{row.confirmed ? '已选' : '未选'} · {row.name} · {row.done ? '候选已完成' : '候选未完成'} · 日期 {row.date ?? '未知'}</p>)}
            <p className="whitespace-pre-wrap break-words text-sm">日记：{detail.diary === null ? '未选择日记正文' : detail.diary} · 日期 {detail.diaryDate ?? '未知'}</p>
            <p className="text-sm">情绪：{detail.moodConfirmed ? '已选' : '未选'} · {detail.mood ?? '未知'} · 分值 {captureReadonlyFields(detail.moodScore)}</p>
          </section>
          <details><summary className="cursor-pointer py-2 text-sm font-semibold">查看全部原始字段（只读）</summary><p className="text-xs text-[var(--text-3)]">用于核对字段及类型，不是可导入备份格式；未出现的字段表示原稿缺席。</p><pre className="whitespace-pre-wrap break-words text-xs" aria-label="只读完整字段">{captureReadonlyFields(detail)}</pre></details>
        </article>}
      </>}
    </Modal>
  </>;
}
