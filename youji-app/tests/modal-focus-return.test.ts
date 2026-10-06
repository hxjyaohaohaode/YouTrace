import assert from 'node:assert/strict';
import { test } from 'node:test';
import { restoreModalFocus } from '../src/components/ui/modalFocus';

// DOM-shaped unit fixtures. The actual control, animation and native key flow
// are independently checked by the hosted keyboard journey.
function surface() {
  const document = { activeElement: null as unknown, body: null as unknown, documentElement: null as unknown };
  function element({ connected = true, disabled = false, visible = true } = {}) {
    const node = {
      ownerDocument: document, isConnected: connected, calls: 0,
      matches: () => disabled, getClientRects: () => visible ? [{}] : [],
      contains: (other: unknown) => other === node,
      focus() { node.calls++; document.activeElement = node; },
    };
    return node;
  }
  const body = element(), html = element(), opener = element(), field = element(), panel = element();
  document.body = body; document.documentElement = html; document.activeElement = field;
  panel.contains = (other: unknown) => other === field;
  const restore = (previous = opener, fallback?: () => ReturnType<typeof element> | null) => restoreModalFocus(panel as unknown as HTMLElement, previous as unknown as HTMLElement, fallback as (() => HTMLElement | null) | undefined);
  return { document, element, body, html, opener, field, panel, restore };
}

test('Closing returns the existing opener while a subsequent user focus is never taken back', () => {
  const s = surface(); s.restore(); assert.equal(s.document.activeElement, s.opener); assert.equal(s.opener.calls, 1);
  const next = s.element(); s.document.activeElement = next;
  let fallbackCalls = 0; s.restore(s.opener, () => { fallbackCalls++; return s.opener; });
  assert.equal(s.document.activeElement, next); assert.equal(s.opener.calls, 1); assert.equal(fallbackCalls, 0);
  s.document.activeElement = s.opener; s.restore(); assert.equal(s.opener.calls, 1, 'Already returned focus is left alone');
});

test('A moved record uses its new edit button only when prior focus is gone; missing or unavailable targets are left alone', () => {
  const s = surface(), detached = s.element({ connected: false }), replacement = s.element();
  s.document.activeElement = s.body; s.restore(detached, () => replacement);
  assert.equal(s.document.activeElement, replacement); assert.equal(detached.calls, 0);
  for (const unavailable of [s.element({ disabled: true }), s.element({ visible: false }), s.element({ connected: false }), s.body, null]) {
    s.document.activeElement = s.body; s.restore(detached, () => unavailable);
    assert.equal(s.document.activeElement, s.body);
  }
  const original = s.element(); s.document.activeElement = s.field; s.restore(original, () => replacement);
  assert.equal(s.document.activeElement, original); assert.equal(replacement.calls, 1);
});
