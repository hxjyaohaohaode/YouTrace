import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';

const values = new Map<string, string>();
const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
Object.assign(globalThis, { localStorage: storage, sessionStorage: storage, window: Object.assign(new EventTarget(), { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) }), document: { documentElement: { setAttribute() {} } } });
const { streamChat, setSessionActive } = await import('../src/services/apiClient.ts');
const { consumeSseStream } = await import('../src/services/sseParser.ts');
const { useCoachStore } = await import('../src/stores/coachStore.ts');
const { getToastSnapshot } = await import('../src/services/toastBus.ts');
const { db } = await import('../src/db/index.ts');
const realFetch = globalThis.fetch;
// One fixed fixture identity; no identity transitions or clear/reset mechanism.
setSessionActive('synthetic-stream-completion');
after(() => { globalThis.fetch = realFetch; db.close(); });

const PARTIAL = '合成部分正文：第一段\n第二行';
const ACTION = { type: 'navigate', path: '/todo', label: '查看待办' };
function wire(events: unknown[], done = true, newline = '\n', terminalDelimiter = true) {
  return events.map(event => `data: ${JSON.stringify(event)}${newline}${newline}`).join('')
    + (done ? `data: [DONE]${terminalDelimiter ? `${newline}${newline}` : ''}` : '');
}
function bytesStream(payload: string, error?: Error) {
  const bytes = new TextEncoder().encode(payload);
  let offset = 0;
  return new ReadableStream<Uint8Array>({ pull(controller) {
    if (offset < bytes.length) { controller.enqueue(bytes.slice(offset, offset + 7)); offset += 7; return; }
    if (error) controller.error(error); else controller.close();
  } });
}
function respond(payload: string, error?: Error) {
  globalThis.fetch = async (url, init) => {
    assert.equal(url, '/api/chat'); assert.equal(init?.method, 'POST');
    return new Response(bytesStream(payload, error), { headers: { 'X-Session-Id': 'synthetic-completed-session', 'Content-Type': 'text/event-stream; charset=utf-8' } });
  };
}

test('actual client requires DONE while preserving split UTF-8, CRLF and EOF event dispatch', async () => {
  for (const newline of ['\n', '\r\n']) for (const terminalDelimiter of [true, false]) {
    const chunks: string[] = [];
    respond(wire([{ content: '你' }, { content: '好\n第二行' }], true, newline, terminalDelimiter));
    const result = await streamChat('查看待办', undefined, chunk => chunks.push(chunk));
    assert.deepEqual(chunks, ['你', '好\n第二行']); assert.equal(result.content, '你好\n第二行');
  }
  respond('data: [DONE]');
  assert.equal((await streamChat('查看待办')).content, '');
  const afterDone: string[] = [];
  respond(wire([{ content: PARTIAL }]) + wire([{ content: '忽略已完成后的事件' }], false));
  await streamChat('查看待办', undefined, chunk => afterDone.push(chunk));
  assert.deepEqual(afterDone, [PARTIAL]);
  const generic: string[] = [];
  await consumeSseStream(bytesStream('data: generic-event-without-DONE'), data => generic.push(data));
  assert.deepEqual(generic, ['generic-event-without-DONE']);

  for (const content of [PARTIAL, '']) for (const finalDelimiter of [true, false]) {
    const chunks: string[] = [];
    const payload = wire(content ? [{ content }] : [], false);
    respond(finalDelimiter ? payload : payload.trimEnd());
    await assert.rejects(streamChat('查看待办', undefined, chunk => chunks.push(chunk)));
    assert.deepEqual(chunks, content ? [content] : []);
  }
  globalThis.fetch = async () => new Response(null, { headers: { 'X-Session-Id': 'synthetic-null-body-session' } });
  const nullBodyChunks: string[] = [];
  await assert.rejects(streamChat('查看待办', undefined, chunk => nullBodyChunks.push(chunk)));
  assert.deepEqual(nullBodyChunks, []);
});

test('client preserves original reader failures and actions already delivered before truncation', async () => {
  const original = new TypeError('Synthetic reader failure after partial content');
  for (const error of [undefined, original]) {
    const chunks: string[] = [], actions: unknown[] = [];
    respond(wire([{ content: PARTIAL }, { actions: [ACTION] }], false), error);
    const pending = streamChat('查看待办', undefined, chunk => chunks.push(chunk), rows => actions.push(rows));
    if (error) await assert.rejects(pending, actual => actual === original);
    else await assert.rejects(pending);
    assert.deepEqual(chunks, [PARTIAL]); assert.deepEqual(actions, [[ACTION]]);
  }
});

test('only the exact existing rule_fallback content source reaches the optional callback parameter', async () => {
  const sources = [undefined, 'rule_fallback', 'RULE_FALLBACK', 'rule_fallback ', 'safety_template', { source: 'rule_fallback' }];
  const chunks: Array<{ text: string; source?: string }> = [];
  respond(wire(sources.map((source, index) => ({ content: `片段${index}`, source }))));
  const result = await streamChat('查看待办', undefined, (text, source) => chunks.push({ text, source }));
  assert.deepEqual(chunks, sources.map((source, index) => ({ text: `片段${index}`, source: source === 'rule_fallback' ? 'rule_fallback' : undefined })));
  assert.equal(result.content, sources.map((_, index) => `片段${index}`).join(''));
});

test('actual store marks a normally closed incomplete reply and retains prior messages, content and received actions', async () => {
  for (const content of [PARTIAL, '']) {
    const before = structuredClone(useCoachStore.getState().messages), sessionBefore = useCoachStore.getState().sessionId;
    const toastBefore = getToastSnapshot();
    respond(wire(content ? [{ content }, { actions: [ACTION] }] : [], false));
    await useCoachStore.getState().sendMessage('查看待办');
    const state = useCoachStore.getState(), [user, assistant] = state.messages.slice(-2);
    assert.deepEqual(state.messages.slice(0, -2), before);
    assert.equal(user.replyFailed, true); assert.equal(state.isTyping, false);
    assert.equal(state.sessionId, sessionBefore);
    assert.equal(assistant.content, content || '抱歉，网络似乎不太稳定，请稍后重试。');
    if (content) {
      assert.equal(assistant.actions?.[0].payload?.actionType, 'navigate');
      assert.equal(getToastSnapshot().length, toastBefore.length + 1);
      assert.equal(getToastSnapshot().at(-1)?.message, '回复生成中断，内容可能不完整');
    } else assert.deepEqual(getToastSnapshot(), toastBefore);
  }
  assert.equal(db.isOpen(), false);
});
