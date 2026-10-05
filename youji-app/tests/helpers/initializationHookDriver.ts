import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as diagnostics from '../../src/services/initializationDiagnostics.ts';

export const tick = () => new Promise<void>(resolve => setImmediate(resolve));
export function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const hookSource = await readFile(new URL('../../src/hooks/useAppInit.ts', import.meta.url), 'utf8');
const actorSource = await readFile(new URL('../../src/services/localActor.ts', import.meta.url), 'utf8');

// Executes the actual hook and actor guard, with deterministic React/effect,
// timer and storage collaborators. It is not a React mount or native browser QA.
export function initializationHookDriver(offline = false) {
  const calls: string[] = [], state: unknown[] = [];
  const effects: Array<{ deps: unknown[]; cleanup?: () => void }> = [];
  const pendingEffects = new Map<number, { callback: () => (() => void) | undefined; deps: unknown[] }>();
  const timers = new Map<number, { delay: number; callback: () => void }>();
  const loaders = new Map<string, () => Promise<void>>(), events = new EventTarget();
  let stateIndex = 0, effectIndex = 0, timer = 0, rendering = false, renderAgain = false, enabled = false, mounted = true;
  let writesAfterUnmount = 0, scheduled = false, stateUpdates = 0;
  let lastResult = { ready: false, failed: false };
  const authority = { generation: 1, revision: 'synthetic-revision', owner: 'synthetic-owner', signedOut: false, storageThrows: false };
  const database = { ownerId: authority.owner, isOpen: () => true };
  const databaseModule = { db: database, getDatabaseRecoveryError: () => null, isDatabaseUpgradeBlocked: () => false };
  const load = (name: string) => { calls.push(name); return loaders.get(name)?.() ?? Promise.resolve(); };
  const imports: Record<string, unknown> = {
    react: {
      useState: (initial: unknown) => {
        const index = stateIndex++;
        if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
        return [state[index], (value: unknown) => {
          if (!mounted) writesAfterUnmount++;
          const next = typeof value === 'function' ? value(state[index]) : value;
          if (Object.is(next, state[index])) return;
          state[index] = next; stateUpdates++;
          if (!rendering) scheduled = true;
          if (rendering) renderAgain = true;
        }];
      },
      useEffect: (callback: () => (() => void) | undefined, deps: unknown[]) => {
        const index = effectIndex++, previous = effects[index];
        if (previous && deps.length === previous.deps.length && deps.every((dep, i) => Object.is(dep, previous.deps[i]))) return;
        pendingEffects.set(index, { callback, deps });
      },
    },
    dexie: { default: { currentTransaction: undefined } },
    '../services/initializationDiagnostics': diagnostics,
    '../services/diagnostics': { recordDiagnostic: () => undefined },
    '../services/syncEngine': { bootstrapSync: () => { calls.push('sync'); return Promise.resolve({ offline }); } },
    '../db': databaseModule,
    '../services/apiClient': { getSessionGeneration: () => authority.generation, getVerifiedSessionOwner: () => authority.owner, SESSION_REVISION_KEY: 'revision', SIGNED_OUT_KEY: 'signed-out' },
    '../stores/authStore': { useAuthStore: { getState: () => ({ authChecked: true, isAuthenticated: true, identityUnavailable: false }) } },
    '../stores/settingsStore': { useSettingsStore: { getState: () => ({ loadSettings: () => load('settings') }) } },
  };
  const localStorage = { getItem: (key: string) => {
    if (authority.storageThrows) throw new Error('synthetic storage failure');
    return key === 'revision' ? authority.revision : key === 'signed-out' && authority.signedOut ? 'true' : null;
  } };
  const evaluate = (source: string, extra: Record<string, unknown> = {}) => {
    const exports: Record<string, unknown> = {};
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 } }).outputText;
    runInNewContext(compiled, {
      exports, require: (key: string) => { const normalized = key === './apiClient' ? '../services/apiClient' : key; assert.ok(normalized in imports, key); return imports[normalized]; },
      window: events, localStorage,
      setTimeout: (callback: () => void, delay: number) => { const id = ++timer; timers.set(id, { callback, delay }); return id; },
      clearTimeout: (id: number) => { timers.delete(id); }, ...extra,
    });
    return exports;
  };
  imports['../services/localActor'] = evaluate(actorSource);
  for (const [module, name] of [['Expense', 'expense'], ['Todo', 'todo'], ['Habit', 'habit'], ['QuickNote', 'quick-note'], ['Schedule', 'schedule'], ['Diary', 'diary'], ['Coach', 'coach'], ['Goal', 'goal']]) {
    imports[`../stores/${module[0].toLowerCase()}${module.slice(1)}Store`] = { [`use${module}Store`]: { getState: () => ({ loadFromDB: () => load(name) }) } };
  }
  const exports = evaluate(hookSource) as { useAppInit: (enabled: boolean) => { ready: boolean; failed: boolean } };
  const render = (nextEnabled = enabled) => {
    enabled = nextEnabled; scheduled = false;
    let value!: { ready: boolean; failed: boolean }, renders = 0;
    do {
      assert.ok(++renders < 20, 'render-phase update must converge');
      stateIndex = 0; effectIndex = 0; renderAgain = false; rendering = true; pendingEffects.clear();
      value = exports.useAppInit(enabled);
      rendering = false;
    } while (renderAgain);
    // React runs all previous cleanups before the new passive effects.
    for (const index of pendingEffects.keys()) effects[index]?.cleanup?.();
    for (const [index, effect] of pendingEffects) effects[index] = { deps: effect.deps, cleanup: effect.callback() };
    pendingEffects.clear();
    lastResult = { ...value }; return { ...value };
  };
  return {
    calls, timers, loaders, events, authority, databaseModule, render,
    get lastResult() { return { ...lastResult }; },
    get stateUpdates() { return stateUpdates; },
    async flushScheduled() {
      for (let turn = 0; turn < 12; turn++) { await tick(); if (scheduled && mounted) render(); }
      return { ...lastResult };
    },
    fireDeadline() {
      const entry = [...timers.entries()].find(([, value]) => value.delay === 12_000);
      assert.ok(entry, 'original 12,000ms deadline exists'); timers.delete(entry[0]); entry[1].callback();
    },
    get writesAfterUnmount() { return writesAfterUnmount; },
    async settle() { await tick(); return render(); },
    timeout() {
      const entry = [...timers.entries()].find(([, value]) => value.delay === 12_000);
      assert.ok(entry, 'real 12-second deadline must exist'); timers.delete(entry[0]); entry[1].callback(); return render();
    },
    unmount() { for (const effect of effects) effect.cleanup?.(); mounted = false; },
  };
}
