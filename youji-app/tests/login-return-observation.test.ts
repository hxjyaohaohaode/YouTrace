import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { observeExistingLoginReturn } from '../scripts/audit-login-return.mjs';

const origin = 'http://127.0.0.1:4173';
const old = { origin, path: '/login', timeOrigin: 1000, shell: false, ready: false };
const arrived = { origin, path: '/onboarding', timeOrigin: 2000, shell: false, ready: true };
function fixture({ target = arrived, responses = true, navigation = true, replaced = false, late = false, status = 200, forever = false, earlyDocument = false } = {}) {
  let time = 0, reads = 0, clicks = 0;
  const frame = { url: () => origin + '/' };
  const page = Object.assign(new EventEmitter(), {
    mainFrame: () => frame,
    evaluate: async () => {
      if (++reads === 1) return old;
      if (replaced && reads === 2) throw new Error('Execution context was destroyed, most likely because of a navigation.');
      if (late) time = 15001;
      return forever ? old : target;
    },
  });
  const response = (path: string, method: string, isNavigation: boolean, code: number) => ({ url: () => origin + path, status: () => code, request: () => ({ method: () => method, isNavigationRequest: () => isNavigation, frame: () => frame }) });
  const click = async () => {
    clicks++;
    if (earlyDocument) { page.emit('response', response('/', 'GET', true, 200)); page.emit('framenavigated', frame); }
    if (responses) { page.emit('response', response('/api/auth/verify', 'POST', false, status)); if (!earlyDocument) page.emit('response', response('/', 'GET', true, 200)); }
    if (navigation && !earlyDocument) page.emit('framenavigated', frame);
  };
  return { page, click, options: { now: () => time, pause: async (ms: number) => { time += ms; } }, facts: () => ({ reads, clicks, time }) };
}

test('existing native click requires actual verification/document responses and current new-document outcome', async () => {
  for (const target of [arrived, { ...arrived, path: '/', shell: true }]) {
    const f = fixture({ target }); const receipt = await observeExistingLoginReturn(f.page, f.click, f.options);
    assert.equal(receipt.completed, true); assert.equal(receipt.timeoutMs, 15000); assert.equal(receipt.responses.length, 2);
    assert.equal(f.facts().clicks, 1); assert.equal(f.page.listenerCount('response'), 0); assert.equal(f.page.listenerCount('framenavigated'), 0);
  }
});
test('replaced execution context is re-observed in the same deadline without repeating verification', async () => {
  const f = fixture({ replaced: true }); const receipt = await observeExistingLoginReturn(f.page, f.click, f.options);
  assert.equal(receipt.completed, true); assert.equal(receipt.elapsedMs, 100); assert.equal(receipt.probes[0].transition, 'execution-context-replaced'); assert.equal(f.facts().clicks, 1);
});
test('same document, missing real responses/navigation or never-ready state cannot pass and retain the original 15s bound', async () => {
  for (const config of [{ target: { ...arrived, timeOrigin: old.timeOrigin } }, { target: { ...arrived, origin: 'http://other.invalid' } }, { responses: false }, { navigation: false }, { forever: true }, { earlyDocument: true }]) {
    const f = fixture(config);
    await assert.rejects(observeExistingLoginReturn(f.page, f.click, f.options), /within 15000ms/);
    assert.equal(f.facts().clicks, 1); assert.equal(f.facts().time, 15000); assert.equal(f.page.listenerCount('response'), 0); assert.equal(f.page.listenerCount('framenavigated'), 0);
  }
});
test('a ready observation after the deadline is rejected, and a real failed verification is not ignored', async () => {
  for (const config of [{ late: true }, { status: 400 }]) {
    const f = fixture(config);
    await assert.rejects(observeExistingLoginReturn(f.page, f.click, f.options), /deadline|HTTP200/);
    assert.equal(f.facts().clicks, 1); assert.equal(f.page.listenerCount('response'), 0);
  }
});
