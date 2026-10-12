import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { sharedGoalKeyboardFixture, assertSharedGoalKeyboardFocus, assertOnlySharedGoalCopy, sharedGoalKeyboardFocus, hasDeclaredKeyboardOutline } from '../scripts/audit-shared-goal-keyboard.mjs';
import { seedSharedGoalFixture } from '../scripts/audit-shared-goal-recovery.mjs';
import { readExistingAccount } from '../scripts/audit-initial-session-outcomes.mjs';
import { runInNewContext } from 'node:vm';
const request = <T>(r: IDBRequest<T>) => new Promise<T>((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
after(async () => { await request(indexedDB.deleteDatabase('youtrace')); });

test('keyboard fixture has12 original rows/two pages, long safe primitive text and exact native30 schema accepted by production', async () => {
  await seedSharedGoalFixture(sharedGoalKeyboardFixture);
  const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => m.set(k, v), removeItem: (k: string) => m.delete(k) }; };
  Object.assign(globalThis, { localStorage: memory(), sessionStorage: memory(), window: Object.assign(new EventTarget(), { location: { replace() {} } }), fetch: () => { throw Error('No network'); } });
  const storage = await import('../src/db/index.ts'), api = await import('../src/services/apiClient.ts'), sync = await import('../src/services/syncEngine.ts'), service = await import('../src/services/sharedGoalRecovery.ts');
  const owner = 'synthetic-shared-keyboard-contract'; await storage.bindAccountDatabase(owner); api.setSessionActive(owner); sync.pauseSync();
  try {
    const preview = await service.previewSharedGoals(); assert.equal(preview.items.length, 12); assert.ok(preview.items.every(row => row.original && !row.blockedReason));
    const original = sharedGoalKeyboardFixture[11]; assert.equal(original.description.split('\n').length, 40); assert.ok(original.description.length <= 2000);
    const before = await readExistingAccount(owner); await service.confirmSharedGoal(preview, original.id, { ownerId: owner, belongsToMe: true });
    const after = await readExistingAccount(owner); assertOnlySharedGoalCopy(before, after, original);
    // Do not accept changed schema, missing metadata, other-row corruption or a
    // second legitimate-looking recovery side effect as a successful keyboard copy.
    for (const mutate of [
      (v: typeof after) => { v.databaseName = 'wrong-owner'; },
      (v: typeof after) => { v.schema = []; },
      (v: typeof after) => { v.tables = v.tables.filter(t => t.name !== 'outbox'); },
      (v: typeof after) => { v.tables[0] = structuredClone(v.tables[1]); },
      (v: typeof after) => { v.tables.find(t => t.name === 'settings')!.losslessRows = { type: 'array', length: 0, entries: [] }; },
    ]) { const bad = structuredClone(after); mutate(bad); assert.throws(() => assertOnlySharedGoalCopy(before, bad, original)); }
  } finally { sync.pauseSync(); storage.db.close(); }
});

function goodFocus() { return { matched: true, connected: true, enabled: true, hidden: false, focusedVisible: true, outlineWidth: 2, outlineStyle: 'solid', outlineColor: 'rgb(232, 148, 30)', boxShadow: 'none', rect: { left: 10, top: 10, right: 110, bottom: 54, width: 100, height: 44 }, clip: { left: 0, top: 0, right: 360, bottom: 900 }, hits: Array.from({ length: 5 }, () => ({ self: true })) }; }
test('focus oracle rejects wrong/outside/partially clipped/covered/invisible focus, even when center alone passes', () => {
  assertSharedGoalKeyboardFocus(goodFocus());
  for (const mutate of [
    (s: ReturnType<typeof goodFocus>) => { s.matched = false; },
    (s: ReturnType<typeof goodFocus>) => { s.connected = false; },
    (s: ReturnType<typeof goodFocus>) => { s.enabled = false; },
    (s: ReturnType<typeof goodFocus>) => { s.hidden = true; },
    (s: ReturnType<typeof goodFocus>) => { s.rect.top = -1; },
    (s: ReturnType<typeof goodFocus>) => { s.clip.bottom = 53; },
    (s: ReturnType<typeof goodFocus>) => { s.hits[4].self = false; },
    (s: ReturnType<typeof goodFocus>) => { s.focusedVisible = false; },
    (s: ReturnType<typeof goodFocus>) => { s.outlineStyle = 'none'; },
  ]) { const s = goodFocus(); mutate(s); assert.throws(() => assertSharedGoalKeyboardFocus(s)); }
});

test('browser focus sampler reads actual source key/checked state and ancestor clipping without DOM mutation', () => {
  const rect = { x: 20, y: 20, left: 20, top: 20, right: 120, bottom: 64, width: 100, height: 44 };
  class Element {
    isConnected = true; parentElement: Element | null = null; checked = false; type = 'checkbox'; textContent = ''; tagName = 'INPUT';
    getBoundingClientRect() { return rect; }
    matches(selector: string) { return selector !== ':disabled'; }
    contains(item: unknown) { return item === this; }
    getAttribute(name: string) { return name === 'type' ? 'checkbox' : null; }
    closest(selector: string) { return selector === 'div.rounded-lg' ? { querySelectorAll: () => [{ textContent: '原编号：shared-keyboard-11' }] } : null; }
  }
  const element = new Element(); const style = { overflowX: 'visible', overflowY: 'visible', visibility: 'visible', display: 'block', opacity: '1', outlineWidth: '2px', outlineStyle: 'solid', outlineColor: 'rgb(232, 148, 30)', boxShadow: 'none' };
  const context = { document: { activeElement: element, elementFromPoint: () => element }, HTMLElement: Element, HTMLInputElement: Element, getComputedStyle: () => style, innerWidth: 360, innerHeight: 900 };
  const read = runInNewContext(`(${sharedGoalKeyboardFocus.toString()})`, context);
  const state = read({ selector: 'input', sourceKey: 'shared-keyboard-11' }); assert.equal(state.sourceKey, 'shared-keyboard-11'); assert.equal(state.checked, false); assertSharedGoalKeyboardFocus(state);
  element.parentElement = new Element(); style.overflowY = 'hidden'; assert.equal(read({ selector: 'input' }).clip.bottom, 64);
});

test('hosted keyboard baseline keeps native keys and only readonly observations after setup, preserving original18-chain independently', async () => {
  const source = await readFile(new URL('../scripts/audit-shared-goal-keyboard.mjs', import.meta.url), 'utf8');
  assert.match(source, /process\.env\.GITHUB_ACTIONS, 'true'/); assert.match(source, /\[1280, 360\]/);
  const recovery = source.split('// From this point every recovery interaction is native keyboard only.')[1]; assert.ok(recovery);
  assert.doesNotMatch(recovery, /\bpointer\(|\.mouse\.|\.focus\(|\.click\(/);
  for (const token of ["key('Enter'", "key('Space'", "key('Escape'", "key('Shift+Tab'", "key('Tab'", 'Escape-zero-writes-natural-return', 'reopen-reset-and-cancel-zero-writes', 'assertOnlySharedGoalCopy', 'verifySharedGoalReceiptHash', 'JSON.parse(displayed.raw)', 'long-original-owner-top-focus', 'sourceTransactions.every', "await save('final'"]) assert.ok(source.includes(token), token);
  assert.doesNotMatch(source, /force\s*:\s*true|localStorage\.setItem|confirmSharedGoal\(/);
});

test('actual Modal effect selects checkbox, traps outer Tab bounds, calls Esc and restores the original opener (DOM-shaped unit only)', async () => {
  const ts = await import('typescript');
  const source = await readFile(new URL('../src/components/ui/Modal.tsx', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const { restoreModalFocus } = await import('../src/components/ui/modalFocus.ts');
  for (const hasCheckbox of [true, false]) {
    let closes = 0, ref = 0; const effects: Array<() => (() => void) | void> = [], listeners = new Map<string, (event: KeyboardEvent) => void>();
    const doc = { activeElement: null as unknown, body: { style: { overflow: 'scroll' } }, documentElement: {}, addEventListener: (name: string, listener: (event: KeyboardEvent) => void) => listeners.set(name, listener), removeEventListener: (name: string) => listeners.delete(name) };
    const node = (name: string) => ({ name, ownerDocument: doc, isConnected: true, matches: () => false, getClientRects: () => [{}], focus() { doc.activeElement = this; } });
    const opener = node('opener'), close = node('close'), checkbox = node('checkbox'), cancel = node('cancel');
    const controls = hasCheckbox ? [close, checkbox, cancel] : [close, cancel];
    const panel = { ...node('panel'), contains: (value: unknown) => controls.includes(value as typeof close), querySelector: (selector: string) => selector.startsWith('input') ? hasCheckbox ? checkbox : null : close, querySelectorAll: () => controls };
    doc.activeElement = opener;
    const exported: { Modal?: (props: { open: boolean; onClose: () => void }) => unknown } = {};
    const jsx = (_type: unknown, props: unknown) => props;
    const mocks: Record<string, unknown> = {
      react: { useEffect: (effect: () => (() => void) | void) => effects.push(effect), useId: () => 'synthetic-title', useRef: (value: unknown) => ({ current: ++ref === 1 ? panel : value }) },
      'react/jsx-runtime': { jsx, jsxs: jsx }, 'framer-motion': { motion: { div: 'div' }, AnimatePresence: 'fragment' }, 'lucide-react': { X: 'x' },
      '../../hooks/useMediaQuery': { useMediaQuery: () => true }, './modalFocus': { restoreModalFocus },
    };
    runInNewContext(code, { exports: exported, require: (name: string) => { assert.ok(name in mocks, name); return mocks[name]; }, document: doc });
    exported.Modal!({ open: true, onClose: () => { closes++; } });
    const cleanup = effects.map(effect => effect()).filter((fn): fn is () => void => typeof fn === 'function').at(-1)!;
    assert.equal(doc.activeElement, hasCheckbox ? checkbox : close); assert.equal(doc.body.style.overflow, 'hidden');
    const dispatch = (key: string, shiftKey = false) => { let prevented = false, stopped = false; listeners.get('keydown')!({ key, shiftKey, preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } } as KeyboardEvent); return { prevented, stopped }; };
    doc.activeElement = cancel; assert.equal(dispatch('Tab').prevented, true); assert.equal(doc.activeElement, close);
    assert.equal(dispatch('Tab', true).prevented, true); assert.equal(doc.activeElement, cancel);
    doc.activeElement = hasCheckbox ? checkbox : close; assert.equal(dispatch('Tab').prevented, false, 'Interior Tab is left to real browser default behavior');
    assert.deepEqual(dispatch('Escape'), { prevented: false, stopped: true }); assert.equal(closes, 1);
    cleanup(); assert.equal(doc.activeElement, opener); assert.equal(doc.body.style.overflow, 'scroll'); assert.equal(listeners.size, 0);
  }
});


test('computed outline guard rejects transparent ring and zero or opaque shadow-only evidence; it does not certify contrast', () => {
  const state = goodFocus();
  for (const outlineColor of ['rgba(0, 0, 0, 0)', 'rgb(0 0 0 / 0%)', 'transparent', 'currentColor', '', 'rgba(1,2,3,NaN)']) assert.equal(hasDeclaredKeyboardOutline({ ...state, outlineColor }), false);
  for (const boxShadow of ['rgba(0, 0, 0, 0) 0px 0px 0px 0px', 'rgb(0,0,0) 0px 0px 0px 4px']) assert.equal(hasDeclaredKeyboardOutline({ ...state, outlineWidth: 0, outlineStyle: 'none', boxShadow }), false);
  for (const outlineColor of ['rgb(232, 148, 30)', 'rgba(0, 0, 0, 1)', 'rgb(0 0 0 / 100%)']) assert.equal(hasDeclaredKeyboardOutline({ ...state, outlineColor }), true);
  // No contrast ratio or WCAG claim is inferred from a nontransparent color.
  assert.equal(hasDeclaredKeyboardOutline({ ...state, outlineColor: 'rgb(255,255,255)', backgroundColor: 'rgb(255,255,255)' }), true);
});
