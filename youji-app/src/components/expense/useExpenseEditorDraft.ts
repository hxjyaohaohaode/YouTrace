import { retainPendingEditor, readPendingEditor, releasePendingEditor } from '../../services/pendingEditorMemory';
import { useCallback, useEffect, useRef, useState } from 'react';
import { openExpenseDraft, saveExpenseDraft, type ExpenseContext } from './expenseDraft';

/** A domain-local draft; cancel never applies it to the record. */
export function useExpenseEditorDraft<T>(recordId: string, initial: T) {
  const initialRef = useRef(initial);
  const [value, setValue] = useState(initial);
  const valueRef = useRef(initial);
  const context = useRef<ExpenseContext | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const lastError = useRef<Error | null>(null);
  const pendingCount = useRef(0);
  const active = useRef(true);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [restored, setRestored] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await openExpenseDraft<T>(recordId);
      if (!active.current) return;
      context.current = result.context;
      setReady(true);
      setError('');
      const recovered = readPendingEditor<T>(result.context);
      const next = recovered ?? result.value ?? initialRef.current;
      valueRef.current = next;
      setValue(next);
      setRestored(recovered !== null || result.value !== null);
      if (recovered !== null) { lastError.current = new Error('已找回离开前尚未落盘的修改，请重试保留草稿'); setError(lastError.current.message); }
      if (recovered === null) lastError.current = null;
    } catch (reason) {
      if (active.current) setError(reason instanceof Error ? reason.message : '草稿读取失败，请重试');
    } finally { if (active.current) setLoading(false); }
  }, [recordId]);

  useEffect(() => { active.current = true; void Promise.resolve().then(load); return () => { active.current = false; }; }, [load]);

  const update = (next: T) => {
    valueRef.current = next;
    setValue(next);
    const retainedScope = context.current;
    const memoryToken = retainedScope ? retainPendingEditor(retainedScope, next) : null;
    pendingCount.current += 1;
    setPending(true);
    queue.current = queue.current.then(async () => {
      if (!context.current) throw new Error('草稿尚未载入，请重试');
      context.current = await saveExpenseDraft(context.current, next);
      if (retainedScope && memoryToken !== null) releasePendingEditor(retainedScope, memoryToken);
      lastError.current = null;
      if (active.current) setError('');
    }).catch((reason: unknown) => {
      lastError.current = reason instanceof Error ? reason : new Error('草稿未能保存，离开前请重试');
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
