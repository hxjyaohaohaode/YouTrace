import { useEffect, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import { useAuthStore } from '../../stores/authStore';
import { assertLocalActorNow, captureLocalActor } from '../../services/localActor';
import { readCaptureInputActor, assertCaptureInputActor, type CaptureInputActor } from '../../services/captureInputProvenance';
import { cancelCaptureContinuation, prepareCaptureContinuation, type CaptureCatalogEntry, type CaptureContinuation } from '../../services/captureDraftCatalog';

/** Current mounted parent only. No pointer transfer or implicit parent save. */
interface ParentGuard { ready: () => boolean; revision: () => number; epoch: () => string | undefined; currentId?: () => string }
export function useCaptureContinuationHandoff(enabled = true) {
  const user = useAuthStore(state => state.user);
  const [parentActor] = useState(() => { try { return enabled ? captureLocalActor() : null; } catch { return null; } });
  const [child, setChild] = useState<CaptureContinuation | null>(null), [locked, setLocked] = useState(false);
  const current = useRef<CaptureContinuation | null>(null), scope = useRef<CaptureInputActor | null>(null), preparing = useRef(false), mounted = useRef(true), request = useRef(0);
  const background = useRef<HTMLDivElement>(null), hadChild = useRef(false);
  const parentCurrent = () => { try { if (!parentActor) return !enabled; assertLocalActorNow(parentActor); return true; } catch { return false; } };
  useEffect(() => { mounted.current = true; const requests = request, activeChild = current; return () => { mounted.current = false; requests.current++; if (activeChild.current) cancelCaptureContinuation(activeChild.current); }; }, []);
  useEffect(() => {
    if (!child || !scope.current) return;
    const context = scope.current;
    const subscription = liveQuery(async () => { await assertCaptureInputActor(context); }).subscribe({ error: () => { if (mounted.current && current.current === child) setLocked(true); } });
    return () => subscription.unsubscribe();
  }, [child, user]);
  useEffect(() => {
    if (hadChild.current && !child && !locked) background.current?.querySelector<HTMLButtonElement>('[data-capture-catalog-open]')?.focus();
    hadChild.current = Boolean(child);
  }, [child, locked]);
  const begin = async (entry: CaptureCatalogEntry, stillSelected: () => boolean, options: ParentGuard) => {
    if (!enabled || !mounted.current || preparing.current || current.current || !parentCurrent() || !options.ready()) throw new Error('当前编辑尚未稳定保留，请先处理原页的保存或语音；没有替换当前内容');
    if (options.currentId?.() === entry.id) throw new Error('这一份正在原页核对，请关闭查看并回到原编辑');
    const revision = options.revision(), sequence = ++request.current; preparing.current = true;
    let grant: CaptureContinuation | null = null;
    try {
      const context = await readCaptureInputActor();
      if ((context.epoch ?? 'initial') !== options.epoch()) throw new Error('原页的本机资料已变化，请先重新核对');
      grant = await prepareCaptureContinuation(entry);
      await assertCaptureInputActor(context);
      if (!mounted.current || request.current !== sequence || !parentCurrent() || !options.ready() || options.revision() !== revision || !stillSelected()) throw new Error('当前编辑或所选版本已变化，请重新查看；没有交接原稿');
      scope.current = context; current.current = grant; setChild(grant);
    } catch (error) { if (grant) cancelCaptureContinuation(grant); throw error; }
    finally { preparing.current = false; }
  };
  const close = async (grant: CaptureContinuation) => {
    if (current.current !== grant) return;
    const sequence = ++request.current;
    let safe = false;
    try { if (scope.current) { await assertCaptureInputActor(scope.current); safe = parentCurrent(); } } catch { /* never reveal an unverified resident parent */ }
    if (!mounted.current || request.current !== sequence || current.current !== grant) return;
    cancelCaptureContinuation(grant); current.current = null; setLocked(!safe); setChild(null);
  };
  return { child, background, locked: locked || !parentCurrent(), isSuspended: () => Boolean(current.current) || !parentCurrent(), begin, close };
}
