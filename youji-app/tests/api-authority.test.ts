import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => m.set(k, v), removeItem: (k: string) => m.delete(k), clear: () => m.clear() }; };
Object.assign(globalThis, { localStorage: memory(), window: new EventTarget() });
const session = await import('../src/services/apiClient.ts');
let unauthorized = 0;
window.addEventListener(session.UNAUTHORIZED_EVENT, () => { unauthorized++; });
beforeEach(() => { session.clearSession(); localStorage.clear(); session.setSessionActive('synthetic-request-a'); unauthorized = 0; });
for (const status of [401, 409]) for (const mode of ['request', 'streamChat'] as const) {
  const response = () => Response.json({ error: 'Synthetic expired authority' }, { status, headers: status === 409 ? { 'X-YouTrace-Account-Mismatch': 'true' } : {} });
  for (const change of ['owner', 'same-owner-reauth', 'revision'] as const) test(`${mode} late ${status} cannot revoke ${change}`, async () => {
    let release!: (response: Response) => void;
    // Controlled response delivery ignores native fetch abort intentionally;
    // this is a module-side-effect contract, not a live-network race claim.
    globalThis.fetch = async () => new Promise<Response>(resolve => { release = resolve; });
    const pending = mode === 'request' ? session.api.get('/sync/capabilities') : session.streamChat('Synthetic request');
    if (change === 'revision') localStorage.setItem(session.SESSION_REVISION_KEY, 'synthetic-new-revision');
    else { session.clearSession(); session.setSessionActive(change === 'owner' ? 'synthetic-request-b' : 'synthetic-request-a'); }
    const generation = session.getSessionGeneration(), owner = session.getVerifiedSessionOwner(); release(response());
    await assert.rejects(pending, /登录已过期/); assert.equal(session.getSessionGeneration(), generation); assert.equal(session.getVerifiedSessionOwner(), owner); assert.equal(unauthorized, 0);
  });
  test(`${mode} current ${status} still revokes the rejected session`, async () => {
    globalThis.fetch = async () => response();
    const pending = mode === 'request' ? session.api.get('/sync/capabilities') : session.streamChat('Synthetic request');
    await assert.rejects(pending, /登录已过期/); assert.equal(session.getVerifiedSessionOwner(), null); assert.equal(unauthorized, 1);
  });
}
