import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { chatRecoveryChecks as checks, installChatRecoveryAbort } from '../scripts/audit-chat-input-recovery.mjs';
import { expenseSummaryChecks } from '../scripts/audit-expense-summary.mjs';

// Pure contract controls only. Mock transport objects do not prove native
// request interception, actual user recovery or current product acceptance.
const contract = checks.contract, origin = 'http://127.0.0.1:4173';
const original = { method: 'POST', url: `${origin}/api/chat`, body: JSON.stringify({ message: contract.original }) };
const frozen = { origin, body: original.body };
const oldTime = '2026-10-07T00:00:00.000Z', newTime = '2026-10-07T00:01:00.000Z';
interface Session { id: string; triggerType: string; createdAt: string }
interface Message { id: string; sessionId: string; role: string; content: string; actions: unknown; createdAt: string }
function source(): { rawSessions: { sessions: Session[] }; rawMessages: Record<string, { messages: Message[] }> } {
  return { rawSessions: { sessions: [{ id: 'old-session', triggerType: 'user_initiated', createdAt: oldTime }] }, rawMessages: {
    'old-session': { messages: [
      { id: 'old-user', sessionId: 'old-session', role: 'user', content: '原来完整问题', actions: null, createdAt: oldTime },
      { id: 'old-assistant', sessionId: 'old-session', role: 'assistant', content: '原来完整答复', actions: [{ type: 'navigate', path: '/expense', label: '查看明细' }], createdAt: oldTime },
    ] },
  } };
}
const failedBubbles = [{ role: 'user', content: contract.original }, { role: 'assistant', content: '抱歉，网络似乎不太稳定，请稍后重试。' }];
const content = '【规则回复 · 在线模型当前不可用】\n近7天 2026-10-01 至 2026-10-07\n支出合计 ¥40.25，共1笔支出\n餐饮 ¥40.25';
const completed = expenseSummaryChecks.completeRuleSse(`data: ${JSON.stringify({ content, source: 'rule_fallback' })}\n\ndata: [DONE]\n\n`);
function successfulSource() {
  const after = source();
  after.rawSessions.sessions.unshift({ id: 'new-session', triggerType: 'user_initiated', createdAt: newTime });
  after.rawMessages['new-session'] = { messages: [
    { id: 'new-user', sessionId: 'new-session', role: 'user', content: contract.edited, actions: null, createdAt: newTime },
    { id: 'new-assistant', sessionId: 'new-session', role: 'assistant', content, actions: null, createdAt: newTime },
  ] };
  return after;
}

test('Fault matches only the same-origin exact POST/body, aborts once and releases without replay', async () => {
  assert.equal(checks.exactFailureRequest(original, frozen), true);
  const others = [
    { ...original, method: 'GET' }, { ...original, url: 'https://example.test/api/chat' },
    { ...original, url: `${origin}/api/chat?retry=1` }, { ...original, url: `${origin}/api/chat/sessions` },
    { ...original, body: JSON.stringify({ message: contract.original, sessionId: 'old-session' }) },
    { ...original, body: JSON.stringify({ message: `${contract.original}。` }) },
    { ...original, body: JSON.stringify({ message: contract.original }, null, 2) },
  ];
  for (const other of others) assert.equal(checks.exactFailureRequest(other, frozen), false);
  const page = new EventEmitter() as EventEmitter & { setRequestInterception: (enabled: boolean) => Promise<void> };
  const interception: boolean[] = [], operations: string[] = [];
  page.setRequestInterception = async enabled => { interception.push(enabled); };
  const fault = await installChatRecoveryAbort(page, frozen);
  for (const data of [...others, original, original]) page.emit('request', {
    method: () => data.method, url: () => data.url, postData: () => data.body,
    abort: async (reason: string) => { operations.push(`abort:${reason}`); },
    continue: async () => { operations.push('continue'); },
  });
  await fault.release(); await fault.release();
  assert.deepEqual(interception, [true, false]); assert.equal(page.listenerCount('request'), 0);
  assert.deepEqual(operations, [...others.map(() => 'continue'), 'abort:failed', 'continue']);
  assert.equal(fault.diagnostic.aborted, 1); assert.equal(fault.diagnostic.matches, 2); assert.deepEqual(fault.diagnostic.errors, []);
  let failContinuation: (error: Error) => void = () => { assert.fail('Continuation not initialized'); };
  const continuation = new Promise<void>((_resolve, reject) => { failContinuation = reject; });
  page.setRequestInterception = async enabled => { if (!enabled) failContinuation(new Error('Synthetic release failure')); };
  const releasingFault = await installChatRecoveryAbort(page, frozen);
  page.emit('request', { method: () => 'GET', url: () => `${origin}/api/chat/sessions`, postData: () => undefined, continue: () => continuation });
  assert.deepEqual(releasingFault.diagnostic.errors, [], 'Before release is too early to credit fault cleanup');
  await assert.rejects(releasingFault.release(), /Fault release must finish without interception errors/);
  assert.deepEqual(releasingFault.diagnostic.errors, ['Synthetic release failure']); assert.equal(page.listenerCount('request'), 0);
});

test('Complete Chat API source cannot be credited at either cap or after any old row change', () => {
  const before = source(); assert.equal(checks.sameChatSources(before, structuredClone(before)), true);
  const sessionChange = source(); sessionChange.rawSessions.sessions[0].createdAt = newTime;
  const contentChange = source(); contentChange.rawMessages['old-session'].messages[0].content += 'changed';
  const actionChange = source(); actionChange.rawMessages['old-session'].messages[1].actions = [];
  const idChange = source(); idChange.rawMessages['old-session'].messages[1].id = 'other-assistant';
  for (const invalid of [sessionChange, contentChange, actionChange, idChange, successfulSource()]) assert.equal(checks.sameChatSources(before, invalid), false);
  const sessionsAtCap = source(); sessionsAtCap.rawSessions.sessions = Array.from({ length: 20 }, (_, index) => ({ ...before.rawSessions.sessions[0], id: `session-${index}` }));
  assert.throws(() => checks.validateChatSources(sessionsAtCap), /20-row cap/);
  const messagesAtCap = source(); messagesAtCap.rawMessages['old-session'].messages = Array.from({ length: 200 }, (_, index) => ({ ...before.rawMessages['old-session'].messages[0], id: `message-${index}` }));
  assert.throws(() => checks.validateChatSources(messagesAtCap), /200-row cap/);
  const duplicate = source(); duplicate.rawMessages['old-session'].messages[1].id = 'old-user'; assert.throws(() => checks.validateChatSources(duplicate));
});

test('Opening/cancelling recovery preserves the real new draft, failed bubbles and zero additional sends', () => {
  const state = { bubbles: structuredClone(failedBubbles), input: { value: contract.otherDraft, disabled: false }, thinking: false };
  assert.equal(checks.retainedEditState(failedBubbles, state, contract.otherDraft, 1), true);
  assert.equal(checks.retainedEditState(failedBubbles, state, contract.otherDraft, 2), false);
  assert.equal(checks.retainedEditState(failedBubbles, { ...state, input: { value: contract.original, disabled: false } }, contract.otherDraft, 1), false);
  assert.equal(checks.retainedEditState(failedBubbles, { ...state, bubbles: failedBubbles.slice(0, 1) }, contract.otherDraft, 1), false);
  assert.equal(checks.retainedEditState(failedBubbles, { ...state, thinking: true }, contract.otherDraft, 1), false);
  assert.equal(checks.inputReadingMatches({ value: contract.original }, contract.original), true, 'The value read with the actual input view is exactly restored A');
  assert.equal(checks.inputReadingMatches({ value: contract.otherDraft }, contract.original), false, 'Earlier restored A cannot credit a view whose actual value has since changed');
});

test('Only the explicit edited answer may create one session and its exact user/assistant pair', () => {
  const before = source(), after = successfulSource(), request = { sessionId: 'new-session', startedAt: Date.parse(newTime) - 100, finishedAt: Date.parse(newTime) + 100 };
  assert.equal(checks.recoveredChatSources(before, after, completed, request), true);
  const oldChanged = successfulSource(); oldChanged.rawMessages['old-session'].messages[0].createdAt = newTime;
  const wrongText = successfulSource(); wrongText.rawMessages['new-session'].messages[0].content = contract.original;
  const staleTime = successfulSource(); staleTime.rawMessages['new-session'].messages[1].createdAt = oldTime;
  const duplicateSend = successfulSource(); duplicateSend.rawMessages['new-session'].messages.push({ ...duplicateSend.rawMessages['new-session'].messages[0], id: 'third-message' });
  const missingAssistant = successfulSource(); missingAssistant.rawMessages['new-session'].messages.pop();
  const wrongAction = successfulSource(); wrongAction.rawMessages['new-session'].messages[1].actions = [{ type: 'log_expense', amountFen: 10 }];
  for (const invalid of [oldChanged, wrongText, staleTime, duplicateSend, missingAssistant, wrongAction]) assert.equal(checks.recoveredChatSources(before, invalid, completed, request), false);
  assert.equal(checks.recoveredChatSources(before, after, completed, { ...request, sessionId: 'old-session' }), false);
  assert.equal(checks.recoveredChatSources(before, after, { ...completed, done: false }, request), false);
});

test('Later successful UI preserves the original failure prefix instead of replacing its evidence', () => {
  const after = [...failedBubbles, { role: 'user', content: contract.edited }, { role: 'assistant', content }];
  assert.equal(checks.recoveredBubbles(failedBubbles, after, completed), true);
  for (const invalid of [after.slice(2), [{ ...failedBubbles[0], content: contract.edited }, ...after.slice(1)], [...after, { role: 'assistant', content }], [...failedBubbles, { role: 'user', content: contract.original }, { role: 'assistant', content }]]) assert.equal(checks.recoveredBubbles(failedBubbles, invalid, completed), false);
});
