/** Resolve only inside the still-mounted Expense page; Modal owns synchronous focus restoration. */
export function expenseReturnFocus(page: HTMLElement | null, recordId?: string): HTMLElement | null {
  if (!page?.isConnected) return null;
  const row = recordId ? Array.from(page.querySelectorAll<HTMLElement>('button.expense-ledger-row')).find(node => node.id === `expense-record-${recordId}`) : null;
  const candidates = [row, page.querySelector<HTMLElement>('#expense-filter-month'), page.querySelector<HTMLElement>('button[aria-label="添加花销"]')];
  return candidates.find((node): node is HTMLElement => Boolean(node && node.isConnected && page.contains(node) && !node.matches(':disabled, [hidden]') && node.getClientRects().length)) ?? null;
}
