import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { expenseReturnFocus } from '../src/components/expense/expenseFocus';
import { restoreModalFocus } from '../src/components/ui/modalFocus';

function surface() {
  const document = { activeElement: null as unknown, body: null as unknown, documentElement: null as unknown };
  let scroll = 0;
  const node = (id: string, position = 0) => ({
    id, ownerDocument: document, isConnected: true, disabled: false, visible: true, focusCalls: 0,
    matches() { return this.disabled; }, getClientRects() { return this.visible ? [{}] : []; },
    focus() { this.focusCalls++; scroll = position; document.activeElement = this; },
  });
  const body = node('body'), field = node('field'), opener = node('expense-record-one'), month = node('month'), add = node('add');
  document.body = body; document.documentElement = node('html'); document.activeElement = field;
  let rows = [opener];
  const page = { isConnected: true, querySelectorAll: () => rows, contains: (value: unknown) => [...rows, month, add].includes(value as typeof opener), querySelector: (selector: string) => selector === '#expense-filter-month' ? month : add };
  const panel = { ownerDocument: document, contains: (value: unknown) => value === field };
  const fallback = () => expenseReturnFocus(page as unknown as HTMLElement, 'one');
  const restore = (previous: typeof opener | null = opener) => restoreModalFocus(panel as unknown as HTMLElement, previous as unknown as HTMLElement | null, fallback);
  return { document, node, page, opener, month, add, field, body, fallback, restore, scroll: () => scroll, removeRow() { opener.isConnected = false; rows = []; } };
}

test('Expense cancellation returns the original record synchronously and leaves the next control focused', () => {
  const s = surface(); s.restore(); assert.equal(s.document.activeElement, s.opener);
  const next = s.node('scope-summary'); s.document.activeElement = next;
  s.restore(); assert.equal(s.document.activeElement, next); assert.equal(s.opener.focusCalls, 1);
});

test('A filtered-out or deleted Expense returns to its scoped month selector, then add control if unavailable', () => {
  const s = surface(); s.removeRow(); s.restore(); assert.equal(s.document.activeElement, s.month);
  s.document.activeElement = s.field; s.month.disabled = true; s.restore(); assert.equal(s.document.activeElement, s.add);
  s.document.activeElement = s.field; s.add.visible = false; s.restore(); assert.equal(s.document.activeElement, s.field);
});

test('An exiting but still connected Expense opener is skipped while its day group remains', () => {
  const s = surface(); s.opener.disabled = true;
  assert.equal(s.opener.isConnected, true); s.restore();
  assert.equal(s.document.activeElement, s.month); assert.equal(s.opener.focusCalls, 0);
  const detail = readFileSync(new URL('../src/components/expense/ExpenseDetail.tsx', import.meta.url), 'utf8');
  assert.match(detail, /const isPresent = useIsPresent\(\)/);
  assert.match(detail, /disabled=\{!isPresent\}/);
});

test('Timeline entry without an opener chooses the matching scoped record during close', () => {
  const s = surface();
  s.restore(null); assert.equal(s.document.activeElement, s.opener); assert.equal(s.opener.focusCalls, 1);
});

test('Unmounted Expense cannot select new-page controls and reopening does not surrender focus', () => {
  const s = surface(); s.page.isConnected = false; assert.equal(s.fallback(), null);
  s.removeRow(); s.document.activeElement = s.body; s.restore(); assert.equal(s.document.activeElement, s.body);
  const reopenedField = s.node('new-dialog-field'); s.document.activeElement = reopenedField;
  s.restore(); assert.equal(s.document.activeElement, reopenedField); assert.equal(s.month.focusCalls, 0);
});

test('The actual Expense close callback queues no delayed focus or scroll work', () => {
  const text = readFileSync(new URL('../src/pages/Expense.tsx', import.meta.url), 'utf8');
  const body = text.match(/const closeEditor = \(\) => \{([\s\S]*?)\n {2}\};/)?.[1]; assert.ok(body);
  const queued: Array<() => void> = [], updates: unknown[] = [];
  const set = (value: unknown) => updates.push(value);
  const close = new Function('setEditing', 'setShowModal', 'setRecoveryId', 'setDismissed', 'requestKey', 'editing', 'target', 'window', 'document', body);
  close(set, set, set, set, 'route-one', { id: 'one' }, null, { setTimeout: (callback: () => void) => queued.push(callback) }, { getElementById: () => { throw new Error('A closed editor cannot access a later page'); } });
  assert.deepEqual(updates, [undefined, false, undefined, 'route-one']); assert.equal(queued.length, 0);
  for (const callback of queued) callback();
  assert.match(text, /fallbackFocus=\{\(\) => expenseReturnFocus\(pageRef\.current/);
  const editor = readFileSync(new URL('../src/components/expense/AddExpenseModal.tsx', import.meta.url), 'utf8');
  assert.match(editor, /<Modal open onClose=\{close\} fallbackFocus=\{fallbackFocus\}/);
});
