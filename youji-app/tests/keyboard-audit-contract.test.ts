import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keyboardOutcomeChecks as checks, installKeyboardControlObserver } from '../scripts/audit-keyboard-outcomes.mjs';

// Only new keyboard evidence false-green risks. Existing Todo contracts own
// source encoding, full-ledger/ACK, draft identity and exact precommit quota.
test('A complete semantic cycle allows native date segments, but not skipped controls, subloops or escaped focus', () => {
  const forward = ['content', 'priority', 'due-date', 'due-date', 'due-date', 'today', 'tomorrow', 'no-date', 'done', 'delete', 'cancel', 'save', 'close', 'content'];
  const reverse = ['content', 'close', 'save', 'cancel', 'delete', 'done', 'no-date', 'tomorrow', 'today', 'due-date', 'due-date', 'priority', 'content'];
  const nodes = (keys: (string | null)[]) => keys.map(key => ({ key, node: checks.order.indexOf(key) + 1 }));
  assert.equal(checks.cycleResult(nodes(forward), 'forward').pass, true);
  assert.equal(checks.cycleResult(nodes(reverse), 'reverse').pass, true);
  for (const keys of [forward.filter(key => key !== 'done'), ['content', 'priority', 'content'], ['due-date', 'due-date'], ['content', 'priority', null], [...forward.slice(0, 2), 'priority', ...forward.slice(2)], [...forward.slice(0, 5), 'tomorrow', 'today', ...forward.slice(7)]]) assert.equal(checks.cycleResult(nodes(keys), 'forward').pass, false);
  assert.equal(checks.cycleResult(nodes(reverse), 'forward').pass, false);
  const otherDate = nodes(forward); otherDate[3] = { key: 'due-date', node: 50 };
  assert.equal(checks.cycleResult(otherDate, 'forward').pass, false);
  const otherEnd = nodes(forward); otherEnd[otherEnd.length - 1] = { key: 'content', node: 51 };
  assert.equal(checks.cycleResult(otherEnd, 'forward').pass, false);
  const reusedNode = nodes(forward).map(row => row.key === 'priority' ? { ...row, node: 2 } : row);
  assert.equal(checks.cycleResult(reusedNode, 'forward').pass, false);
  const reference = checks.cycleResult(nodes(forward), 'forward').nodes;
  const replacementReverse = nodes(reverse).map(row => row.key === 'due-date' ? { ...row, node: 52 } : row);
  assert.equal(checks.cycleResult(replacementReverse, 'reverse', reference).pass, false);
});

test('Focus-visible alone, unchanged decoration, transparent paint, different nodes and clipped rings cannot pass', () => {
  const css: Record<string, string> = { outlineWidth: '0px', outlineOffset: '0px', outlineStyle: 'none', outlineColor: 'rgb(0, 0, 0)', boxShadow: 'none' };
  for (const side of ['Top', 'Right', 'Bottom', 'Left']) { css[`border${side}Width`] = '1px'; css[`border${side}Style`] = 'solid'; css[`border${side}Color`] = 'rgb(200, 200, 200)'; }
  const unfocused = { node: 3, focused: false, focusVisible: false, css };
  const pseudoOnly = { ...unfocused, focused: true, focusVisible: true };
  const geometry = { visible: true, rect: { left: 10, right: 110, top: 10, bottom: 50 }, clip: { left: 0, right: 120, top: 0, bottom: 60 } };
  assert.equal(checks.indicatorResult(pseudoOnly, unfocused, geometry).pass, false);
  const outlined = { ...pseudoOnly, css: { ...css, outlineWidth: '2px', outlineStyle: 'solid', outlineColor: 'rgb(91, 70, 216)', outlineOffset: '2px' } };
  assert.equal(checks.indicatorResult(outlined, unfocused, geometry).pass, true);
  assert.equal(checks.indicatorResult({ ...outlined, css: { ...outlined.css, outlineColor: 'rgb(0, 0, 0)' } }, unfocused, geometry).pass, true);
  assert.equal(checks.indicatorResult(outlined, { ...outlined, focused: false }, geometry).pass, false);
  assert.equal(checks.indicatorResult(outlined, { ...unfocused, node: 4 }, geometry).pass, false);
  assert.equal(checks.indicatorResult(outlined, unfocused, { ...geometry, visible: false }).pass, false);
  assert.equal(checks.indicatorResult(outlined, unfocused, { ...geometry, rect: { ...geometry.rect, left: 1 } }).pass, false);
  assert.equal(checks.indicatorResult({ ...outlined, css: { ...outlined.css, outlineColor: 'rgba(91, 70, 216, 0)' } }, unfocused, geometry).pass, false);
  const ring = { ...pseudoOnly, css: { ...css, boxShadow: 'rgba(0, 0, 0, 0) 0px 0px 0px 0px, color(srgb 0.35 0.27 0.85 / 0.12) 0px 0px 0px 4px' } };
  assert.equal(checks.indicatorResult(ring, unfocused, geometry).pass, true);
  assert.equal(checks.indicatorResult({ ...ring, css: { ...ring.css, boxShadow: 'rgba(0, 0, 0, 0) 0px 0px 0px 4px' } }, unfocused, geometry).pass, false);
  const border = { ...pseudoOnly, css: { ...css, borderTopColor: 'rgb(91, 70, 216)' } };
  assert.equal(checks.indicatorResult(border, unfocused, geometry).pass, true);
});

test('A correct first frame cannot hide delayed row focus; Save may return a usable remounted button for the same record', () => {
  const opener = { node: 4, tag: 'BUTTON', ariaLabel: '编辑待办 合成：归还图书 2026-10-07', recordId: 'todo-record-target', disabled: false };
  const samples = [0, 100, 250, 500, 600, 650, 700, 750, 800, 850, 900].map(elapsedMs => ({ elapsedMs, active: { ...opener }, modalCount: 0, modalAnimations: 0, geometry: { visible: true } }));
  assert.equal(checks.returnResult(samples, opener).pass, true);
  const row = samples.map(sample => sample.elapsedMs < 250 ? sample : { ...sample, active: { ...opener, node: 8, tag: 'DIV', ariaLabel: '' } });
  assert.equal(checks.returnResult(row, opener).exactOpenerAtEnd, false);
  assert.equal(checks.returnResult(row, opener).sameRecordAtEnd, true);
  assert.equal(checks.returnResult(row, opener).pass, false);
  assert.equal(checks.returnResult(row, opener, { afterSave: true }).pass, false);
  assert.equal(checks.returnResult(samples.slice(0, 3), opener).pass, false);
  assert.equal(checks.returnResult(samples.map(sample => ({ ...sample, modalCount: 1 })), opener).pass, false);
  assert.equal(checks.returnResult(samples.map(sample => ({ ...sample, geometry: { visible: false } })), opener).pass, false);
  const remounted = samples.map(sample => ({ ...sample, active: { ...opener, node: 9, ariaLabel: '编辑待办 合成：归还两本书 2026-10-09' } }));
  assert.equal(checks.returnResult(remounted, opener).pass, false);
  assert.equal(checks.returnResult(remounted, opener, { afterSave: true }).pass, true);
  assert.equal(checks.returnResult(remounted.map(sample => ({ ...sample, active: { ...sample.active, recordId: 'todo-record-neighbor' } })), opener, { afterSave: true }).pass, false);
});

// These are synthetic event/DOM contracts, not native-browser delivery claims.
test('A real next focus is required and control-key delivery distinguishes send intent from trusted arrival', () => {
  const before = { active: { node: 4, tag: 'BUTTON', tabIndex: 0, disabled: false }, geometry: { visible: true } };
  const next = { active: { node: 5, tag: 'BUTTON', tabIndex: 0, disabled: false }, geometry: { visible: true }, stability: { observed: true } };
  const samples = [0, 50, 100, 150, 200, 250, 300, 350].map(elapsedMs => ({ ...next, elapsedMs }));
  assert.equal(checks.nextTabResult(before, next, samples).pass, true);
  for (const active of [before.active, { ...next.active, tabIndex: -1, tag: 'DIV' }, { ...next.active, disabled: true }]) assert.equal(checks.nextTabResult(before, { ...next, active }, samples.map(row => ({ ...row, active }))).pass, false);
  assert.equal(checks.nextTabResult(before, { ...next, stability: { observed: false } }, samples).pass, false);
  assert.equal(checks.nextTabResult(before, next, samples.slice(0, 2)).pass, false);
  const events = [{ type: 'keydown', key: 'Tab', node: 4, trusted: true, shift: false, repeat: false, ctrl: false, alt: false, meta: false, seq: 1, monotonicMs: 10 }, { type: 'keyup', key: 'Tab', node: 5, trusted: true, shift: false, repeat: false, ctrl: false, alt: false, meta: false, seq: 2, monotonicMs: 11 }];
  assert.equal(checks.keyDeliveryResult(before, 'Tab', events).pass, true);
  for (const invalid of [[], events.slice(0, 1), [...events, events[1]], events.map(row => ({ ...row, trusted: false })), [{ ...events[0], node: 9 }, events[1]], [{ ...events[0], key: 'Enter' }, events[1]]]) assert.equal(checks.keyDeliveryResult(before, 'Tab', invalid).pass, false);
  assert.equal(checks.keyDeliveryResult(before, 'Tab', events, { failures: 1 }).pass, false);
  assert.equal(checks.keyDeliveryResult(before, 'Tab', events, { dropped: 1 }).pass, false);
  assert.equal(checks.keyDeliveryResult(before, 'Shift+Tab', events).pass, false);
  assert.equal(checks.keyDeliveryResult(before, 'Shift+Tab', events.map(row => ({ ...row, shift: true }))).pass, true);
  type ObservedEvent = { key: string; target: { tagName: string }; type: string; isTrusted: boolean; shiftKey?: boolean; repeat?: boolean };
  const global = globalThis as unknown as { document: unknown; __ykReadNodes: { nodes: WeakMap<object, number> }; __ykControlEvents: { events: { node: number; key: string }[]; stopped: boolean; stop: () => void } }, previous = { document: global.document, nodes: global.__ykReadNodes, observer: global.__ykControlEvents };
  const listeners = new Map<string, (event: ObservedEvent) => void>(), target = { tagName: 'BUTTON' }, afterTarget = { tagName: 'INPUT' };
  try {
    global.document = { addEventListener: (name: string, listener: (event: ObservedEvent) => void) => listeners.set(name, listener), removeEventListener: (name: string) => listeners.delete(name) };
    Reflect.deleteProperty(global, '__ykReadNodes'); Reflect.deleteProperty(global, '__ykControlEvents');
    installKeyboardControlObserver();
    const keydown = listeners.get('keydown')!, keyup = listeners.get('keyup')!;
    keydown({ key: '合', target, type: 'keydown', isTrusted: true });
    assert.equal(global.__ykControlEvents.events.length, 0, 'No text or setup credential observation');
    keydown({ key: 'Tab', target, type: 'keydown', isTrusted: true, shiftKey: false, repeat: false });
    keyup({ key: 'Tab', target: afterTarget, type: 'keyup', isTrusted: true, shiftKey: false, repeat: false });
    assert.equal(global.__ykControlEvents.events.length, 2);
    assert.equal(global.__ykControlEvents.events[0].node, global.__ykReadNodes.nodes.get(target));
    assert.notEqual(global.__ykControlEvents.events[1].node, global.__ykControlEvents.events[0].node);
    let reads = 0; const changing = { target, type: 'keydown', isTrusted: false, get key() { return ++reads === 1 ? 'Tab' : 'unexpected text'; } };
    keydown(changing); assert.equal(reads, 1); assert.equal(global.__ykControlEvents.events.at(-1)?.key, 'Tab');
    global.__ykControlEvents.stop(); assert.equal(listeners.size, 0); assert.equal(global.__ykControlEvents.stopped, true);
  } finally {
    for (const [name, value] of Object.entries({ document: previous.document, __ykReadNodes: previous.nodes, __ykControlEvents: previous.observer })) { if (value === undefined) Reflect.deleteProperty(global, name); else Object.assign(global, { [name]: value }); }
  }
});
