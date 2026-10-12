import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { readLocalActor, assertLocalActor, type LocalActor } from '../../services/localActor';
import { previewSharedGoals, confirmSharedGoal, listSharedGoalReviews, type SharedGoalPreview, type SharedGoalReview } from '../../services/sharedGoalRecovery';

function fields(value: unknown) {
  if (value === null) return '当前副本不存在';
  // Only the known flat primitive record gets a JSON reading view. Check before
  // stringify (Date.toJSON and undefined would otherwise silently lose facts).
  if (typeof value === 'object' && value && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) && Reflect.ownKeys(value).every(key => {
    if (typeof key !== 'string') return false;
    const entry = Object.getOwnPropertyDescriptor(value, key);
    if (!entry || !('value' in entry)) return false;
    return entry.value === null || typeof entry.value === 'string' || typeof entry.value === 'boolean' || (typeof entry.value === 'number' && Number.isFinite(entry.value) && !Object.is(entry.value, -0));
  })) return JSON.stringify(value, null, 2);
  return '当前记录含扩展类型，无法在此完整显示。记录已保留，请从“导出数据”的原始数据部分核对。';
}
export function SharedGoalRecoveryPanel() {
  const [preview, setPreview] = useState<SharedGoalPreview | null>(null);
  const [reviews, setReviews] = useState<SharedGoalReview[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [review, setReview] = useState<SharedGoalReview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [page, setPage] = useState(0);
  const [receiptPage, setReceiptPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const guard = useRef(false), generation = useRef(0);
  useEffect(() => () => { ++generation.current; }, []);
  async function run<T>(action: () => Promise<T>, publish: (value: T) => void, failure: string) {
    if (guard.current) return;
    guard.current = true; setBusy(true); setMessage('');
    const current = ++generation.current;
    let actor: LocalActor | undefined;
    try {
      actor = await readLocalActor();
      const value = await action();
      await assertLocalActor(actor);
      if (current === generation.current) publish(value);
    } catch (error) {
      if (current !== generation.current) return;
      // No old-account result/error content survives a context change.
      let same = false;
      try { if (actor) { await assertLocalActor(actor); same = true; } } catch { /* changed */ }
      if (current !== generation.current) return;
      if (!same) { setPreview(null); setSelected(null); setReviews([]); setReview(null); setConfirmed(false); }
      setMessage(same ? `${failure} ${error instanceof Error ? error.message : '请稍后重试'}` : '账号或本机资料已变化，请重新打开；原始资料仍保留');
    } finally { guard.current = false; if (current === generation.current) setBusy(false); }
  }
  const load = () => run(previewSharedGoals, value => { setPreview(value); setSelected(null); setConfirmed(false); setPage(0); setMessage(`已读取 ${value.items.length} 份旧目标；尚未确认归属或复制`); }, '未打开新的恢复预览。');
  const loadReceipts = () => run(listSharedGoalReviews, value => { setReviews(value); setReview(null); setReceiptPage(0); setMessage(`已读取 ${value.length} 份本账号恢复收据`); }, '收据暂时无法读取，记录未改动。');
  const save = () => {
    if (!preview || selected === null || !confirmed) return;
    void run(() => confirmSharedGoal(preview, selected, { ownerId: preview.ownerId, belongsToMe: confirmed }), receipt => {
      setSelected(null); setConfirmed(false);
      setMessage(`复制确认已有耐久收据。副本编号：${receipt.copyId}。若曾修改或删除，重试不会覆盖或重新创建；请查看恢复收据核对当前状态。`);
    }, '复制结果尚未确认，请查看恢复收据或重试同一项；不会因重试重复创建。');
  };
  const item = preview?.items.find(value => value.key === selected && value.original);
  return <section className="shared-goal-recovery space-y-3 rounded-xl border border-[var(--warning)]/30 p-3" aria-label="逐项恢复旧版目标">
    <h3 className="text-sm font-semibold">逐项恢复旧版目标</h3>
    <p className="text-sm text-[var(--text-2)]">只支持已核对结构的一种旧版目标。资料可能属于不同账号，请先备份，再逐项确认。确认后新增仅本机副本，原库不改动、不自动上传。当前无法证明所有旧窗口后续写入，因此不提供自动撤销删除。</p>
    <div className="flex flex-wrap gap-2"><Button variant="ghost" size="sm" disabled={busy} onClick={() => void load()}>预览旧版目标</Button><Button variant="ghost" size="sm" disabled={busy} onClick={() => void loadReceipts()}>查看恢复收据</Button></div>
    {message && !item && <p role="status" className="whitespace-pre-wrap break-words text-sm">{message}</p>}
    {preview && <div className="space-y-2">
      <p className="break-all text-sm">本次目标账号：{preview.ownerId}</p>
      <p className="break-all text-xs text-[var(--text-3)]">快照 {preview.snapshotDigest}。这里只复制此刻封存的版本；旧窗口随后编辑需重新预览。</p>
      {preview.items.slice(page * 10, page * 10 + 10).map((row, index) => <div key={`${page}:${index}`} className="rounded-lg border border-[var(--border-light)] p-2">
        <p className="whitespace-pre-wrap break-words text-sm">{row.original?.title ?? row.key}</p>
        <p className="break-all text-xs text-[var(--text-3)]">原编号：{row.key}</p>
        {row.blockedReason ? <p className="text-sm text-[var(--warning)]">{row.blockedReason}</p> : <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setSelected(row.key); setConfirmed(false); }}>核对这一份原文</Button>}
      </div>)}
      <div className="flex flex-wrap gap-2"><Button size="sm" variant="ghost" disabled={busy || page === 0} onClick={() => setPage(page - 1)}>上一页目标</Button><Button size="sm" variant="ghost" disabled={busy || (page + 1) * 10 >= preview.items.length} onClick={() => setPage(page + 1)}>下一页目标</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => { setPreview(null); setSelected(null); setConfirmed(false); }}>关闭预览</Button></div>
    </div>}
    {reviews.slice(receiptPage * 10, receiptPage * 10 + 10).map(row => <Button key={row.receipt.intentId} variant="ghost" size="sm" disabled={busy} className="max-w-full whitespace-normal break-words" onClick={() => setReview(row)}>比较恢复副本：{row.receipt.original.title}</Button>)}
    {reviews.length > 10 && <div className="flex gap-2"><Button size="sm" variant="ghost" disabled={busy || receiptPage === 0} onClick={() => setReceiptPage(receiptPage - 1)}>上一页收据</Button><Button size="sm" variant="ghost" disabled={busy || (receiptPage + 1) * 10 >= reviews.length} onClick={() => setReceiptPage(receiptPage + 1)}>下一页收据</Button></div>}
    <Modal open={Boolean(item)} onClose={() => { if (!busy) { setSelected(null); setConfirmed(false); } }} title="确认这一份旧版目标的归属" footer={<><Button variant="ghost" disabled={busy} onClick={() => { setSelected(null); setConfirmed(false); }}>暂不恢复</Button><Button disabled={busy || !confirmed} onClick={save}>确认并创建仅本机副本</Button></>}>
      <p className="mb-3 break-all text-sm">目标账号：{preview?.ownerId}。旧版原编号保存在收据中；新副本使用新编号。保留原文、原始时间及空日期，不推断创建时间。</p>
      <pre className="max-w-full whitespace-pre-wrap break-words rounded-lg bg-[var(--surface)] p-3 text-sm">{fields(item?.original ?? null)}</pre>
      <label className="mt-4 flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} /><span>我确认这一份资料属于我，并同意复制到上面显示的当前账号本机。其他人的资料不要选择。</span></label>
      {message && <p role="status" className="mt-3 whitespace-pre-wrap break-words text-sm">{message}</p>}
      <p className="mt-3 text-sm text-[var(--warning)]">不自动上传，不删除旧版原文。提交后无法保证自动撤销；后续普通删除是另一次明确操作。</p>
    </Modal>
    <Modal open={Boolean(review)} onClose={() => setReview(null)} title="恢复快照与当前副本" footer={<Button variant="ghost" onClick={() => setReview(null)}>保留并返回</Button>}>
      <p role="status" className="mb-3 text-sm">{review?.reason}</p>
      <p className="mb-2 break-all text-xs">原编号 {review?.receipt.sourceKey} → 副本 {review?.receipt.copyId}</p>
      <h4 className="font-semibold">恢复时原文</h4><pre className="mb-3 whitespace-pre-wrap break-words text-sm">{fields(review?.receipt.original ?? null)}</pre>
      <h4 className="font-semibold">本次读取的当前副本</h4><pre className="mb-3 whitespace-pre-wrap break-words text-sm">{fields(review?.current ?? null)}</pre>
      <p className="mb-3 text-sm">此处仅比较，不删除或恢复记录。若你决定另行编辑或普通删除，可到目标页核对原文。该页面不按恢复编号自动定位；同名无法辨识时先保留，不要仅凭标题删除。清除本地数据会同时清除本机收据，请先导出。</p>
      <Link to="/goal" className="text-sm text-[var(--link)] underline">前往目标页</Link>
    </Modal>
  </section>;
}
