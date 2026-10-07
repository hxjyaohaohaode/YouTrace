// Hosted-CI native RED baseline only. No product/store/identity/clock writes.
// Append to the existing completeObservation profiles after all prerequisites.
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { expenseSummaryChecks } from './audit-expense-summary.mjs';

const INPUT = 'textarea[aria-label="输入消息"]';
const SEND = 'button[aria-label="发送消息"]';
const BUBBLES = 'main p.whitespace-pre-wrap, main div.whitespace-pre-wrap';
const CONTRACT = Object.freeze({
  original: '帮我看看这周的花销，按已记录的支出回答',
  otherDraft: '先保留这段新输入，我还想核对昨天的花销',
  edited: '帮我看看近7天的花销，只统计已记录支出',
  edit: '重新编辑这条消息', keep: '保留当前输入', replace: '替换为这条消息',
});
const TRUNCATED = Object.freeze({
  original: '请继续核对已记录的花销，并说明依据',
  partial: '合成截断流：先核对已记录的支出，后续说明',
});
const TRUNCATED_SSE = `data: ${JSON.stringify({ content: TRUNCATED.partial })}\n\n`;

function sameOriginChat(request, origin) {
  const url = new URL(request.url);
  return request.method === 'POST' && url.origin === origin && url.pathname === '/api/chat' && !url.search && !url.hash;
}
function exactFailureRequest(request, frozen) {
  return sameOriginChat(request, frozen.origin) && request.body === frozen.body;
}
function validateChatSources(source) {
  const sessions = source?.rawSessions?.sessions;
  assert.ok(Array.isArray(sessions) && sessions.length < 20, 'ChatSession GET must be below its 20-row cap');
  assert.equal(new Set(sessions.map(row => row.id)).size, sessions.length, 'Unique session IDs required');
  assert.deepEqual(Object.keys(source.rawMessages).sort(), sessions.map(row => row.id).sort());
  const ids = new Set();
  for (const session of sessions) {
    assert.ok(typeof session.id === 'string' && session.id.length >= 8 && typeof session.triggerType === 'string' && Number.isFinite(Date.parse(session.createdAt)));
    const rows = source.rawMessages[session.id]?.messages;
    assert.ok(Array.isArray(rows) && rows.length < 200, 'Each complete message GET must be below its 200-row cap');
    for (const row of rows) {
      assert.ok(typeof row.id === 'string' && row.id.length >= 8 && !ids.has(row.id)); ids.add(row.id);
      assert.equal(row.sessionId, session.id);
      assert.ok(['user', 'assistant', 'system'].includes(row.role) && typeof row.content === 'string' && Object.hasOwn(row, 'actions') && Number.isFinite(Date.parse(row.createdAt)));
    }
  }
  return source;
}
function sameChatSources(before, after) {
  validateChatSources(before); validateChatSources(after);
  return isDeepStrictEqual(before, after);
}
function recoveredChatSources(before, after, completed, request) {
  validateChatSources(before); validateChatSources(after);
  if (!completed?.done || completed.source !== 'rule_fallback' || ![request.sendActionStartedAt, request.requestObservedAt, request.finishedAt].every(Number.isFinite) || request.requestObservedAt < request.sendActionStartedAt || request.requestObservedAt > request.finishedAt) return false;
  const old = before.rawSessions.sessions, next = after.rawSessions.sessions;
  if (next.length !== old.length + 1 || old.some(row => !isDeepStrictEqual(next.find(item => item.id === row.id), row))) return false;
  if (old.some(row => !isDeepStrictEqual(before.rawMessages[row.id], after.rawMessages[row.id]))) return false;
  const session = next.find(row => !old.some(item => item.id === row.id));
  if (session?.id !== request.sessionId || session.triggerType !== 'user_initiated') return false;
  const rows = after.rawMessages[session.id].messages, inSend = row => Date.parse(row.createdAt) >= request.sendActionStartedAt && Date.parse(row.createdAt) <= request.finishedAt;
  const actions = completed.events.flatMap(event => event.actions ?? []);
  return inSend(session) && rows.length === 2 && rows.every(inSend) && rows[0].role === 'user' && rows[0].content === CONTRACT.edited && rows[0].actions === null && rows[1].role === 'assistant' && rows[1].content === completed.content && isDeepStrictEqual(rows[1].actions, actions.length ? actions : null);
}
function unchangedBubbles(before, after) { return isDeepStrictEqual(before, after); }
function retainedEditState(expectedBubbles, actual, draft, requestCount) {
  return requestCount === 1 && unchangedBubbles(expectedBubbles, actual.bubbles) && actual.input.value === draft && actual.thinking === false;
}
function inputReadingMatches(input, expectedValue) { return typeof expectedValue === 'string' && input?.value === expectedValue; }
function inputLayoutChecks(input) {
  // CSSOM scroll extents include padding. This bounded LTR/horizontal check
  // excludes only measured padding, not a fixed overflow tolerance or glyphs.
  const css = input?.computedStyle;
  const px = value => typeof value === 'string' && /^(?:\d+(?:\.\d+)?|\.\d+)px$/.test(value) ? Number(value.slice(0, -2)) : NaN;
  const padding = Object.fromEntries(['Top', 'Right', 'Bottom', 'Left'].map(side => [side.toLowerCase(), px(css?.[`padding${side}`])]));
  const lineHeight = px(css?.lineHeight);
  const dimensions = ['clientHeight', 'scrollHeight', 'clientWidth', 'scrollWidth', 'scrollTop', 'scrollLeft'].map(key => input?.[key]);
  const validMetrics = [...dimensions, ...Object.values(padding), lineHeight].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0) &&
    lineHeight > 0 && input.clientHeight > padding.top + padding.bottom && input.clientWidth > padding.left + padding.right &&
    input.scrollHeight >= input.clientHeight && input.scrollWidth >= input.clientWidth && input.scrollHeight - padding.top - padding.bottom >= lineHeight;
  const supportedLayout = css?.direction === 'ltr' && css?.writingMode === 'horizontal-tb' && ['border-box', 'content-box'].includes(css?.boxSizing);
  if (!validMetrics || !supportedLayout) return { validMetrics, supportedLayout, readable: false };
  const contentEdges = { top: padding.top - input.scrollTop, bottom: input.scrollHeight - padding.bottom - input.scrollTop, left: padding.left - input.scrollLeft, right: input.scrollWidth - padding.right - input.scrollLeft };
  return { validMetrics, supportedLayout, padding, lineHeight, contentEdges, readable: contentEdges.top >= 0 && contentEdges.bottom <= input.clientHeight && contentEdges.left >= 0 && contentEdges.right <= input.clientWidth };
}
function recoveredBubbles(before, after, completed) {
  return completed?.done === true && completed.source === 'rule_fallback' && after.length === before.length + 2 && isDeepStrictEqual(before, after.slice(0, before.length)) && isDeepStrictEqual(after.slice(-2), [{ role: 'user', content: CONTRACT.edited }, { role: 'assistant', content: completed.content }]);
}
export const chatRecoveryChecks = { contract: CONTRACT, sameOriginChat, exactFailureRequest, validateChatSources, sameChatSources, recoveredChatSources, unchangedBubbles, retainedEditState, inputReadingMatches, inputLayoutChecks, recoveredBubbles };

function truncatedBubbles(before, after) {
  return after.length === before.length + 2 && unchangedBubbles(before, after.slice(0, before.length)) &&
    isDeepStrictEqual(after.slice(-2), [{ role: 'user', content: TRUNCATED.original }, { role: 'assistant', content: TRUNCATED.partial }]);
}
function truncatedTransport(requests, frozen, diagnostic) {
  const request = requests[0], response = request?.responses[0];
  return requests.length === 1 && exactFailureRequest(request, frozen) && request.failures.length === 0 && request.finished.length === 1 &&
    request.responses.length === 1 && response.status === 200 && !response.error && response.text === TRUNCATED_SSE &&
    /^text\/event-stream;\s*charset=utf-8$/i.test(response.contentType ?? '') && diagnostic?.matches === 1 && diagnostic.responded === 1 &&
    diagnostic.errors.length === 0 && Number.isFinite(diagnostic.releasedAt);
}
export const truncatedChatChecks = { contract: TRUNCATED, sse: TRUNCATED_SSE, truncatedBubbles, truncatedTransport };

// Synthetic client transport only. The one response never reaches /api/chat;
// its HTTP 200 is not a backend save, rule result or real provider completion.
export async function installChatTruncatedResponse(page, frozen) {
  const diagnostic = { installedAt: Date.now(), releasedAt: null, matches: 0, responded: 0, continued: 0, errors: [] };
  const pending = new Set(); let released = false;
  const onRequest = request => {
    const match = exactFailureRequest({ method: request.method(), url: request.url(), body: request.postData() }, frozen);
    if (match) diagnostic.matches++;
    const respond = !released && match && diagnostic.responded === 0;
    if (respond) diagnostic.responded++; else diagnostic.continued++;
    const operation = (respond ? request.respond({ status: 200, contentType: 'text/event-stream; charset=utf-8', body: Buffer.from(TRUNCATED_SSE, 'utf8') }) : request.continue())
      .catch(error => { diagnostic.errors.push(error.message); });
    pending.add(operation); operation.finally(() => pending.delete(operation));
  };
  page.on('request', onRequest);
  try { await page.setRequestInterception(true); }
  catch (error) { page.off('request', onRequest); throw error; }
  return { diagnostic, async release() {
    if (released) return;
    released = true; diagnostic.releasedAt = Date.now();
    try { await page.setRequestInterception(false); await Promise.all([...pending]); }
    finally { page.off('request', onRequest); }
    assert.deepEqual(diagnostic.errors, [], 'Synthetic EOF release must finish without interception errors');
  } };
}

// A real browser abort, once, before delivery. Other requests are continued.
// The caller keeps request/response/requestfailed evidence across release.
export async function installChatRecoveryAbort(page, frozen) {
  const diagnostic = { installedAt: Date.now(), releasedAt: null, matches: 0, aborted: 0, continued: 0, errors: [] };
  const pending = new Set(); let released = false;
  const onRequest = request => {
    const match = exactFailureRequest({ method: request.method(), url: request.url(), body: request.postData() }, frozen);
    if (match) diagnostic.matches++;
    const abort = !released && match && diagnostic.aborted === 0;
    if (abort) diagnostic.aborted++; else diagnostic.continued++;
    const operation = (abort ? request.abort('failed') : request.continue()).catch(error => { diagnostic.errors.push(error.message); });
    pending.add(operation); operation.finally(() => pending.delete(operation));
  };
  page.on('request', onRequest);
  try { await page.setRequestInterception(true); }
  catch (error) { page.off('request', onRequest); throw error; }
  return {
    diagnostic,
    async release() {
      if (released) return;
      released = true; diagnostic.releasedAt = Date.now();
      // Remain installed until interception is disabled, so concurrent unrelated
      // requests never get stranded. Release does not replay any request.
      try { await page.setRequestInterception(false); await Promise.all([...pending]); }
      finally { page.off('request', onRequest); }
      assert.deepEqual(diagnostic.errors, [], 'Fault release must finish without interception errors');
    },
  };
}

async function bounded(promise, label, timeout = 12000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}; no automatic resend`)), timeout); })]); }
  finally { clearTimeout(timer); }
}

export async function runChatInputRecovery(h, { page, api, label, financial, openPage }) {
  const { pointer, fill, observe, segment, capture, sleep, actions, artifacts, writeFile, join } = h;
  const prefix = `${label}-chat-recovery`, origin = new URL(page.url()).origin;
  const frozenRequest = Object.freeze({ origin, method: 'POST', path: '/api/chat', body: JSON.stringify({ message: CONTRACT.original }) });
  const requests = [], byRequest = new Map(); let fault, eofFault, firstFailureSaved = false, truncationStarted = false;
  async function save(name, value) { await writeFile(join(artifacts, `${prefix}-${name}.json`), JSON.stringify({ syntheticOnly: true, observedAt: new Date().toISOString(), ...value }, null, 2)); }
  async function bubbles() { return page.$$eval(BUBBLES, nodes => nodes.map(node => ({ role: node.tagName === 'P' ? 'user' : 'assistant', content: node.innerText }))); }
  async function ui() {
    return { bubbles: await bubbles(), input: await page.$eval(INPUT, el => ({ value: el.value, disabled: el.disabled, height: el.clientHeight, contentHeight: el.scrollHeight })), thinking: await page.$$eval('main p', nodes => nodes.some(node => node.textContent === '正在思考...')) };
  }
  async function chatSources(name) {
    const rawSessions = await bounded(api('/chat/sessions'), 'ChatSession source read incomplete'), rawMessages = {};
    assert.ok(Array.isArray(rawSessions.sessions) && rawSessions.sessions.length < 20);
    for (const session of rawSessions.sessions) rawMessages[session.id] = await bounded(api(`/chat/sessions/${encodeURIComponent(session.id)}/messages`), 'ChatMessage source read incomplete');
    const source = { rawSessions, rawMessages };
    await save(`${name}-chat-sources`, { source, scope: 'Every returned ChatSession/ChatMessage field, all fixture sessions; explicit API caps 20/200. These rows are not in the business ledger.' });
    return validateChatSources(source);
  }
  async function sources(name) { return { chat: await chatSources(name), financial: await financial.snapshot(`chat-recovery-${name}`) }; }
  async function noWrites(before, name, expectedBubbles, draft) {
    const current = await sources(name), actual = await ui();
    await save(`${name}-state`, { ui: actual, requestCount: requests.length });
    assert.ok(sameChatSources(before.chat, current.chat), 'Failure, release and edit choices must not add/rewrite any canonical chat row');
    await financial.preserve(before.financial, current.financial, `chat-recovery-${name}`);
    assert.ok(retainedEditState(expectedBubbles, actual, draft, requests.length), 'No silent send, original failed bubbles and exact expected draft retained, typing ended');
    if (!await page.$('[role=dialog]')) assert.equal(actual.input.disabled, false, 'Input is editable when the explicit choice is closed');
    assert.equal(requests[0].responses.length, 0); assert.equal(requests[0].failures.length, 1);
    return actual;
  }
  async function read(selector, name, expectedInput) {
    const reading = await financial.read(selector); await capture(page, `${prefix}-${name}`);
    const input = selector === INPUT ? await page.$eval(INPUT, el => {
      const css = getComputedStyle(el);
      return { value: el.value, clientHeight: el.clientHeight, scrollHeight: el.scrollHeight, clientWidth: el.clientWidth, scrollWidth: el.scrollWidth, scrollTop: el.scrollTop, scrollLeft: el.scrollLeft,
        computedStyle: { paddingTop: css.paddingTop, paddingRight: css.paddingRight, paddingBottom: css.paddingBottom, paddingLeft: css.paddingLeft, boxSizing: css.boxSizing, lineHeight: css.lineHeight, direction: css.direction, writingMode: css.writingMode } };
    }) : null;
    const inputMatches = input ? inputReadingMatches(input, expectedInput) : null;
    const inputLayout = input ? inputLayoutChecks(input) : null;
    await save(`${name}-reading`, { selector, reading, input, expectedInput, inputMatches, inputLayout });
    assert.ok(reading.visible && (!input || inputMatches && inputLayout.readable), `Actual painted/clipped/foreground complete exact reading required: ${name}`); return reading;
  }
  async function bubbleSelector(index) { return page.evaluate(index => {
    const node = document.querySelectorAll('main p.whitespace-pre-wrap, main div.whitespace-pre-wrap')[index];
    const parts = []; for (let el = node; el && el !== document.body; el = el.parentElement) { const siblings = [...el.parentElement.children].filter(row => row.tagName === el.tagName); parts.unshift(`${el.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(el) + 1})`); }
    return node ? `body > ${parts.join(' > ')}` : null;
  }, index); }
  async function editEntry(originalText = CONTRACT.original) {
    return page.evaluate(({ original, edit }) => {
      const matches = [...document.querySelectorAll('main p.whitespace-pre-wrap')].filter(el => el.innerText === original);
      if (matches.length !== 1) return { count: 0, reason: 'Original failed user bubble is not unique' };
      for (let root = matches[0].parentElement; root && root.tagName !== 'MAIN'; root = root.parentElement) {
        if (root.querySelectorAll('p.whitespace-pre-wrap, div.whitespace-pre-wrap').length !== 1) break;
        const buttons = [...root.querySelectorAll('button')].filter(el => el.innerText.trim() === edit);
        if (buttons.length !== 1) continue;
        const parts = []; for (let el = buttons[0]; el && el !== document.body; el = el.parentElement) { const siblings = [...el.parentElement.children].filter(row => row.tagName === el.tagName); parts.unshift(`${el.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(el) + 1})`); }
        const statuses = [...root.querySelectorAll('[role=status]')].filter(el => el.innerText.trim() === '回复未完成');
        return { count: 1, selector: `body > ${parts.join(' > ')}`, text: buttons[0].innerText, disabled: buttons[0].disabled,
          statusCount: statuses.length, statusSelector: statuses.length === 1 ? `body > ${parts.slice(0, -1).join(' > ')} > span[role=status]` : null };
      }
      return { count: 0, reason: 'No visible edit action beside the original failed user bubble' };
    }, { ...CONTRACT, original: originalText });
  }
  async function dialogControl(text, name) {
    const selector = await page.evaluate(text => {
      const dialogs = [...document.querySelectorAll('[role=dialog]')];
      if (dialogs.length !== 1) return null;
      const buttons = [...dialogs[0].querySelectorAll('button')], matches = buttons.filter(el => el.innerText.trim() === text);
      if (matches.length !== 1) return null;
      const parts = []; for (let el = matches[0]; el && el !== document.body; el = el.parentElement) { const siblings = [...el.parentElement.children].filter(row => row.tagName === el.tagName); parts.unshift(`${el.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(el) + 1})`); }
      return `body > ${parts.join(' > ')}`;
    }, text);
    assert.ok(selector, `Explicit visible choice required: ${text}`); await read(selector, name); return selector;
  }
  const onRequest = request => {
    const data = { method: request.method(), url: request.url(), body: request.postData() };
    if (!sameOriginChat(data, origin)) return;
    const record = { ...data, startedAt: Date.now(), failures: [], responses: [], finished: [] }; requests.push(record); byRequest.set(request, record);
  };
  const onFailed = request => { const record = byRequest.get(request); if (record) record.failures.push({ at: Date.now(), errorText: request.failure()?.errorText ?? null }); };
  const onFinished = request => { const record = byRequest.get(request); if (record) record.finished.push({ at: Date.now() }); };
  const onResponse = response => {
    const record = byRequest.get(response.request()); if (!record) return;
    const result = { at: Date.now(), status: response.status(), sessionId: response.headers()['x-session-id'] ?? null, contentType: response.headers()['content-type'] ?? null };
    record.responses.push(result);
    // Actual SSE consumption starts when its real response arrives.
    record.bodyResult = response.text().then(text => { result.text = text; return result; }, error => { result.error = error.message; return result; });
  };
  const network = () => ({ frozenRequest, fault: fault?.diagnostic ?? null, requests: requests.map(({ bodyResult: _pending, ...record }) => record), boundary: 'Synthetic message bodies/session IDs only; no credentials or request headers retained' });
  async function until(predicate, name) {
    const deadline = Date.now() + 12000;
    do { if (predicate()) return; await sleep(75); } while (Date.now() < deadline);
    throw new Error(`${name}; bounded observation ended without resend`);
  }
  async function truncatedReply(before, originalUi, sessionId) {
    const requestOffset = requests.length;
    assert.equal(requestOffset, 2); assert.equal(originalUi.bubbles.length, 4);
    assert.equal(originalUi.input.value, ''); assert.equal(originalUi.input.disabled, false);
    assert.ok(before.chat.rawSessions.sessions.some(session => session.id === sessionId));
    const frozen = Object.freeze({ origin, body: JSON.stringify({ message: TRUNCATED.original, sessionId }) });
    const eofNetwork = () => ({ frozenRequest: frozen, declaredResponse: { syntheticClientTransport: true, status: 200, contentType: 'text/event-stream; charset=utf-8', body: TRUNCATED_SSE, normalEofWithoutDone: true }, fault: eofFault?.diagnostic ?? null,
      previousPostCount: requestOffset, addedPostCount: requests.length - requestOffset, totalPostCount: requests.length,
      requests: network().requests.slice(requestOffset), boundary: 'Puppeteer respond, not a backend or provider response; only this exact POST is substituted once. No automatic resend.' });
    async function notificationState() {
      return page.evaluate(selector => {
        const input = document.querySelector(selector).getBoundingClientRect();
        const cards = [...document.querySelectorAll('[aria-label="通知"] button[aria-label="关闭提示"]')].map(button => {
          const card = button.parentElement, rect = card.getBoundingClientRect(), css = getComputedStyle(card);
          return { text: card.innerText, rect: rect.toJSON(), opacity: css.opacity, pointerEvents: css.pointerEvents,
            painted: rect.width > 0 && rect.height > 0 && css.display !== 'none' && css.visibility === 'visible' && Number(css.opacity) > 0,
            partialWarning: card.innerText.includes('回复生成中断，内容可能不完整'),
            overlapsInput: rect.left < input.right && rect.right > input.left && rect.top < input.bottom && rect.bottom > input.top };
        });
        return { inputRect: input.toJSON(), cards };
      }, INPUT);
    }
    async function preserved(name, expectedInput) {
      const current = await sources(`truncated-${name}`), actual = await ui();
      await save(`truncated-${name}-state`, { ui: actual, network: eofNetwork() });
      assert.ok(sameChatSources(before.chat, current.chat), 'Synthetic EOF/recovery must leave every canonical Chat API field unchanged');
      assert.ok(isDeepStrictEqual(before.financial, current.financial), 'Synthetic EOF/recovery must leave the complete sampled financial sources unchanged');
      assert.ok(truncatedBubbles(originalUi.bubbles, actual.bubbles), 'Keep all four old bubbles and the exact new question/partial reply');
      assert.equal(actual.input.value, expectedInput); assert.equal(actual.input.disabled, false); assert.equal(actual.thinking, false);
      assert.equal(requests.length, requestOffset + 1); assert.ok(truncatedTransport(requests.slice(requestOffset), frozen, eofFault.diagnostic));
      return actual;
    }
    await save('truncated-declaration', { contract: TRUNCATED, originalUi, originalSources: before, network: eofNetwork(), scope: 'Current-page synthetic partial SSE with normal EOF and no DONE. Native UI only; no upstream-provider claim, no history clearing and no resend.' });
    await fill(page, INPUT, TRUNCATED.original); await read(INPUT, 'truncated-original-input', TRUNCATED.original); await read(SEND, 'truncated-explicit-send');
    eofFault = await installChatTruncatedResponse(page, frozen);
    actions.push({ kind: 'chat-single-exact-synthetic-eof-installed', ...frozen, syntheticClientTransport: true });
    const sendActionStartedAt = Date.now(); actions.push({ kind: 'chat-truncated-explicit-send-start', at: sendActionStartedAt });
    await pointer(page, SEND);
    await until(() => requests.length > requestOffset && (requests[requestOffset].finished.length || requests[requestOffset].failures.length), 'Synthetic EOF request did not finish');
    const sent = requests[requestOffset];
    if (sent.bodyResult) await bounded(sent.bodyResult, 'Synthetic EOF body could not be read');
    await save('truncated-response-network', { ...eofNetwork(), sendActionStartedAt });
    await eofFault.release(); actions.push({ kind: 'chat-single-exact-synthetic-eof-released', at: Date.now(), noResend: true });
    assert.ok(truncatedTransport(requests.slice(requestOffset), frozen, eofFault.diagnostic), 'Require the declared synthetic 200/body, normal requestfinished, zero requestfailed and exactly one intercepted POST');
    await page.waitForFunction(selector => { const el = document.querySelector(selector); return el && !el.disabled && el.value === '' && ![...document.querySelectorAll('main p')].some(node => node.textContent === '正在思考...'); }, { timeout: 7000 }, INPUT);
    await preserved('released', '');
    for (const index of [originalUi.bubbles.length, originalUi.bubbles.length + 1]) await read(await bubbleSelector(index), `truncated-reply-bubble-${index}`);
    const entry = await editEntry(TRUNCATED.original);
    await save('truncated-edit-entry', { entry, ui: await ui(), notification: await notificationState(), network: eofNetwork() });
    if (entry.count !== 1 || entry.disabled || entry.statusCount !== 1 || !entry.statusSelector) {
      firstFailureSaved = true;
      await observe(page, `${prefix}-truncated-reply-incomplete-feedback`, false, JSON.stringify({ entry, stoppedAt: 'No unique usable incomplete feedback/edit entry for the exact truncated question. Recovery was not executed.' }));
      await save('truncated-first-failure', { classification: 'product-missing-incomplete-feedback-or-edit-entry', entry, ui: await ui(), network: eofNetwork() });
      await preserved('missing-entry-stop', '');
      return;
    }
    const statusReading = await read(entry.statusSelector, 'truncated-incomplete-status');
    assert.equal(statusReading.text, '回复未完成', 'Actual status reading must match this question, not an earlier text observation');
    await read(entry.selector, 'truncated-edit-entry');
    await pointer(page, entry.selector);
    // Only the actual message control may restore C. Never fill C here.
    const notificationsBefore = await notificationState();
    await save('truncated-notifications-before-reading', { notification: notificationsBefore, scope: 'Painted notification cards can cover an input even with pointer-events:none; no product feedback is removed' });
    await capture(page, `${prefix}-truncated-notifications-before-reading`);
    const mustWait = notificationsBefore.cards.some(card => card.painted && card.overlapsInput), waitStartedAt = Date.now();
    let waitError = null;
    try { if (mustWait) await page.waitForFunction(selector => {
        const input = document.querySelector(selector).getBoundingClientRect();
        return [...document.querySelectorAll('[aria-label="通知"] button[aria-label="关闭提示"]')].every(button => {
          const card = button.parentElement, rect = card.getBoundingClientRect(), css = getComputedStyle(card);
          const painted = rect.width > 0 && rect.height > 0 && css.display !== 'none' && css.visibility === 'visible' && Number(css.opacity) > 0;
          return !painted || !(rect.left < input.right && rect.right > input.left && rect.top < input.bottom && rect.bottom > input.top);
        });
      }, { timeout: 5000 }, INPUT); }
    catch (error) { waitError = error.message; }
    const notificationsAfter = await notificationState(), waitFinishedAt = Date.now(), elapsedMs = waitFinishedAt - waitStartedAt;
    await save('truncated-notifications-after-reading-wait', { notification: notificationsAfter, mustWait, waitStartedAt, waitFinishedAt, elapsedMs, hardLimitMs: 5000, waitError, condition: 'Only an actual painted notification/input overlap triggers bounded native expiry; no fixed sleep, hit-test shortcut or dismissal' });
    await capture(page, `${prefix}-truncated-notifications-after-reading-wait`);
    assert.ok(!waitError && (!mustWait || elapsedMs <= 5000), 'Notification observation exceeded its hard deadline; no late success credit');
    assert.ok(!notificationsAfter.cards.some(card => card.painted && card.overlapsInput), 'An actual painted notification still covers the input');
    await read(INPUT, 'truncated-restored-original', TRUNCATED.original);
    const restoredUi = await preserved('restored-final', TRUNCATED.original);
    assert.equal(await page.$('[role=dialog]'), null, 'An empty input restores directly without inventing a conflict choice');
    const restoredEntry = await editEntry(TRUNCATED.original);
    assert.equal(restoredEntry.count, 1); assert.equal(restoredEntry.disabled, false); assert.equal(restoredEntry.statusCount, 1);
    await observe(page, `${prefix}-truncated-reply-restored-without-send`, true, JSON.stringify({ ui: restoredUi, previousPostCount: requestOffset, addedPostCount: 1, totalPostCount: requests.length, originalSourceUnchanged: true, syntheticClientTransport: true }));
  }
  await segment(page, prefix, async () => {
    page.on('request', onRequest); page.on('requestfailed', onFailed); page.on('response', onResponse); page.on('requestfinished', onFinished);
    try {
      // The existing terminal receipt is immersive and has no regular nav.
      await pointer(page, 'button', '回到首页'); await h.waitPath(page, '/');
      await openPage(page, '/coach'); await page.waitForSelector(INPUT);
      const originalUi = await ui(), before = await sources('frozen');
      await save('declaration', { contract: CONTRACT, originalUi, frozenRequest, originalSessionIds: before.chat.rawSessions.sessions.map(row => row.id), boundary: 'The unchanged earlier reload clears current in-memory chat. Four original financial prompts remain as canonical API history; the current page begins empty. No successful setup send or store/session injection.' });
      assert.deepEqual(originalUi.bubbles, []); assert.equal(originalUi.input.value, ''); assert.equal(originalUi.input.disabled, false);
      assert.equal(before.chat.rawSessions.sessions.length, 1, 'Exactly the existing financial session must precede this task');
      const oldMessages = Object.values(before.chat.rawMessages)[0].messages;
      assert.equal(oldMessages.length, 8, 'All four earlier financial questions and replies remain canonical');
      assert.deepEqual(oldMessages.filter(row => row.role === 'user').map(row => row.content), [...expenseSummaryChecks.questions, ...expenseSummaryChecks.questions].map(row => row.message));
      assert.equal(requests.length, 0);
      await fill(page, INPUT, CONTRACT.original); await read(INPUT, 'original-input', CONTRACT.original); await read(SEND, 'original-send');
      fault = await installChatRecoveryAbort(page, frozenRequest);
      actions.push({ kind: 'chat-single-exact-request-abort-installed', ...frozenRequest, boundary: 'No offline mode; all other requests continue' });
      await pointer(page, SEND);
      await until(() => requests.some(row => row.failures.length), 'Actual chat requestfailed not observed');
      await page.waitForFunction(selector => { const el = document.querySelector(selector); return el && !el.disabled && el.value === '' && ![...document.querySelectorAll('main p')].some(node => node.textContent === '正在思考...'); }, { timeout: 7000 }, INPUT);
      const failedUi = await ui();
      await save('original-failure-network', network()); await save('original-failure-ui', { ui: failedUi });
      assert.equal(requests.length, 1); assert.ok(exactFailureRequest(requests[0], frozenRequest));
      assert.equal(requests[0].failures.length, 1); assert.ok(requests[0].failures[0].errorText); assert.equal(requests[0].responses.length, 0);
      assert.equal(fault.diagnostic.matches, 1); assert.equal(fault.diagnostic.aborted, 1); assert.deepEqual(fault.diagnostic.errors, []);
      assert.equal(failedUi.bubbles.length, 2); assert.deepEqual(failedUi.bubbles[0], { role: 'user', content: CONTRACT.original });
      assert.equal(failedUi.bubbles[1].role, 'assistant'); assert.match(failedUi.bubbles[1].content, /网络|中断|未完成/); assert.match(failedUi.bubbles[1].content, /重试|编辑|找回/);
      for (const index of [0, 1]) await read(await bubbleSelector(index), `original-failure-bubble-${index}`);
      await read(INPUT, 'empty-enabled-input', '');
      await observe(page, `${prefix}-actual-rejected-reply-retained`, true, JSON.stringify({ ui: failedUi, semanticBoundary: 'This exact pre-delivery abort had no response. General chat failures can occur after the server saves the user row; do not describe all failures as unsent.' }));
      await fault.release(); actions.push({ kind: 'chat-single-exact-request-abort-released', at: Date.now(), noResend: true });
      await noWrites(before, 'released', failedUi.bubbles, '');
      await fill(page, INPUT, CONTRACT.otherDraft); await read(INPUT, 'different-unsent-draft', CONTRACT.otherDraft);
      await noWrites(before, 'different-draft', failedUi.bubbles, CONTRACT.otherDraft);
      const entry = await editEntry();
      await save('edit-entry', { entry, ui: await ui(), network: network() });
      if (entry.count !== 1 || entry.disabled) {
        firstFailureSaved = true;
        await observe(page, `${prefix}-original-message-edit-entry`, false, JSON.stringify({ entry, requiredVisibleText: CONTRACT.edit, unsentDraft: CONTRACT.otherDraft, stoppedAt: 'Original failed message has no usable recovery entry; choices, recovery, editing and second Send were not executed' }));
        await save('first-failure', { stage: 'missing-original-message-edit-entry', ui: await ui(), network: network() });
        await noWrites(before, 'missing-entry-stop', failedUi.bubbles, CONTRACT.otherDraft);
        return;
      }
      await read(entry.selector, 'edit-entry'); await pointer(page, entry.selector);
      await page.waitForSelector('[role=dialog]');
      await noWrites(before, 'choice-open', failedUi.bubbles, CONTRACT.otherDraft);
      const keep = await dialogControl(CONTRACT.keep, 'keep-choice'); await dialogControl(CONTRACT.replace, 'replace-choice');
      await pointer(page, keep); await page.waitForSelector('[role=dialog]', { hidden: true });
      await noWrites(before, 'cancel-keeps-new-draft', failedUi.bubbles, CONTRACT.otherDraft); await read(INPUT, 'cancelled-draft', CONTRACT.otherDraft);
      const again = await editEntry(); assert.equal(again.count, 1); await read(again.selector, 'reopen-edit-entry'); await pointer(page, again.selector);
      await page.waitForSelector('[role=dialog]'); await noWrites(before, 'choice-reopened', failedUi.bubbles, CONTRACT.otherDraft);
      await pointer(page, await dialogControl(CONTRACT.replace, 'explicit-replace-choice')); await page.waitForSelector('[role=dialog]', { hidden: true });
      // Never fill original A here. Only the real recovery control may restore it.
      await noWrites(before, 'original-restored-by-control', failedUi.bubbles, CONTRACT.original); await read(INPUT, 'restored-original', CONTRACT.original);
      await fill(page, INPUT, CONTRACT.edited); await read(INPUT, 'edited-original', CONTRACT.edited); await noWrites(before, 'edited-before-send', failedUi.bubbles, CONTRACT.edited);
      await read(SEND, 'explicit-retry-send');
      const sendActionStartedAt = Date.now();
      actions.push({ kind: 'chat-explicit-retry-send-start', at: sendActionStartedAt });
      await pointer(page, SEND);
      await until(() => requests.length >= 2 && (requests[1].responses.length || requests[1].failures.length), 'Explicit edited Send response not observed');
      assert.equal(requests.length, 2); const sent = requests[1];
      assert.equal(sent.body, JSON.stringify({ message: CONTRACT.edited })); assert.deepEqual(sent.failures, []); assert.equal(sent.responses.length, 1);
      const response = await bounded(sent.bodyResult, 'Edited reply SSE incomplete');
      await save('explicit-retry-network', network());
      assert.equal(response.status, 200); assert.ok(!response.error); assert.match(response.contentType, /^text\/event-stream;\s*charset=utf-8$/i);
      const completed = expenseSummaryChecks.completeRuleSse(response.text);
      await page.waitForFunction(selector => { const el = document.querySelector(selector); return el && !el.disabled && el.value === ''; }, { timeout: 7000 }, INPUT);
      for (const index of [0, 1, 2, 3]) await read(await bubbleSelector(index), `recovered-bubble-${index}`);
      const after = await sources('recovered'), recoveredUi = await ui(), request = { sendActionStartedAt, requestObservedAt: sent.startedAt, finishedAt: Date.now(), sessionId: response.sessionId };
      await save('recovered-state', { ui: recoveredUi, completed, request });
      assert.ok(recoveredChatSources(before.chat, after.chat, completed, request), 'Exactly one new canonical session and its user/assistant pair; all original rows unchanged');
      assert.ok(recoveredBubbles(failedUi.bubbles, recoveredUi.bubbles, completed), 'The original failure bubbles must remain the exact UI prefix');
      await financial.preserve(before.financial, after.financial, 'chat-recovery-final');
      assert.equal(requests.length, 2); assert.equal(recoveredUi.thinking, false);
      await observe(page, `${prefix}-explicit-edited-reply-complete`, true, JSON.stringify({ request, originalFailurePreserved: true, requestCount: requests.length, completedSource: completed.source, scope: 'Current page first-question failure only; no reload, account switch or persisted draft recovery claim' }));
      // Preserve the original two-request terminal record before the new tail.
      await save('terminal-network', network()); truncationStarted = true;
      await truncatedReply(after, recoveredUi, response.sessionId);
    } catch (error) {
      if (!firstFailureSaved) {
        firstFailureSaved = true;
        await capture(page, `${prefix}-first-failure`).catch(() => undefined);
        await save(truncationStarted ? 'truncated-first-failure' : 'first-failure', { error: error.message, network: network(), syntheticEofFault: eofFault?.diagnostic ?? null, ui: await ui().catch(() => null) });
        await sources(truncationStarted ? 'truncated-first-failure' : 'first-failure').catch(sourceError => save('first-failure-source-blocked', { error: sourceError.message }));
      }
      throw error;
    } finally {
      try { await fault?.release(); await eofFault?.release(); }
      finally {
        page.off('request', onRequest); page.off('requestfailed', onFailed); page.off('response', onResponse); page.off('requestfinished', onFinished);
        await save(truncationStarted ? 'truncated-terminal-network' : 'terminal-network', { ...network(), ...(truncationStarted ? { syntheticEofFault: eofFault?.diagnostic ?? null, previousPostCount: 2, addedPostCount: requests.length - 2, totalPostCount: requests.length, boundary: 'Original two requests plus exactly one synthetic client EOF response; its 200 is not backend success' } : {}) });
      }
    }
  });
}
