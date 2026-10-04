import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
const values = new Map<string, string>();
const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
Object.assign(globalThis, { localStorage: storage, sessionStorage: storage, window: Object.assign(new EventTarget(), { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), location: { replace() {} } }), document: { documentElement: { setAttribute() {} } } });
const accountStorage = await import('../src/db/index.ts');
const { useCoachStore } = await import('../src/stores/coachStore.ts');
const { useTodoStore } = await import('../src/stores/todoStore.ts');
const { useHabitStore } = await import('../src/stores/habitStore.ts');
const { pauseSync } = await import('../src/services/syncEngine.ts');
const { getToday } = await import('../src/utils/date.ts');
const originalTodo = useTodoStore.getState().addItem;
const originalToggle = useHabitStore.getState().toggleHabit;
const seed = (payload: NonNullable<import('../src/stores/coachStore').CoachAction['payload']>) => useCoachStore.setState({ messages: [{ id: 'message', role: 'assistant', content: 'synthetic', timestamp: 0, actions: [{ id: 'action', type: 'smart', title: 'synthetic', level: 2, checked: false, payload }] }] });
const execute = () => useCoachStore.getState().executeSmartAction('message', 'action');
const executed = () => useCoachStore.getState().messages[0].actions![0].executed === true;
before(async () => { await accountStorage.bindAccountDatabase('synthetic-coach-action'); });
beforeEach(() => { useTodoStore.setState({ addItem: originalTodo }); useHabitStore.setState({ toggleHabit: originalToggle, items: [] }); });
after(() => { pauseSync(); accountStorage.db.close(); });

test('repeated clicks while a coach write is pending apply exactly once', async () => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  useTodoStore.setState({ addItem: async (input) => { calls++; await gate; return { ...input, id: 'synthetic', done: false }; } });
  seed({ actionType: 'add_todo', text: 'synthetic todo' });
  const first = execute(); const second = execute();
  assert.equal(calls, 1);
  assert.equal(executed(), false);
  release(); await Promise.all([first, second]);
  assert.equal(executed(), true);
  await execute(); assert.equal(calls, 1);
});

test('failed coach writes never mark success and a deliberate retry can recover', async () => {
  let calls = 0;
  useTodoStore.setState({ addItem: async (input) => { calls++; if (calls === 1) throw new Error('synthetic quota'); return { ...input, id: 'synthetic', done: false }; } });
  seed({ actionType: 'add_todo', text: 'synthetic todo' });
  await execute(); assert.equal(executed(), false);
  await execute(); assert.equal(executed(), true); assert.equal(calls, 2);
});

test('habit action requires one exact nonempty match, never a substring or ambiguous name', async () => {
  let calls = 0;
  useHabitStore.setState({ toggleHabit: async () => { calls++; } });
  const habit = (id: string, name: string) => ({ id, name, icon: 'x', frequency: 'daily' as const, sortOrder: 0, createdAt: 0, done: false, streak: 0, recentCheckins: [] });
  useHabitStore.setState({ items: [habit('walk', '散步'), habit('run', '跑步五公里')] });
  for (const name of ['', '跑步', '每天散步']) { seed({ actionType: 'check_habit', name }); await execute(); assert.equal(executed(), false, name); }
  assert.equal(calls, 0);
  useHabitStore.setState({ items: [habit('one', '散步'), habit('two', '散步')] });
  seed({ actionType: 'check_habit', name: '散步' }); await execute(); assert.equal(executed(), false); assert.equal(calls, 0);
  useHabitStore.setState({ items: [habit('walk', '散步')] });
  seed({ actionType: 'check_habit', name: '散步' }); await execute(); assert.equal(executed(), true); assert.equal(calls, 1);
  await accountStorage.db.habitCheckins.put({ id: `walk|${getToday()}`, habitId: 'walk', date: getToday(), done: true, confirmed: true, source: 'manual', updatedAt: Date.now() });
  seed({ actionType: 'check_habit', name: '散步' }); await execute(); assert.equal(executed(), true); assert.equal(calls, 1);
});

test('blank todo text cannot be turned into a confirmed write', async () => {
  let calls = 0;
  useTodoStore.setState({ addItem: async (input) => { calls++; return { ...input, id: 'synthetic', done: false }; } });
  seed({ actionType: 'add_todo', text: '   ' }); await execute(); assert.equal(executed(), false); assert.equal(calls, 0);
});

test('clearing a streaming conversation aborts it and cannot overwrite the new conversation', async () => {
  const { setSessionActive, clearSession } = await import('../src/services/apiClient.ts');
  const realFetch = globalThis.fetch;
  const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
  const signals: AbortSignal[] = [];
  const encoder = new TextEncoder();
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    signals.push(init?.signal as AbortSignal);
    return new Response(new ReadableStream({ start(controller) { streams.push(controller); } }), { headers: { 'Content-Type': 'text/event-stream', 'X-Session-Id': `synthetic-session-${calls}` } });
  };
  try {
    setSessionActive('synthetic-coach-action');
    useCoachStore.getState().clearHistory();
    const oldRequest = useCoachStore.getState().sendMessage('old synthetic question');
    assert.equal(calls, 1);
    await useCoachStore.getState().sendMessage('accidental double send');
    assert.equal(calls, 1, 'same-frame repeat does not send twice');
    useCoachStore.getState().clearHistory();
    assert.equal(signals[0].aborted, true);
    const newRequest = useCoachStore.getState().sendMessage('new synthetic question');
    assert.equal(calls, 2);
    streams[0].enqueue(encoder.encode('data: {"content":"stale reply"}\n\ndata: [DONE]\n\n'));
    streams[0].close(); await oldRequest;
    assert.equal(useCoachStore.getState().isTyping, true, 'old finalizer does not stop the new reply');
    assert.equal(useCoachStore.getState().sessionId, null, 'old session cannot return after clear');
    assert.ok(useCoachStore.getState().messages.every((message) => !message.content.includes('old synthetic') && !message.content.includes('stale reply')));
    streams[1].enqueue(encoder.encode('data: {"content":"current reply"}\n\ndata: [DONE]\n\n'));
    streams[1].close(); await newRequest;
    assert.equal(useCoachStore.getState().sessionId, 'synthetic-session-2');
    assert.equal(useCoachStore.getState().messages.at(-1)?.content, 'current reply');
    assert.equal(useCoachStore.getState().isTyping, false);
  } finally {
    for (const controller of streams) { try { controller.close(); } catch { /* already completed */ } }
    useCoachStore.getState().clearHistory(); clearSession(); globalThis.fetch = realFetch;
  }
});
