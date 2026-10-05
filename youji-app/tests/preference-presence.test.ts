import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { preferenceWasLeft, preferenceReallyReturned, returnToPreferenceComparison, observePreferenceApplicationReads } from '../scripts/audit-preference-presence.mjs';

const event = (type: string, target = 'window', trusted = true) => ({ type, target, trusted, visibility: type === 'blur' ? 'hidden' : 'visible' });
const state = (events: ReturnType<typeof event>[] = []) => ({ timeOrigin: 1000, currentTimeOrigin: 1000, dropped: 0, events, path: '/settings', visibility: 'visible', focused: true, comparisonOpen: true });

test('focused final state cannot substitute for an observed leave followed by a trusted window return', () => {
  assert.equal(preferenceReallyReturned(state()), false);
  assert.equal(preferenceReallyReturned(state([event('focus'), event('blur')])), false);
  assert.equal(preferenceReallyReturned(state([event('blur'), event('focus', 'window', false)])), false);
  assert.equal(preferenceReallyReturned(state([event('blur'), event('focus', 'other')])), false);
  const returned = state([event('blur'), event('focus')]);
  assert.equal(preferenceReallyReturned(returned), true);
  for (const changed of [{ currentTimeOrigin: 1001 }, { path: '/' }, { comparisonOpen: false }, { focused: false }, { visibility: 'hidden' }, { dropped: 1 }]) {
    assert.equal(preferenceReallyReturned({ ...returned, ...changed }), false);
  }
  assert.equal(preferenceWasLeft(state([{ ...event('visibilitychange', 'document'), visibility: 'hidden' }])), true);
});

function fixture(mode = 'normal') {
  let time = 0, phase = 'installed', closed = 0, stopped = 0, blankActivations = 0, mainActivations = 0;
  const blank = {
    url: () => 'about:blank',
    createCDPSession: async () => ({ send: async () => ({ targetInfo: { targetId: 'observed-blank' } }), detach: async () => {} }),
    bringToFront: async () => { blankActivations++; phase = 'left'; },
    close: async () => { closed++; if (mode === 'close-error') throw Object.assign(new Error('close failed'), { name: 'private-unapproved-name' }); },
  };
  const page = {
    browserContext: () => ({ newPage: async () => blank }),
    bringToFront: async () => { mainActivations++; phase = 'returned'; },
    evaluate: async (operation: { name: string }) => {
      if (operation.name === 'stopPreferencePresence') { stopped++; return; }
      if (operation.name !== 'readPreferencePresence') return;
      time += mode === 'late' ? 5001 : 10;
      return state(mode === 'no-event' ? [] : phase === 'returned' ? [event('blur'), event('focus')] : [event('blur')]);
    },
  };
  return { page, options: { active: () => {}, now: () => time, pause: async (ms: number) => { time += ms; } }, counts: () => ({ closed, stopped, blankActivations, mainActivations }) };
}

test('a real tab switch is performed once and the temporary tab/listeners are cleaned up', async () => {
  const f = fixture();
  const result = await returnToPreferenceComparison(f.page, f.options);
  assert.equal(result.completed, true);
  assert.equal(result.returnObserved, true);
  assert.deepEqual(f.counts(), { closed: 1, stopped: 1, blankActivations: 1, mainActivations: 1 });
});

for (const mode of ['no-event', 'late', 'close-error']) test(`${mode} cannot become a completed return or repeat an action`, async () => {
  const f = fixture(mode);
  await assert.rejects(returnToPreferenceComparison(f.page, f.options), (error: Error & { preferenceReturnEvidence?: { completed: boolean; cleanupError?: string } }) => {
    assert.equal(error.preferenceReturnEvidence?.completed, false);
    if (mode === 'close-error') assert.equal(error.preferenceReturnEvidence?.cleanupError, 'unknown');
    return true;
  });
  assert.deepEqual(f.counts(), { closed: 1, stopped: 1, blankActivations: 1, mainActivations: mode === 'close-error' ? 1 : 0 });
});

test('read evidence only observes the scoped application GET and stops before later diagnostic requests', () => {
  const page = new EventEmitter(), origin = 'http://127.0.0.1:4100';
  let clock = 4;
  const reads = observePreferenceApplicationReads(page, origin, () => clock);
  const request = (url = `${origin}/api/user/settings`, method = 'GET') => ({ url: () => url, method: () => method });
  for (const ignored of [request(undefined, 'PATCH'), request(`${origin}/api/auth/me`), request('http://other/api/user/settings')]) page.emit('request', ignored);
  const actual = request(); page.emit('request', actual); clock = 9;
  page.emit('response', { request: () => actual, status: () => 200 });
  reads.stop(); page.emit('request', request());
  assert.deepEqual(reads.rows, [{ sequence: 1, startedAt: 4, respondedAt: 9, method: 'GET', path: '/api/user/settings', status: 200 }]);
  assert.equal(page.listenerCount('request'), 0); assert.equal(page.listenerCount('response'), 0);
});
