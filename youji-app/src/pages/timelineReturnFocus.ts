export interface TimelinePosition { top: number; entryId?: string; locationKey?: string }

/** A handled data frame spends its focus return, without replacing a newer open. */
export function consumeTimelineReturnFocus(positions: Map<string, TimelinePosition>, key: string, saved: TimelinePosition) {
  if (positions.get(key) === saved) positions.set(key, { top: saved.top });
}

/** A single exact-row return, cancelled if the user moves on while records load. */
export function prepareTimelineReturnFocus(
  document: Document,
  buttons: ReadonlyMap<string, HTMLButtonElement>,
  entryId: string,
) {
  let pending = true;
  const hasActiveControl = () => {
    const active = document.activeElement;
    return active && active !== document.body && active !== document.documentElement && active.isConnected;
  };
  const inputs = ['keydown', 'pointerdown', 'wheel', 'touchstart'];
  const cancel = () => {
    pending = false;
    for (const type of inputs) document.removeEventListener(type, userIntent, true);
    document.removeEventListener('focusin', focusMoved, true);
  };
  const userIntent = (event: Event) => { if (event.isTrusted) cancel(); };
  const focusMoved = () => { if (hasActiveControl()) cancel(); };
  if (hasActiveControl()) cancel();
  else {
    for (const type of inputs) document.addEventListener(type, userIntent, { capture: true, passive: true });
    document.addEventListener('focusin', focusMoved, true);
  }
  return {
    cancel,
    restore() {
      if (!pending) return;
      cancel();
      const button = buttons.get(entryId);
      if (hasActiveControl() || !button?.isConnected || button.matches(':disabled, [hidden]') || !button.getClientRects().length) return;
      button.focus({ preventScroll: true });
    },
  };
}
