/** Return after closing without overriding focus the user has already moved. */
export function restoreModalFocus(
  panel: HTMLElement | null,
  previous: HTMLElement | null,
  fallback?: () => HTMLElement | null,
): void {
  const document = panel?.ownerDocument ?? previous?.ownerDocument;
  if (!document) return;
  const active = document.activeElement;
  const pageRoot = (element: Element | null) => element === document.body || element === document.documentElement;
  if (active && !pageRoot(active) && active.isConnected && !panel?.contains(active)) return;
  const available = (element: HTMLElement | null | undefined): element is HTMLElement =>
    Boolean(element && !pageRoot(element) && element.isConnected && !element.matches(':disabled, [hidden]') && element.getClientRects().length);
  const target = available(previous) ? previous : fallback?.();
  if (available(target)) target.focus();
}
