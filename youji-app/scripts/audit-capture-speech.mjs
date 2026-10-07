// Hosted-CI tail only: synthetic recognition callbacks, native product controls,
// and the existing complete read-only source audit. No audio or ASR service.
import assert from 'node:assert/strict';
import { isDeepStrictEqual as equal } from 'node:util';
import { captureReturnChecks as checks } from './audit-capture-return-outcomes.mjs';

const A = '明天交报销单；', B = '午饭15元；合成语音尾句', RAW = A + B;
const COMPOSER = '[data-component="capture-composer"]', REVIEW = '[data-component="capture-review"]';
const field = label => `${REVIEW} [aria-label="${label}"]`;

function expectedDraft(id, inputKey, context, actor) {
  assert.equal(context.date, '2026-10-06'); assert.equal(context.timeZone, 'Asia/Shanghai'); assert.ok(Number.isSafeInteger(context.capturedAt));
  // Parsed fields are literal, never calculated by importing the app parser or
  // copied from the observed draft. Only frozen source/actor metadata and ID vary.
  return { id, inputKey, input: RAW, context, ownerId: actor.ownerId, dataEpoch: actor.dataEpoch, sessionRevision: actor.sessionRevision, sessionActive: actor.sessionActive,
    expenses: [{ id: 'exp-0', name: '午饭', amount: 1500, category: 'food', confirmed: true, date: '2026-10-06', currency: 'CNY', isIncome: false }],
    todos: [{ id: 'todo-0', text: '交报销单', confirmed: true, dueDate: '2026-10-07', dateUncertain: false }],
    habits: [], diary: '合成语音尾句', diaryDate: '2026-10-06', mood: null, moodScore: null, moodConfirmed: false };
}
function reviewExactly(before, after, expected) {
  const key = expected.inputKey;
  return typeof expected.id === 'string' && expected.id.length > 0 && typeof key === 'string' && key.startsWith('capture-input:') && expected.input === RAW &&
    equal(checks.setting(before, key), { key, value: A }) && equal(checks.setting(before, `${key}:context`), { key: `${key}:context`, value: expected.context }) &&
    !checks.setting(before, `capture-review:${expected.id}`) && !checks.setting(before, `capture-source:${expected.id}`) && !checks.setting(before, `capture-applied:${expected.id}`) && !before.local.quickNotes.some(row => row.id === expected.id) &&
    checks.draftBound(after, expected.id, expected) && checks.preserved(before, after, { writes: { [key]: RAW, [`capture-review:${expected.id}`]: expected, quicknote_review: expected } });
}
function timedEvents(value) {
  return value?.kind === 'synthetic-stop-final-end' && value.finalText === B && Number.isFinite(value.observedAt) && Array.isArray(value.events) && value.events.every((event, index) =>
    event.sequence === index + 1 && event.instance === 1 && Number.isFinite(event.at) && event.at <= value.observedAt && (!index || event.at >= value.events[index - 1].at));
}
function preSubmitExactly(value) {
  return timedEvents(value) && value.instances === 1 && equal(value.events.map(event => event.kind), ['construct', 'start']) &&
    equal(value.events[1].configuration, { lang: 'zh-CN', continuous: true, interimResults: true, resultHandler: true, endHandler: true, errorHandler: true });
}
function eventsExactly(before, after) {
  if (!preSubmitExactly(before) || !timedEvents(after) || after.instances !== 1 || !equal(after.events.slice(0, 2), before.events) ||
    !equal(after.events.map(event => event.kind), ['construct', 'start', 'stop', 'stop-return', 'result', 'result-return', 'end', 'end-return']) || after.events[2].at < before.observedAt) return false;
  return equal(after.events[4].result, { resultIndex: 0, results: [{ isFinal: true, transcript: B }], callbackPresent: true }) && after.events[6].callbackPresent === true;
}
export const captureSpeechChecks = { A, B, RAW, expectedDraft, reviewExactly, preSubmitExactly, eventsExactly };

// Serialized by page.evaluate. Restores the exact prior own descriptors, also
// preserving absence (and therefore any inherited browser implementation).
export function installCaptureSpeechFixture({ finalText }) {
  const target = globalThis, names = ['SpeechRecognition', 'webkitSpeechRecognition'];
  if (Object.hasOwn(target, '__captureSpeechFixture') || Object.hasOwn(target, '__releaseCaptureSpeechFixture')) throw new Error('Synthetic speech fixture already installed');
  const originals = names.map(name => Object.getOwnPropertyDescriptor(target, name));
  if (originals.some(value => value && !value.configurable)) throw new Error('Cannot temporarily replace nonconfigurable recognition');
  const events = [], timers = new Set(); let instances = 0, restored = false;
  const record = (kind, instance, extra = {}) => events.push({ sequence: events.length + 1, kind, instance, at: performance.now(), ...extra });
  const snapshot = () => ({ kind: 'synthetic-stop-final-end', finalText, instances, events: events.map(event => ({ ...event })), observedAt: performance.now(), restored });
  class SyntheticSpeechRecognition extends EventTarget {
    constructor() { super(); this.instance = ++instances; this.onresult = null; this.onend = null; this.onerror = null; record('construct', this.instance); }
    start() { record('start', this.instance, { configuration: { lang: this.lang, continuous: this.continuous, interimResults: this.interimResults, resultHandler: typeof this.onresult === 'function', endHandler: typeof this.onend === 'function', errorHandler: typeof this.onerror === 'function' } }); }
    stop() {
      record('stop', this.instance);
      const timer = setTimeout(() => {
        timers.delete(timer);
        record('result', this.instance, { result: { resultIndex: 0, results: [{ isFinal: true, transcript: finalText }], callbackPresent: typeof this.onresult === 'function' } });
        this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: finalText }], { isFinal: true })] });
        record('result-return', this.instance); record('end', this.instance, { callbackPresent: typeof this.onend === 'function' }); this.onend?.(); record('end-return', this.instance);
      }, 0);
      timers.add(timer); record('stop-return', this.instance);
    }
    abort() { record('abort', this.instance); }
  }
  const sameDescriptor = (a, b) => a === undefined || b === undefined ? a === b : Reflect.ownKeys(a).length === Reflect.ownKeys(b).length && Reflect.ownKeys(a).every(key => Object.hasOwn(b, key) && Object.is(a[key], b[key]));
  const release = () => {
    const pendingTimers = timers.size; for (const timer of timers) clearTimeout(timer); timers.clear();
    names.forEach((name, index) => { if (originals[index]) Object.defineProperty(target, name, originals[index]); else delete target[name]; });
    restored = names.every((name, index) => sameDescriptor(Object.getOwnPropertyDescriptor(target, name), originals[index]));
    const result = { ...snapshot(), pendingTimers, descriptorRestoration: names.map((name, index) => ({ name, originallyOwn: originals[index] !== undefined, exact: sameDescriptor(Object.getOwnPropertyDescriptor(target, name), originals[index]) })) };
    delete target.__captureSpeechFixture; delete target.__releaseCaptureSpeechFixture; return result;
  };
  Object.defineProperty(target, '__captureSpeechFixture', { configurable: true, value: { snapshot } });
  Object.defineProperty(target, '__releaseCaptureSpeechFixture', { configurable: true, value: release });
  try { for (const name of names) Object.defineProperty(target, name, { configurable: true, writable: true, value: SyntheticSpeechRecognition }); }
  catch (error) { release(); throw error; }
  return snapshot();
}

export async function runCaptureSpeechTail(h) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Capture speech native evidence runs only in authorized hosted CI');
  const { page, label, current, before, returnComposer, facts, preserve, read, readValue, tap, input, retained, save, observe, mark, waitPath, capture } = h;
  mark('speech-return-from-D'); assert.ok(checks.draftBound(before, current.id, current));
  const { frozen, fork } = await returnComposer(before, current, 'speech-from-D'); assert.deepEqual(fork.context, current.context);
  await input(`${COMPOSER} textarea[aria-label="速记内容"]`, A);
  await page.waitForFunction(() => document.querySelector('[data-component="capture-composer"] [role=status]')?.textContent === '原文已保留在本机', { timeout: 7000 });
  const typed = await facts('speech-typed-A'); await preserve(frozen, typed, 'speech-only-current-raw-A', { writes: { [fork.key]: A } });
  let installed = false, preSubmit, opened, expected, released;
  try {
    await page.evaluate(installCaptureSpeechFixture, { finalText: B }); installed = true;
    await tap(`${COMPOSER} button`, '语音输入'); await tap(`${COMPOSER} button`, '开始语音输入');
    const recording = await read(`${COMPOSER} button`, '停止录音'); await readValue(`${COMPOSER} textarea`, A, 'speech-recording-still-A');
    const armed = await facts('speech-recording-before-submit'); await preserve(typed, armed, 'speech-start-preserves-all');
    preSubmit = await page.evaluate(() => globalThis.__captureSpeechFixture.snapshot()); await save('speech-before-native-submit', { syntheticOnly: true, recording, fixture: preSubmit });
    assert.ok(preSubmitExactly(preSubmit), 'Exactly one synthetic recognition has started; no stop/result/end is delivered before submission');
    mark('speech-native-view-review-stops-recording'); await tap(`${COMPOSER} button`, '查看确认稿'); await waitPath(page, '/quick-note/result'); await retained();
    const trace = await page.evaluate(() => globalThis.__captureSpeechFixture.snapshot()); await save('speech-after-native-submit', { syntheticOnly: true, preSubmit, fixture: trace });
    assert.ok(eventsExactly(preSubmit, trace), 'The native submission must call stop once, receive its next-task final B, then end on that same instance');
    const id = new URL(page.url()).searchParams.get('draft'); assert.ok(id && id !== current.id); expected = expectedDraft(id, fork.key, fork.context, current);
    opened = await facts('speech-review-full-literal', { extra: { syntheticSpeech: trace, expected } });
    const pass = reviewExactly(armed, opened, expected); await observe(page, `${label}-speech-exact-new-review`, pass, 'Expected complete literal A+B review and exact source key/context; all old reviews, business tables, settings and complete ledger preserved');
    assert.ok(pass, 'Missing tail or undeclared source changes cannot pass as a speech review');
    await preserve(armed, opened, 'speech-only-final-raw-and-new-review', { writes: { [fork.key]: RAW, [`capture-review:${id}`]: expected, quicknote_review: expected } });
    await read(`${REVIEW} p`, '日期基准：2026-10-06 · Asia/Shanghai。各项实际写入日期如下，可以逐项修改。');
    const currency = await read(`${REVIEW} label`, '人民币 CNY（元）');
    await observe(page, `${label}-speech-visible-currency`, true, JSON.stringify(currency));
    for (const [name, value] of [['第1笔收支名称', '午饭'], ['第1笔金额（人民币元）', '15'], ['第1笔记录日期', '2026-10-06'], ['第1笔收支方向', 'expense'], ['第1笔分类', 'food'], ['第1个待办内容', '交报销单'], ['第1个待办截止日期', '2026-10-07'], ['日记内容', '合成语音尾句'], ['日记日期', '2026-10-06']]) await readValue(field(name), value, `speech-${name}`);
    const selections = [];
    for (const [name, checked] of [['记录第1笔收支', true], ['记录第1个待办', true], ['将这段文字记入日记', true], ['我愿意记录这次心情', false]]) {
      const selector = field(name), actual = await page.$eval(selector, el => ({ checked: el.checked, labelSelector: `label[for="${CSS.escape(el.id)}"]` }));
      assert.equal(actual.checked, checked); selections.push({ name, checked, paintedLabel: await read(actual.labelSelector) });
    }
    await tap(`${REVIEW} summary`, '查看原文与本机确认稿'); const raw = await read(`${REVIEW} details[open] > p`); assert.equal(raw.text, RAW);
    await observe(page, `${label}-speech-readable-full-original`, true, JSON.stringify({ raw, selections, id })); await tap(`${REVIEW} summary`, '查看原文与本机确认稿');
    const scope = await read(field('本次保存范围')); assert.equal(scope.text, '原文 + 1 笔收支 · 1 个待办 · 记入日记 · 不记录情绪'); await retained();
    await capture(page, `${label}-speech-uncommitted-review`);
  } finally {
    if (installed) {
      released = await page.evaluate(() => globalThis.__releaseCaptureSpeechFixture());
      await save('speech-fixture-final-diagnostics', { syntheticOnly: true, preSubmit: preSubmit ?? null, fixture: released, boundaries: 'Synthetic callbacks only; no microphone, audio accuracy or real ASR evidence. No business Save. Earlier O/R/D retention is physical, not a rediscovery UI claim.' });
      assert.ok(released.restored && released.descriptorRestoration.every(row => row.exact), 'Both recognition property descriptors must be restored exactly');
    }
  }
  assert.ok(eventsExactly(preSubmit, released) && released.pendingTimers === 0, 'All callbacks must have finished before fixture restoration');
  const end = await facts('speech-final-after-reading-and-restoration'); await preserve(opened, end, 'speech-reading-and-fixture-restoration-preserve-all');
  assert.ok(checks.draftBound(end, expected.id, expected));
  const pointers = await page.evaluate(owner => ({ input: sessionStorage.getItem(`youtrace:input:${owner}`), review: sessionStorage.getItem(`youtrace:active-review:${owner}`) }), current.ownerId);
  assert.deepEqual(pointers, { input: fork.key, review: expected.id });
  await save('speech-outcome', { syntheticOnly: true, expected, pointers, oldDraftsPhysicallyRetained: true, currentDraftUncommitted: true, exactDescriptorsRestored: true });
  return { draft: expected, facts: end };
}
