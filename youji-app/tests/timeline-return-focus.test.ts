import assert from 'node:assert/strict';
import { test } from 'node:test';
import { consumeTimelineReturnFocus, prepareTimelineReturnFocus, type TimelinePosition } from '../src/pages/timelineReturnFocus';

// DOM-shaped fixtures cover pending placement policy, not native key delivery,
// browser history, painted focus indicators or the independent hosted journey.
function surface() {
  const listeners = new Map<string, Set<EventListener>>();
  const document = {
    activeElement: null as unknown, body: {}, documentElement: {},
    addEventListener(type: string, listener: EventListener) { const group = listeners.get(type) ?? new Set(); group.add(listener); listeners.set(type, group); },
    removeEventListener(type: string, listener: EventListener) { listeners.get(type)?.delete(listener); },
  };
  function button({ connected = true, unavailable = false, visible = true } = {}) {
    const node = {
      isConnected: connected, calls: [] as unknown[], textContent: '同名记录',
      matches: () => unavailable, getClientRects: () => visible ? [{}] : [],
      focus(options: unknown) { node.calls.push(options); document.activeElement = node; },
    };
    return node;
  }
  const rows = new Map<string, ReturnType<typeof button>>();
  document.activeElement = document.body;
  return {
    document, rows, button,
    prepare: (id: string) => prepareTimelineReturnFocus(document as unknown as Document, rows as unknown as Map<string, HTMLButtonElement>, id),
    emit: (type: string, isTrusted = true) => { for (const listener of listeners.get(type) ?? []) listener({ isTrusted } as Event); },
    listenerCount: () => [...listeners.values()].reduce((count, group) => count + group.size, 0),
  };
}

test('A pending return finds the exact ID after rows render, without scrolling or repeating after Tab', () => {
  const s = surface(), pending = s.prepare('expense:chosen:2026-10-06');
  const sameName = s.button(), chosen = s.button();
  s.rows.set('expense:neighbor:2026-10-07', sameName);
  s.rows.set('expense:chosen:2026-10-06', chosen);
  pending.restore();
  assert.equal(s.document.activeElement, chosen);
  assert.deepEqual(chosen.calls, [{ preventScroll: true }]);
  assert.deepEqual(sameName.calls, []);
  assert.equal(s.listenerCount(), 0);
  s.document.activeElement = sameName; s.emit('keydown'); pending.restore();
  assert.equal(s.document.activeElement, sameName); assert.equal(chosen.calls.length, 1);
});

test('Input or focus movement while loading permanently cancels placement, including when focus later returns to body', () => {
  for (const type of ['keydown', 'pointerdown', 'wheel', 'touchstart', 'focusin']) {
    const s = surface(), pending = s.prepare('wanted');
    if (type === 'focusin') s.document.activeElement = s.button();
    s.emit(type); s.document.activeElement = s.document.body;
    const wanted = s.button(); s.rows.set('wanted', wanted); pending.restore();
    assert.equal(wanted.calls.length, 0, type); assert.equal(s.document.activeElement, s.document.body);
    assert.equal(s.listenerCount(), 0);
  }
  const s = surface(), pending = s.prepare('wanted'), wanted = s.button(), next = s.button();
  s.rows.set('wanted', wanted); s.document.activeElement = next; pending.restore();
  assert.equal(s.document.activeElement, next); assert.equal(wanted.calls.length, 0);
});

test('Filtered, deleted and unavailable IDs never choose a same-name neighbor or wait to steal focus later', () => {
  for (const unavailable of [null, { connected: false }, { unavailable: true }, { visible: false }]) {
    const s = surface(), pending = s.prepare('wanted'), neighbor = s.button();
    s.rows.set('same-name', neighbor);
    if (unavailable) s.rows.set('wanted', s.button(unavailable));
    pending.restore(); assert.equal(s.document.activeElement, s.document.body);
    assert.equal(neighbor.calls.length, 0); assert.equal(s.listenerCount(), 0);
    const late = s.button(); s.rows.set('wanted', late); pending.restore();
    assert.equal(late.calls.length, 0);
  }
});

test('An already focused control cancels preparation even if it detaches before records render', () => {
  const s = surface(), existing = s.button(); s.document.activeElement = existing;
  const pending = s.prepare('wanted'); assert.equal(s.listenerCount(), 0);
  existing.isConnected = false; s.document.activeElement = s.document.body;
  const wanted = s.button(); s.rows.set('wanted', wanted); pending.restore();
  assert.equal(wanted.calls.length, 0); assert.equal(s.document.activeElement, s.document.body);
});

test('Route cleanup cancels a queued return, while untrusted synthetic input alone cannot impersonate user intent', () => {
  const s = surface(), wanted = s.button(); s.rows.set('wanted', wanted);
  const cancelled = s.prepare('wanted'); cancelled.cancel(); cancelled.restore();
  assert.equal(wanted.calls.length, 0); assert.equal(s.listenerCount(), 0);
  const pending = s.prepare('wanted'); s.emit('keydown', false); pending.restore();
  assert.equal(s.document.activeElement, wanted); assert.equal(wanted.calls.length, 1);
});

test('A handled data frame consumes only its matching focus return, retaining scroll and any newer open', () => {
  const key = 'owner:/timeline?range=30';
  const saved = { top: 250, entryId: 'expense:chosen:2026-10-06', locationKey: 'original-entry' };
  const positions = new Map<string, TimelinePosition>([[key, saved]]);
  consumeTimelineReturnFocus(positions, key, saved);
  assert.deepEqual(positions.get(key), { top: 250 });
  consumeTimelineReturnFocus(positions, key, saved);
  assert.deepEqual(positions.get(key), { top: 250 }, 'Repeated handling cannot leave focus fields for a later POP');
  const newer = { top: 400, entryId: 'expense:new-open:2026-10-07', locationKey: 'new-entry' };
  positions.set(key, newer);
  consumeTimelineReturnFocus(positions, key, saved);
  assert.equal(positions.get(key), newer, 'An old frame must not overwrite a newer open');
  consumeTimelineReturnFocus(positions, key, newer);
  assert.deepEqual(positions.get(key), { top: 400 });
});
