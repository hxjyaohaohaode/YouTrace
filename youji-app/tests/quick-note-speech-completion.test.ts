import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import ts from 'typescript';

// Actual QuickNote and its returned callbacks, with deterministic substitutes for
// React scheduling, router, presentation, parser, SpeechRecognition and ALL
// persistence/identity boundaries. No DOM, native ASR, microphone, DB or network.
// The source override lets the same external-event witness run on a frozen prior
// source; it never replaces or rewrites the business handlers under test.
const sourcePath = process.env.YOUTRACE_SPEECH_SOURCE ?? new URL('../src/pages/QuickNote.tsx', import.meta.url);
const source = await readFile(sourcePath, 'utf8');
const sourceSHA256 = createHash('sha256').update(source).digest('hex');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, jsx: ts.JsxEmit.ReactJSX }, reportDiagnostics: true });
assert.equal(compiled.diagnostics?.length ?? 0, 0);
const A = '合成既有原文A：明天交报销单。';
const B = '合成语音尾句B：午饭15元。';
const C = '合成新输入C：先核对昨天的记录。';
const basis = { capturedAt: 1791360000000, timeZone: 'Etc/UTC', date: '2026-10-07' };
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
type Props = Record<string, unknown>;
type Element = React.ReactElement<Props>;
type Context = typeof basis;
type Input = { key: string; text: string; context: Context };
type Draft = { id: string; input: string; inputKey: string; context: Context };
type Result = { resultIndex: number; results: Array<{ isFinal: boolean; 0: { transcript: string } }> };
type Effect = { deps?: unknown[]; cleanup?: () => void };

function componentDriver() {
  const trace: Array<{ seq: number; kind: string; data: unknown }> = [];
  const record = (kind: string, data: unknown = null) => trace.push({ seq: trace.length + 1, kind, data: structuredClone(data) });
  const slots: unknown[] = [], effects = new Map<number, Effect>(), commits: Array<() => void> = [];
  const writes: Array<{ input: Input; text: string; context: Context }> = [];
  const creates: Array<{ text: string; input: Input; context: Context }> = [];
  const saves: Array<{ draft: Draft; makeCurrent: boolean }> = [], navigations: unknown[][] = [];
  const timers = new Map<number, { at: number; callback: () => void }>();
  const recognizers: SpeechDouble[] = [];
  let index = 0, mounted = true, tree: React.ReactNode, timerId = 0, now = 0;
  let nextSave: (ReturnType<typeof deferred> & { called: boolean }) | null = null;
  let nextDraftSave: (ReturnType<typeof deferred> & { called: boolean }) | null = null;
  let failNextStart = false, failNextStop = false;
  const hooks = {
    ...React,
    useState(initial: unknown) {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial;
      return [slots[slot], (next: unknown) => { if (mounted) slots[slot] = typeof next === 'function' ? next(slots[slot]) : next; }];
    },
    useRef(initial: unknown) { const slot = index++; return slots[slot] ?? (slots[slot] = { current: initial }); },
    useMemo(create: () => unknown, deps: unknown[]) {
      const slot = index++, previous = slots[slot] as { deps: unknown[]; value: unknown } | undefined;
      if (!previous || deps.some((dep, position) => !Object.is(dep, previous.deps[position]))) slots[slot] = { deps: [...deps], value: create() };
      return (slots[slot] as { value: unknown }).value;
    },
    useEffect(create: () => (() => void) | undefined, deps?: unknown[]) {
      const slot = index++, previous = effects.get(slot);
      if (!previous || !deps || deps.some((dep, position) => !Object.is(dep, previous.deps?.[position]))) commits.push(() => {
        previous?.cleanup?.(); effects.set(slot, { deps: deps ? [...deps] : undefined, cleanup: create() });
      });
    },
  };
  class SpeechDouble {
    id = recognizers.length + 1;
    starts = 0; stops = 0;
    lang = ''; continuous = false; interimResults = false;
    onresult: ((event: Result) => void) | null = null;
    onerror: ((event: { error: string }) => void) | null = null;
    onend: (() => void) | null = null;
    constructor() { recognizers.push(this); record('speech.construct', { id: this.id }); }
    start() {
      this.starts++; record('speech.start', { id: this.id });
      if (failNextStart) { failNextStart = false; throw new Error('Synthetic start failure'); }
    }
    stop() {
      this.stops++; record('speech.stop', { id: this.id });
      if (failNextStop) { failNextStop = false; throw new Error('Synthetic stop failure'); }
    }
    final(text = B) { record('speech.final', { id: this.id, text }); this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text } }] }); }
    interim(text = B) { record('speech.interim', { id: this.id, text }); this.onresult?.({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript: text } }] }); }
    error() { record('speech.error', { id: this.id }); this.onerror?.({ error: 'no-speech' }); }
    end() { record('speech.end', { id: this.id }); this.onend?.(); }
    retained() {
      const { onresult, onerror, onend } = this;
      assert.ok(onresult && onerror && onend);
      return {
        final(text = B) { record('retained-old-callback.final', { text }); onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text } }] }); },
        error() { record('retained-old-callback.error'); onerror({ error: 'no-speech' }); },
        end() { record('retained-old-callback.end'); onend(); },
      };
    }
  }
  const modules = {
    react: hooks, 'react/jsx-runtime': jsx,
    'react-router-dom': { useLocation: () => ({ key: 'synthetic-route', state: null }), useNavigate: () => (...args: unknown[]) => { navigations.push(args); record('router.navigate', args); } },
    'framer-motion': { motion: new Proxy({}, { get: (_target, key) => String(key) }), useReducedMotion: () => true },
    'lucide-react': { ArrowLeft: 'svg', Mic: 'svg', Square: 'svg', Keyboard: 'svg', Copy: 'svg' },
    '../components/ui/Button': { Button: 'button' },
    '../services/quickNoteIntegration': {
      captureSessionKey: () => 'synthetic-review-key',
      async forkCaptureInput() { const input = { key: 'capture-input:synthetic', text: A, context: structuredClone(basis) }; record('persistence-double.fork', input); return input; },
      async saveCaptureInput(input: Input, text: string, context: Context) {
        const args = { input: structuredClone(input), text, context: structuredClone(context) };
        writes.push(args); record('persistence-double.saveInput.call', args);
        const gate = nextSave; nextSave = null;
        if (gate) { gate.called = true; record('persistence-double.saveInput.held'); await gate.promise; }
        record('persistence-double.saveInput.resolve', { text });
      },
      async createCaptureDraft(text: string, input: Input, context: Context) {
        const args = { text, input: structuredClone(input), context: structuredClone(context) };
        creates.push(args); record('persistence-double.createDraft', args);
        return { id: `synthetic-draft-${creates.length}`, input: text, inputKey: input.key, context: structuredClone(context) };
      },
      async saveCaptureDraft(draft: Draft, makeCurrent: boolean) {
        saves.push({ draft, makeCurrent }); record('persistence-double.saveDraft', { draft, makeCurrent });
        const gate = nextDraftSave; nextDraftSave = null;
        if (gate) { gate.called = true; await gate.promise; }
        return draft.id;
      },
      async loadCaptureDraft() { throw new Error('Previous-review branch is outside this speech witness'); },
      async loadCaptureReceipt() { throw new Error('Receipt branch is outside this speech witness'); },
    },
    '../services/capturePresentation': { sameCaptureInput: () => { throw new Error('Previous-review comparison is outside this speech witness'); } },
    '../services/parser': { newCaptureContext: () => structuredClone(basis), parseQuickNote: () => ({ expenses: [], todos: [], habits: [] }) },
    '../db': { db: { ownerId: 'synthetic-owner' } },
    '../services/diagnostics': { recordDiagnostic: (...args: unknown[]) => record('diagnostic-double', args) },
  };
  const exports: { default?: () => React.ReactNode } = {};
  runInNewContext(compiled.outputText, {
    exports, require: (name: string) => { assert.ok(Object.hasOwn(modules, name), `Unapproved module: ${name}`); return modules[name as keyof typeof modules]; },
    window: Object.assign(new EventTarget(), { SpeechRecognition: SpeechDouble }),
    sessionStorage: { setItem: (key: string, value: string) => record('session-storage-double', { key, value }) },
    navigator: { clipboard: { writeText: async () => undefined } },
    setTimeout: (callback: () => void, delay: number) => { const id = ++timerId; timers.set(id, { at: now + delay, callback }); record('clock-double.setTimeout', { id, delay }); return id; },
    clearTimeout: (id: number) => { timers.delete(id); record('clock-double.clearTimeout', { id }); },
  });
  const render = () => { assert.ok(mounted); index = 0; tree = exports.default!(); for (const commit of commits.splice(0)) commit(); };
  const elements = () => {
    const nodes: Element[] = [];
    function visit(node: React.ReactNode) { if (Array.isArray(node)) node.forEach(visit); else if (React.isValidElement<Props>(node)) { nodes.push(node); visit(node.props.children as React.ReactNode); } }
    visit(tree); return nodes;
  };
  const text = (node: React.ReactNode): string => Array.isArray(node) ? node.map(text).join('') : React.isValidElement<Props>(node) ? text(node.props.children as React.ReactNode) : typeof node === 'string' ? node : '';
  const one = (predicate: (node: Element) => boolean) => { const found = elements().filter(predicate); assert.equal(found.length, 1); return found[0]; };
  const button = (label: string) => one(node => node.type === 'button' && (node.props['aria-label'] === label || text(node) === label));
  const area = () => one(node => node.type === 'textarea');
  const ui = {
    render, trace, writes, creates, saves, navigations, recognizers, timers, record, button,
    async ready() { await tick(); render(); assert.equal(this.value(), A); },
    async settle() { await tick(); if (mounted) render(); },
    value: () => area().props.value,
    alerts: () => elements().filter(node => node.props.role === 'alert').map(text).join('\n'),
    statuses: () => elements().filter(node => node.props.role === 'status').map(text).join('\n'),
    callback(label: string) { const node = button(label); assert.notEqual(node.props.disabled, true); return node.props.onClick as () => void; },
    click(label: string) { const callback = this.callback(label); record('ui.actualClick', { label }); callback(); render(); },
    change(value: string) { assert.notEqual(area().props.disabled, true); record('ui.actualChange', { value }); (area().props.onChange as (event: unknown) => void)({ target: { value } }); render(); },
    start() { this.click('语音输入'); this.click('开始语音输入'); return recognizers.at(-1)!; },
    holdNextSave() { assert.equal(nextSave, null); const gate = { ...deferred(), called: false }; nextSave = gate; return gate; },
    holdNextDraftSave() { assert.equal(nextDraftSave, null); const gate = { ...deferred(), called: false }; nextDraftSave = gate; return gate; },
    advance(milliseconds: number) {
      now += milliseconds;
      for (const [id, timer] of [...timers].sort((left, right) => left[1].at - right[1].at)) if (timer.at <= now && timers.delete(id)) timer.callback();
      if (mounted) render();
    },
    failStart() { failNextStart = true; },
    failStop() { failNextStop = true; },
    cleanup() { assert.ok(mounted); record('react-double.cleanup'); mounted = false; for (const effect of effects.values()) effect.cleanup?.(); },
  };
  render(); return ui;
}

test('actual view callback retains a same-session final after stop before creating its draft', async () => {
  const ui = componentDriver(); await ui.ready(); const speech = ui.start(), gate = ui.holdNextSave();
  ui.click('查看确认稿'); assert.equal(speech.stops, 1, 'observe the actual stop, not an internal save phase');
  await tick(); // Speech result belongs to a subsequent task, never synchronous stop().
  speech.final(); speech.end(); await ui.settle();
  assert.equal(gate.called, true); gate.resolve(); await ui.settle();
  if (process.env.YOUTRACE_SPEECH_TRACE) await writeFile(process.env.YOUTRACE_SPEECH_TRACE, JSON.stringify({ evidence: 'synthetic actual component callbacks; not native ASR or real persistence', source: String(sourcePath), sourceSHA256, actualText: ui.value(), creates: ui.creates, saves: ui.saves, navigations: ui.navigations, trace: ui.trace }, null, 2) + '\n');
  assert.equal(ui.creates.length, 1); assert.equal(ui.saves.length, 1); assert.equal(ui.navigations.length, 1);
  assert.equal(ui.creates[0].text, A + B); assert.equal(ui.value(), A + B);
  assert.deepEqual(ui.creates[0].context, basis);
  assert.equal(ui.timers.size, 0);
  ui.cleanup(); assert.equal(speech.stops, 1, 'completed session is not stopped again by cleanup');
});

test('final arriving before view and natural end both preserve the exact text', async () => {
  const ui = componentDriver(); await ui.ready(); const speech = ui.start();
  speech.final(); speech.end(); await ui.settle(); ui.click('查看确认稿'); await ui.settle();
  assert.equal(ui.creates[0].text, A + B); assert.equal(speech.stops, 0); ui.cleanup(); assert.equal(speech.stops, 0);
});

test('standalone stop has a visible bounded finishing state and accepts its final once', async () => {
  const ui = componentDriver(); await ui.ready(); const speech = ui.start(), toggle = ui.callback('停止录音');
  ui.click('停止录音');
  assert.match(ui.statuses(), /最后结果/); assert.equal(ui.button('正在接收语音尾句…').props.disabled, true);
  toggle(); toggle(); assert.equal(speech.stops, 1); assert.equal(ui.recognizers.length, 1);
  speech.final(); speech.end(); await ui.settle(); ui.click('查看确认稿'); await ui.settle();
  assert.equal(ui.creates[0].text, A + B); assert.equal(ui.timers.size, 0);
});

test('view joins a stop already in progress and waits for its final', async () => {
  const ui = componentDriver(); await ui.ready(); const speech = ui.start();
  ui.click('停止录音'); ui.click('查看确认稿'); await ui.settle();
  assert.equal(ui.creates.length, 0); assert.equal(speech.stops, 1);
  speech.final(); speech.end(); await ui.settle(); assert.equal(ui.creates[0].text, A + B);
});

test('end without final retains A without fabricating text', async () => {
  const ui = componentDriver(); await ui.ready(); const speech = ui.start();
  ui.click('查看确认稿'); speech.end(); await ui.settle();
  assert.equal(ui.creates[0].text, A); assert.equal(ui.value(), A); assert.equal(ui.timers.size, 0);
});

test('error and end without final preserve A and require another deliberate view action', async () => {
  const ui = componentDriver(); await ui.ready(); const speech = ui.start(), old = speech.retained();
  ui.click('查看确认稿'); speech.error(); old.end(); await ui.settle();
  assert.equal(ui.creates.length, 0); assert.equal(ui.value(), A); assert.match(ui.alerts(), /核对.*再点/);
  ui.click('查看确认稿'); await ui.settle(); assert.equal(ui.creates[0].text, A);
});

test('speech error stops automatic creation, preserves displayed text, and allows deliberate retry', async () => {
  const ui = componentDriver(); await ui.ready(); const speech = ui.start(), old = speech.retained();
  ui.click('查看确认稿'); speech.final(); speech.error(); old.end(); await ui.settle();
  assert.equal(ui.creates.length, 0); assert.equal(ui.value(), A + B); assert.equal(ui.timers.size, 0);
  assert.match(ui.alerts(), /核对.*再点/); assert.equal(ui.button('查看确认稿').props.disabled, false);
  old.final(C); await ui.settle(); assert.equal(ui.value(), A + B);
  ui.click('查看确认稿'); await ui.settle(); assert.equal(ui.creates[0].text, A + B);
});

test('no end times out without automatic creation and rejects later old callbacks', async () => {
  const ui = componentDriver(); await ui.ready(); const speech = ui.start(), old = speech.retained();
  ui.click('查看确认稿'); speech.final(); ui.advance(1999); await ui.settle(); assert.equal(ui.creates.length, 0);
  ui.advance(1); await ui.settle(); assert.equal(ui.creates.length, 0); assert.equal(ui.value(), A + B);
  assert.match(ui.alerts(), /超时.*核对/); assert.equal(ui.timers.size, 0);
  old.final(C); old.end(); old.error(); await ui.settle(); assert.equal(ui.value(), A + B); assert.equal(ui.creates.length, 0);
  ui.click('查看确认稿'); await ui.settle(); assert.equal(ui.creates[0].text, A + B);
});

test('duplicate view callbacks and retained mode/record controls cannot insert another session', async () => {
  const ui = componentDriver(); await ui.ready(); const speech = ui.start();
  const view = ui.callback('查看确认稿'), record = ui.callback('停止录音'), textMode = ui.callback('文本输入'), voiceMode = ui.callback('语音输入');
  view(); view(); record(); textMode(); voiceMode(); ui.render(); await ui.settle();
  assert.equal(ui.recognizers.length, 1); assert.equal(speech.stops, 1); assert.equal(ui.creates.length, 0);
  assert.equal(ui.button('文本输入').props.disabled, true); assert.equal(ui.button('语音输入').props.disabled, true);
  speech.final(); speech.end(); await ui.settle();
  assert.equal(ui.creates.length, 1); assert.equal(ui.navigations.length, 1); assert.equal(ui.creates[0].text, A + B);
});

test('manual new input cancels a finishing session and old callbacks cannot alter it', async () => {
  const ui = componentDriver(); await ui.ready(); const speech = ui.start(), old = speech.retained();
  ui.click('停止录音'); ui.change(C); const writes = ui.writes.length;
  old.final(); old.error(); old.end(); await ui.settle();
  assert.equal(ui.value(), C); assert.equal(ui.writes.length, writes + 1, 'only the queued manual C save is added');
  assert.equal(ui.writes.at(-1)?.text, C); assert.equal(ui.timers.size, 0); assert.match(ui.alerts(), /手动编辑/);
  ui.click('查看确认稿'); await ui.settle(); assert.equal(ui.creates[0].text, C);
});

test('text mode cancellation is explicit and a new recording has its own callback identity', async () => {
  const ui = componentDriver(); await ui.ready(); const first = ui.start(), old = first.retained();
  ui.click('停止录音'); ui.click('文本输入'); assert.match(ui.alerts(), /未返回的尾句不会继续加入/);
  ui.change(C); const second = ui.start(); assert.notEqual(second, first); assert.equal(ui.recognizers.length, 2);
  old.final(); old.error(); old.end(); await ui.settle();
  assert.equal(ui.value(), C); assert.equal(ui.button('停止录音').props['aria-pressed'], true);
  second.final(); second.end(); await ui.settle(); ui.click('查看确认稿'); await ui.settle(); assert.equal(ui.creates[0].text, C + B);
});

test('back and cleanup invalidate retained callbacks before any late write request', async () => {
  const ui = componentDriver(); await ui.ready(); const speech = ui.start(), old = speech.retained();
  ui.click('返回'); await ui.settle(); ui.cleanup(); const writes = ui.writes.length;
  old.final(); old.error(); old.end(); await tick();
  assert.equal(ui.writes.length, writes); assert.equal(ui.creates.length, 0); assert.equal(ui.navigations.length, 1); assert.equal(speech.stops, 1);
});

test('cleanup while submit awaits end abandons creation and clears the deadline', async () => {
  const ui = componentDriver(); await ui.ready(); const speech = ui.start(), old = speech.retained();
  ui.click('查看确认稿'); ui.cleanup(); const writes = ui.writes.length;
  old.final(); old.end(); ui.advance(2000); await tick();
  assert.equal(ui.writes.length, writes); assert.equal(ui.creates.length, 0); assert.equal(ui.navigations.length, 0); assert.equal(ui.timers.size, 0); assert.equal(speech.stops, 1);
});

test('cleanup during a pending original-text save prevents later draft creation or navigation', async () => {
  const ui = componentDriver(); await ui.ready(); const speech = ui.start();
  speech.final(); speech.end(); await ui.settle(); const gate = ui.holdNextSave();
  ui.click('查看确认稿'); await ui.settle(); assert.equal(gate.called, true);
  ui.cleanup(); gate.resolve(); await tick();
  assert.equal(ui.creates.length, 0); assert.equal(ui.navigations.length, 0); assert.equal(speech.stops, 0);
});

test('cleanup during draft persistence preserves that request but prevents late navigation', async () => {
  const ui = componentDriver(); await ui.ready(); const gate = ui.holdNextDraftSave();
  ui.click('查看确认稿'); await ui.settle(); assert.equal(gate.called, true); assert.equal(ui.creates.length, 1);
  ui.cleanup(); gate.resolve(); await tick();
  assert.equal(ui.saves.length, 1); assert.equal(ui.navigations.length, 0);
});

test('start and stop exceptions leave readable recovery paths without a stuck speech session', async () => {
  const ui = componentDriver(); await ui.ready(); ui.failStart(); const failed = ui.start();
  assert.match(ui.alerts(), /无法启动/); assert.equal(ui.button('开始语音输入').props.disabled, false);
  ui.click('开始语音输入'); const speech = ui.recognizers.at(-1)!; assert.notEqual(speech, failed);
  ui.failStop(); ui.click('查看确认稿'); await ui.settle();
  assert.equal(ui.creates.length, 0); assert.match(ui.alerts(), /未能正常收尾/); assert.equal(ui.value(), A); assert.equal(ui.timers.size, 0);
  ui.click('查看确认稿'); await ui.settle(); assert.equal(ui.creates[0].text, A);
});

test('interim recognition never becomes final text by implication', async () => {
  const ui = componentDriver(); await ui.ready(); const speech = ui.start(); speech.interim(); ui.render();
  assert.equal(ui.value(), A); ui.click('查看确认稿'); speech.end(); await ui.settle(); assert.equal(ui.creates[0].text, A);
});
