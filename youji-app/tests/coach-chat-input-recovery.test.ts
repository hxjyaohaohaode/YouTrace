import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import type { CoachMessage } from '../src/stores/coachStore';

const values = new Map<string, string>();
const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
Object.assign(globalThis, { React, localStorage: storage, sessionStorage: storage, window: Object.assign(new EventTarget(), { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) }), document: { documentElement: { setAttribute() {} } } });
const { useCoachStore } = await import('../src/stores/coachStore.ts');
const { setSessionActive, clearSession } = await import('../src/services/apiClient.ts');
const { getToastSnapshot, toast } = await import('../src/services/toastBus.ts');
const { db } = await import('../src/db/index.ts');
const { pauseSync } = await import('../src/services/syncEngine.ts');
const { MessageList } = await import('../src/components/coach/MessageList.tsx');
const realFetch = globalThis.fetch;
const A = '帮我看看这周的花销，按已记录的支出回答';
const B = '先保留这段新输入，我还想核对昨天的花销';
const A2 = '帮我看看近7天的花销，只统计已记录支出';
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const encoder = new TextEncoder();
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function until(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100 && !predicate(); attempt++) await tick();
  assert.ok(predicate(), 'Synthetic stream did not reach the expected state');
}
function answer() {
  return new Response('data: {"content":"本次合成完整答复"}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'X-Session-Id': 'synthetic-edited-session' } });
}
beforeEach(() => { useCoachStore.getState().clearHistory(); setSessionActive('synthetic-chat-recovery'); });
afterEach(() => { useCoachStore.getState().clearHistory(); clearSession(); globalThis.fetch = realFetch; });
after(() => { pauseSync(); db.close(); });

test('a rejected request marks its captured user ID, never a matching text or a later user, and retains old messages', async () => {
  const old: CoachMessage[] = [{ id: 'old-user', role: 'user', content: A, timestamp: 1 }, { id: 'old-ai', role: 'assistant', content: '抱歉，网络似乎不太稳定，请稍后重试。', timestamp: 2 }];
  useCoachStore.setState({ messages: old });
  const response = deferred<Response>(), toasts = getToastSnapshot();
  let calls = 0;
  globalThis.fetch = async () => { calls++; return response.promise; };
  const pending = useCoachStore.getState().sendMessage(A);
  const submitted = useCoachStore.getState().messages[2];
  await useCoachStore.getState().sendMessage('same-frame duplicate');
  assert.equal(calls, 1);
  useCoachStore.getState().addMessage({ role: 'user', content: 'A later local message' });
  const later = useCoachStore.getState().messages.at(-1);
  response.reject(new TypeError('Synthetic pre-response failure'));
  await pending;
  const messages = useCoachStore.getState().messages;
  assert.deepEqual(messages.slice(0, 2), old);
  assert.deepEqual(messages[2], { ...submitted, replyFailed: true });
  assert.equal(messages[3].content, '抱歉，网络似乎不太稳定，请稍后重试。');
  assert.deepEqual(messages[4], later);
  assert.deepEqual(messages.filter(message => message.replyFailed).map(message => message.id), [submitted.id]);
  assert.equal(useCoachStore.getState().sessionId, null);
  assert.equal(useCoachStore.getState().isTyping, false);
  assert.deepEqual(getToastSnapshot(), toasts, 'persistent message feedback replaces the empty-reply error toast');
});

test('a broken response retains partial content and actions; a later complete send preserves that failed prefix', async () => {
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  toast.info('另一条合成既有提示');
  const toasts = getToastSnapshot();
  globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) { stream = controller; } }), { headers: { 'X-Session-Id': 'synthetic-partial-session' } });
  const pending = useCoachStore.getState().sendMessage(A);
  stream.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '已经收到的一段正文\n第二行' })}\n\n`));
  stream.enqueue(encoder.encode('data: {"actions":[{"type":"navigate","label":"查看花销","path":"/expenses"}]}\n\n'));
  await until(() => Boolean(useCoachStore.getState().messages[1].actions?.length));
  const partial = structuredClone(useCoachStore.getState().messages[1]);
  assert.equal(partial.content, '已经收到的一段正文\n第二行');
  stream.error(new TypeError('Synthetic stream failure'));
  await pending;
  assert.deepEqual(useCoachStore.getState().messages[1], partial);
  assert.equal(useCoachStore.getState().messages[0].replyFailed, true);
  const afterFailure = getToastSnapshot();
  assert.equal(afterFailure.length, toasts.length + 1);
  assert.deepEqual(afterFailure.slice(0, -1), toasts);
  assert.equal(afterFailure.at(-1)?.type, 'warning');
  assert.equal(afterFailure.at(-1)?.message, '回复生成中断，内容可能不完整');
  const failedPrefix = structuredClone(useCoachStore.getState().messages);
  globalThis.fetch = async () => answer();
  await useCoachStore.getState().sendMessage(A2);
  const messages = useCoachStore.getState().messages;
  assert.deepEqual(messages.slice(0, 2), failedPrefix);
  assert.equal(messages[2].content, A2);
  assert.equal(messages[2].replyFailed, undefined);
  assert.equal(messages[3].content, '本次合成完整答复');
  assert.equal(useCoachStore.getState().sessionId, 'synthetic-edited-session');
});

// Execute the actual Coach, ChatInput and MessageList functions and their event
// callbacks against the real store/API. React scheduling, router and presentation
// collaborators are deterministic substitutes; this is not DOM/browser evidence.
type Props = Record<string, unknown>;
type Element = React.ReactElement<Props>;
const componentSources = await Promise.all(['../src/pages/Coach.tsx', '../src/components/coach/ChatInput.tsx', '../src/components/coach/MessageList.tsx'].map(path => readFile(new URL(path, import.meta.url), 'utf8')));
function componentDriver(initialText = '') {
  const frames = new Map<string, unknown[]>(), layouts: Array<() => void> = [];
  let frame: unknown[] = [], index = 0, prefill = initialText;
  const hooks = {
    ...React,
    useState(initial: unknown) {
      const slots = frame, slot = index++;
      if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial;
      return [slots[slot], (next: unknown) => { slots[slot] = typeof next === 'function' ? next(slots[slot]) : next; }];
    },
    useRef(initial: unknown) { const slot = index++; return frame[slot] ?? (frame[slot] = { current: initial }); },
    useCallback(callback: unknown) { return callback; },
    useEffect() {},
    useSyncExternalStore(_subscribe: unknown, snapshot: () => unknown) { return snapshot(); },
    useImperativeHandle(ref: React.RefObject<unknown>, create: () => unknown) { layouts.push(() => { ref.current = create(); }); },
  };
  const common = { react: hooks, 'react/jsx-runtime': jsx, 'framer-motion': { motion: new Proxy({}, { get: (_target, key) => String(key) }), useReducedMotion: () => true }, 'lucide-react': { Send: 'svg', Check: 'svg', Square: 'svg', Zap: 'svg', ArrowLeft: 'svg', Trash2: 'svg', Sparkles: 'svg', Target: 'svg', Phone: 'svg' } };
  const modal = (props: Props) => props.open ? React.createElement('div', { role: 'dialog', onClose: props.onClose }, props.children as React.ReactNode, props.footer as React.ReactNode) : null;
  function compile(source: string, modules: Record<string, unknown>) {
    const exports: Record<string, (props: Props) => React.ReactNode> = {};
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    runInNewContext(compiled, { exports, require: (name: string) => { assert.ok(name in modules, name); return modules[name]; } });
    return exports;
  }
  const uiModules = { '../ui/Modal': { Modal: modal }, '../ui/Button': { Button: 'button' } };
  const input = compile(componentSources[1], { ...common, ...uiModules });
  const list = compile(componentSources[2], common);
  const storeHook = Object.assign((selector: (state: ReturnType<typeof useCoachStore.getState>) => unknown) => selector(useCoachStore.getState()), { getState: useCoachStore.getState });
  const coach = compile(componentSources[0], {
    ...common, 'react-router-dom': { useLocation: () => ({ state: { prefill } }), useNavigate: () => () => undefined },
    '../components/ui/Brand': { Brand: 'img' }, '../styles/home-coach.css': {},
    '../services/userAI': { readAIConfiguration: async () => ({ connection: null, credentialStorageReady: false, templates: [] }) },
    '../stores/authStore': { useAuthStore: (select: (value: unknown) => unknown) => select({ user: null }) },
    '../services/apiClient': { getSessionGeneration: () => 0, getVerifiedSessionOwner: () => null },
    '../stores/coachStore': { useCoachStore: storeHook }, '../components/coach/MessageList': list, '../components/coach/ChatInput': input,
    '../hooks/useMediaQuery': { useMediaQuery: () => false }, '../components/ui/Modal': { Modal: modal }, '../components/ui/Button': { Button: 'button' },
    '../services/emotionEngine': { assessEmotionState: () => ({ shouldShowHotline: false }), detectCrisisKeywords: () => false, getCrisisResponse: () => '' },
    '../../server/src/services/safetyResources': { mainlandPsychologicalSupport: {} },
    '../services/coldStartStrategy': { subscribeRecordCoverage: () => () => undefined, getRecordCoverageWelcome: () => 'Synthetic welcome' },
  });
  function expand(node: React.ReactNode, path = 'root'): React.ReactNode {
    if (Array.isArray(node)) return node.map((child, position) => expand(child, `${path}/${position}`));
    if (!React.isValidElement<Props>(node)) return node;
    const key = `${path}/${node.key ?? ''}`;
    if (typeof node.type === 'function') {
      frame = frames.get(key) ?? []; frames.set(key, frame); index = 0;
      return expand((node.type as (props: Props) => React.ReactNode)(node.props), `${key}/result`);
    }
    return React.cloneElement(node, {}, expand(node.props.children as React.ReactNode, key));
  }
  let tree: React.ReactNode;
  const render = () => { tree = expand(React.createElement(coach.default)); for (const commit of layouts.splice(0)) commit(); };
  function elements(): Element[] {
    const result: Element[] = [];
    function visit(node: React.ReactNode) {
      if (Array.isArray(node)) { node.forEach(visit); return; }
      if (!React.isValidElement<Props>(node)) return;
      result.push(node); visit(node.props.children as React.ReactNode);
    }
    visit(tree); return result;
  }
  const text = (node: React.ReactNode): string => Array.isArray(node) ? node.map(text).join('') : React.isValidElement<Props>(node) ? text(node.props.children as React.ReactNode) : typeof node === 'string' ? node : '';
  const one = (predicate: (element: Element) => boolean) => { const matches = elements().filter(predicate); assert.equal(matches.length, 1); return matches[0]; };
  const button = (label: string) => one(node => node.type === 'button' && (node.props['aria-label'] === label || text(node) === label));
  const inputElement = () => one(node => node.type === 'textarea');
  render();
  return {
    render, button,
    text: () => text(tree),
    value: () => inputElement().props.value,
    dialog: () => elements().find(node => node.props.role === 'dialog'),
    click(label: string) { const element = button(label); assert.notEqual(element.props.disabled, true); (element.props.onClick as () => void)(); render(); },
    change(value: string) { (inputElement().props.onChange as (event: unknown) => void)({ target: { value, style: {}, scrollHeight: 44 } }); render(); },
    close() { (this.dialog()!.props.onClose as () => void)(); render(); },
    setPrefill(value: string) { prefill = value; render(); },
  };
}

test('actual coach welcome discloses optional own-model chat scope and never claims application records are sent', () => {
  const ui = componentDriver();
  assert.ok(ui.text().includes('默认使用本地规则回复。只有你选择自己的模型后'));
  assert.ok(ui.text().includes('本次文字与当前会话中已披露范围的有限历史，不附加应用记录'));
  assert.ok(ui.text().includes('模型不会自动变更记录；操作建议须先核对，再由你主动点击执行'));
  assert.ok(ui.text().includes('可能产生 API 费用'));
  assert.ok(!ui.text().includes('问题与相关记录摘要会交给在线模型'));
  assert.ok(!ui.text().includes('模型回复仅为文字建议'));
});

function transport() {
  const requests: Array<{ message: string; sessionId?: string }> = [];
  const first = deferred<Response>();
  globalThis.fetch = async (url, init) => { assert.equal(url, '/api/chat'); assert.equal(init?.method, 'POST'); requests.push(JSON.parse(String(init.body))); return requests.length === 1 ? first.promise : answer(); };
  return { requests, fail: () => first.reject(new TypeError('Synthetic pre-response failure')) };
}
async function failFirst(ui: ReturnType<typeof componentDriver>, network: ReturnType<typeof transport>) {
  ui.change(A); ui.click('发送消息'); network.fail();
  await until(() => !useCoachStore.getState().isTyping); ui.render();
  assert.equal(ui.value(), '');
  assert.deepEqual(network.requests, [{ message: A }]);
}

test('actual page callbacks preserve draft B on cancel, restore A only on replacement, and send A2 only through Send', async () => {
  const network = transport(), ui = componentDriver();
  await failFirst(ui, network);
  const prefix = structuredClone(useCoachStore.getState().messages);
  ui.change(B); ui.click('重新编辑这条消息');
  assert.ok(ui.dialog()); assert.equal(ui.value(), B); assert.equal(network.requests.length, 1);
  ui.click('保留当前输入');
  assert.equal(ui.dialog(), undefined); assert.equal(ui.value(), B); assert.equal(network.requests.length, 1);
  ui.click('重新编辑这条消息'); ui.click('替换为这条消息');
  assert.equal(ui.dialog(), undefined); assert.equal(ui.value(), A); assert.equal(network.requests.length, 1);
  ui.change(A2);
  assert.deepEqual(useCoachStore.getState().messages, prefix); assert.equal(network.requests.length, 1);
  ui.click('发送消息');
  await until(() => !useCoachStore.getState().isTyping); ui.render();
  assert.deepEqual(network.requests, [{ message: A }, { message: A2 }]);
  assert.deepEqual(useCoachStore.getState().messages.slice(0, 2), prefix);
  assert.deepEqual(useCoachStore.getState().messages.slice(2).map(message => message.content), [A2, '本次合成完整答复']);
  assert.equal(ui.value(), '');
  assert.ok(ui.button('重新编辑这条消息'), 'later success retains the original failed-message entry');
});

test('an empty input restores without sending, any existing text asks, and closing preserves the draft', async () => {
  const network = transport(), ui = componentDriver();
  await failFirst(ui, network);
  ui.click('重新编辑这条消息');
  assert.equal(ui.value(), A); assert.equal(ui.dialog(), undefined); assert.equal(network.requests.length, 1);
  for (const draft of [A, '   ', B]) {
    ui.change(draft); ui.click('重新编辑这条消息');
    assert.ok(ui.dialog()); assert.equal(ui.value(), draft);
    ui.close(); assert.equal(ui.value(), draft); assert.equal(ui.dialog(), undefined);
    assert.equal(network.requests.length, 1);
  }
});

test('an already-open selection cannot restore a removed, changed, or no-longer-failed source', async () => {
  for (const invalidate of [
    (messages: CoachMessage[]) => messages.filter(message => message.role !== 'user'),
    (messages: CoachMessage[]) => messages.map(message => message.role === 'user' ? { ...message, content: 'changed original' } : message),
    (messages: CoachMessage[]) => messages.map(message => ({ ...message, replyFailed: false })),
  ]) {
    useCoachStore.getState().clearHistory();
    const network = transport(), ui = componentDriver(); await failFirst(ui, network);
    ui.change(B); ui.click('重新编辑这条消息');
    const confirm = ui.button('替换为这条消息').props.onClick as () => void;
    useCoachStore.setState(state => ({ messages: invalidate(state.messages) }));
    confirm(); ui.render();
    assert.equal(ui.value(), B); assert.equal(ui.dialog(), undefined); assert.equal(network.requests.length, 1);
  }
});

test('cancel and close immediately invalidate retained confirmation callbacks, even before the next render', async () => {
  for (const dismiss of ['keep', 'close']) {
    useCoachStore.getState().clearHistory();
    const network = transport(), ui = componentDriver(); await failFirst(ui, network);
    const failedPrefix = structuredClone(useCoachStore.getState().messages);
    ui.change(B); ui.click('重新编辑这条消息');
    const confirm = ui.button('替换为这条消息').props.onClick as () => void;
    const cancel = (dismiss === 'keep' ? ui.button('保留当前输入').props.onClick : ui.dialog()!.props.onClose) as () => void;
    cancel(); confirm(); ui.render();
    assert.equal(ui.value(), B, dismiss);
    assert.equal(ui.dialog(), undefined);
    assert.equal(network.requests.length, 1);
    assert.deepEqual(useCoachStore.getState().messages, failedPrefix);
  }
});

test('old selection callbacks cannot replace the draft or dismiss a newer choice; the current confirmation works once', async () => {
  const network = transport(), ui = componentDriver(); await failFirst(ui, network);
  ui.change(B); ui.click('重新编辑这条消息');
  const oldConfirm = ui.button('替换为这条消息').props.onClick as () => void;
  const oldCancel = ui.button('保留当前输入').props.onClick as () => void;
  const oldClose = ui.dialog()!.props.onClose as () => void;
  ui.click('保留当前输入'); ui.click('重新编辑这条消息');
  oldConfirm(); oldCancel(); oldClose(); ui.render();
  assert.equal(ui.value(), B); assert.ok(ui.dialog()); assert.equal(network.requests.length, 1);
  const currentConfirm = ui.button('替换为这条消息').props.onClick as () => void;
  currentConfirm(); ui.render();
  assert.equal(ui.value(), A); assert.equal(ui.dialog(), undefined); assert.equal(network.requests.length, 1);
  ui.change(B); currentConfirm(); oldConfirm(); ui.render();
  assert.equal(ui.value(), B); assert.equal(ui.dialog(), undefined); assert.equal(network.requests.length, 1);
});

test('route prefill retains the existing key behavior and quick questions still use the original send path', async () => {
  const ui = componentDriver('原路由预填');
  assert.equal(ui.value(), '原路由预填'); ui.change(B);
  ui.setPrefill('同长新预填'); assert.equal(ui.value(), B, 'same-length key keeps the current component');
  ui.setPrefill('不同长度的新预填内容'); assert.equal(ui.value(), '不同长度的新预填内容');
  const network = transport(); ui.click('帮我看看这周的花销'); network.fail();
  await until(() => !useCoachStore.getState().isTyping); ui.render();
  assert.deepEqual(network.requests, [{ message: '帮我看看这周的花销' }]);
  assert.equal(ui.value(), '不同长度的新预填内容');
});

test('real React markup keeps failure status and edit button outside original text, only on a failed user', () => {
  const messages: CoachMessage[] = [
    { id: 'failed', role: 'user', content: A, timestamp: 1, replyFailed: true },
    { id: 'partial', role: 'assistant', content: '部分原答复', timestamp: 2, replyFailed: true },
    { id: 'success', role: 'user', content: A2, timestamp: 3 },
  ];
  const html = renderToStaticMarkup(React.createElement(MessageList, { messages, onExecuteActions() {}, onExecuteSmartAction: async () => undefined, onEditMessage() {} }));
  assert.equal(html.match(/重新编辑这条消息/g)?.length, 1);
  assert.match(html, /role="status"[^>]*>回复未完成<\/span>/);
  assert.ok(html.includes(`${A}</p></div>`), 'original user paragraph contains only original text');
  assert.ok(html.includes('部分原答复'));
  assert.ok(html.includes(A2));
  const busy = renderToStaticMarkup(React.createElement(MessageList, { messages, isTyping: true, onExecuteActions() {}, onExecuteSmartAction: async () => undefined, onEditMessage() {} }));
  assert.match(busy, /<button type="button" disabled=""/);
});
