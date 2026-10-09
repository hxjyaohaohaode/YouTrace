import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { assertLocalActorNow, captureLocalActor } from '../../services/localActor';

interface ReturnRequest {
  id: string;
  scopeKey: string;
  actor: ReturnType<typeof captureLocalActor>;
}

/** Closing may return to its record only until the user starts something newer. */
export function useDiaryFocusReturn(scopeKey: string, editorOpen: boolean) {
  const [request, setRequest] = useState<ReturnRequest | null>(null);
  const consumed = useRef<ReturnRequest | null>(null);
  const cancelPending = useRef<(() => void) | null>(null);

  // Invalidate during the route/editor commit, before an old timer can run.
  useLayoutEffect(() => () => cancelPending.current?.(), [scopeKey, editorOpen]);

  useEffect(() => {
    if (!request || consumed.current === request) return;
    consumed.current = request;
    if (editorOpen || request.scopeKey !== scopeKey) return;

    // Passive setup follows the closing Modal's focus restoration. Its opener
    // is allowed; any subsequent focus or input permanently spends this return.
    const previousFocus = document.activeElement;
    const inputs = ['wheel', 'pointerdown', 'keydown', 'touchstart'];
    let pending = true;
    const cancel = () => {
      pending = false;
      window.clearTimeout(timer);
      for (const type of inputs) document.removeEventListener(type, userIntent, true);
      document.removeEventListener('focusin', focusMoved, true);
      if (cancelPending.current === cancel) cancelPending.current = null;
    };
    const userIntent = (event: Event) => { if (event.isTrusted) cancel(); };
    const focusMoved = () => { if (document.activeElement !== previousFocus) cancel(); };
    const timer = window.setTimeout(() => {
      if (!pending) return;
      cancel();
      try { assertLocalActorNow(request.actor); } catch { return; }
      if (document.activeElement !== previousFocus) return;
      const row = document.getElementById(`diary-record-${request.id}`);
      if (!row?.isConnected || row.matches(':disabled, [hidden]') || !row.getClientRects().length) return;
      row.scrollIntoView({ block: 'center' });
      row.focus({ preventScroll: true });
    }, 250);
    for (const type of inputs) document.addEventListener(type, userIntent, { capture: true, passive: true });
    document.addEventListener('focusin', focusMoved, true);
    cancelPending.current = cancel;
    return cancel;
  }, [request, scopeKey, editorOpen]);

  return useCallback((id: string | undefined) => {
    cancelPending.current?.();
    if (!id) { setRequest(null); return; }
    try { setRequest({ id, scopeKey, actor: captureLocalActor() }); }
    catch { setRequest(null); }
  }, [scopeKey]);
}
