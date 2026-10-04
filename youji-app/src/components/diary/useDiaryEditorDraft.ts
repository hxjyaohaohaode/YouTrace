import { retainPendingEditor, readPendingEditor, releasePendingEditor } from '../../services/pendingEditorMemory';
import { useCallback, useEffect, useRef, useState } from 'react';
import { openDiaryDraft, saveDiaryDraft, type DiaryContext, type DiaryForm } from './diaryDraft';

/** Edits remain local until a separate atomic business commit consumes this exact draft. */
export function useDiaryEditorDraft(recordId: string, initial: DiaryForm) {
  const initialRef = useRef(initial);
  const [value, setValue] = useState(initial);
  const valueRef = useRef(initial);
  const context = useRef<DiaryContext | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const lastError = useRef<Error | null>(null);
  const pendingCount = useRef(0);
  const active = useRef(true);
  const generation = useRef(0);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [restored, setRestored] = useState(false);

  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        openDiaryDraft(recordId),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('草稿读取暂未完成，请重试；原稿不会被覆盖')), 8000); }),
      ]);
      if (!active.current || request !== generation.current) return;
      context.current = result.context;
      setReady(true); setError(''); lastError.current = null;
      const recovered = readPendingEditor<DiaryForm>(result.context);
      const next = recovered ?? result.value ?? initialRef.current;
      valueRef.current = next; setValue(next); setRestored(recovered !== null || result.value !== null);
      if (recovered !== null) { lastError.current = new Error('已找回离开前尚未落盘的修改，请重试保留草稿'); setError(lastError.current.message); }
    } catch (reason) {
      if (active.current && request === generation.current) setError(reason instanceof Error ? reason.message : '草稿读取失败，请重试');
    } finally {
      clearTimeout(timer);
      if (active.current && request === generation.current) setLoading(false);
    }
  }, [recordId]);
  useEffect(() => { active.current = true; void Promise.resolve().then(load); return () => { active.current = false; generation.current += 1; }; }, [load]);

  const update = (next: DiaryForm) => {
    valueRef.current = next; setValue(next);
    const retainedScope = context.current;
    const memoryToken = retainedScope ? retainPendingEditor(retainedScope, next) : null;
    pendingCount.current += 1; setPending(true);
    queue.current = queue.current.then(async () => {
      if (!context.current) throw new Error('草稿尚未载入，请重试');
      context.current = await saveDiaryDraft(context.current, next);
      if (retainedScope && memoryToken !== null) releasePendingEditor(retainedScope, memoryToken);
      lastError.current = null;
      if (active.current) setError('');
    }).catch((reason: unknown) => {
      lastError.current = reason instanceof Error ? reason : new Error('草稿未能保存，离开前请重试或复制输入');
      if (active.current) setError(lastError.current.message);
    }).finally(() => { pendingCount.current -= 1; if (active.current && pendingCount.current === 0) setPending(false); });
  };

  useEffect(() => {
    if (!pending && !error) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [pending, error]);

  const prepare = async () => {
    await queue.current;
    if (lastError.current) throw lastError.current;
    if (!context.current) throw new Error('草稿尚未载入，请重试');
    return context.current;
  };
  return { value, update, loading, pending, error, restored, ready, prepare, retry: () => context.current ? update(valueRef.current) : void load() };
}
