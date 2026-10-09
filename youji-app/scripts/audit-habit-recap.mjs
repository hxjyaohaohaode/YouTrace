// Two read-only checkpoints in the existing Y5 journey. No new fixture or app writes.
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';

const TODAY = '2026-10-07', TUESDAY = '2026-10-06', MONDAY = '2026-10-05';
const validVersion = value => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
const same = (a, b) => isDeepStrictEqual(a, b);
const ordered = rows => [...rows].sort((a, b) => String(a.id ?? a.key).localeCompare(String(b.id ?? b.key)));
const relevantSettings = rows => rows.filter(row => /^(?:sync-version|sync-conflict):(?:habits|habitCheckins):/.test(row.key) || row.key === 'localDataEpoch');
const shanghai = instant => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(instant));

function recordedFacts(habits, checkins, date) {
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(date) && new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date);
  const parents = new Set(habits.map(row => row.id));
  const ids = [...new Set(checkins.filter(row => parents.has(row.habitId) && row.date === date && row.done === true).map(row => row.habitId))].sort();
  return { reviewDate: date, done: ids.length, habitIds: ids };
}
function currentRows(events, entity) {
  const rows = new Map(); let previous = 0n;
  for (const event of events) {
    assert.ok(validVersion(event.seq) && BigInt(event.seq) > previous, 'Strict complete ledger sequence required'); previous = BigInt(event.seq);
    if (event.entity !== entity) continue;
    assert.ok(['upsert', 'delete'].includes(event.operation));
    if (event.operation === 'delete') rows.delete(event.entityId);
    else {
      assert.ok(event.data && typeof event.data === 'object');
      assert.equal(event.entityId, entity === 'habitCheckins' ? `${event.data.habitId}|${event.data.date}` : event.data.id);
      rows.set(event.entityId, event);
    }
  }
  return [...rows.values()];
}
function assertSources(source, { target, neighbor, phase, ownerId }) {
  assert.ok(['recorded', 'undone'].includes(phase));
  const { local, server, events } = source, parents = currentRows(events, 'habits'), pairs = currentRows(events, 'habitCheckins');
  const ids = [target.id, neighbor.id].sort(); assert.equal(new Set(ids).size, 2);
  for (const rows of [local.habits, server, parents.map(row => row.data)]) assert.deepEqual(rows.map(row => row.id).sort(), ids, 'Exactly the two original parents required');
  assert.equal(local.outbox.length, 0, 'Every native operation must be acknowledged');
  assert.ok(!local.settings.some(row => /^sync-conflict:(?:habits|habitCheckins):/.test(row.key)), 'No unresolved habit conflict');
  const version = (entity, id) => local.settings.find(row => row.key === `sync-version:${entity}:${id}`)?.value;
  for (const original of [target, neighbor]) {
    const event = parents.find(row => row.entityId === original.id), row = local.habits.find(row => row.id === original.id), remote = server.find(row => row.id === original.id);
    assert.equal(event.data.userId, ownerId, 'Canonical parent must belong to the authenticated synthetic owner');
    assert.equal(version('habits', original.id), event.seq, 'Exact parent ACK required');
    assert.equal(original.frequency, 'weekly');
    for (const key of ['id', 'name', 'icon', 'frequency', 'sortOrder']) for (const actual of [row, remote, event.data]) assert.deepEqual(actual[key], original[key], `Original parent ${key} must agree`);
  }
  const expectedPairs = [{ habitId: target.id, date: TUESDAY, done: phase === 'recorded' }, { habitId: neighbor.id, date: MONDAY, done: true }, ...(phase === 'undone' ? [{ habitId: target.id, date: MONDAY, done: true }] : [])];
  const keys = expectedPairs.map(row => `${row.habitId}|${row.date}`).sort();
  assert.deepEqual(local.habitCheckins.map(row => row.id).sort(), keys, 'Exact original local pairs, including false undo');
  assert.deepEqual(pairs.map(row => row.entityId).sort(), keys, 'Exact canonical pairs, with no extra date or parent');
  for (const expected of expectedPairs) {
    const id = `${expected.habitId}|${expected.date}`, row = local.habitCheckins.find(row => row.id === id), event = pairs.find(row => row.entityId === id);
    assert.equal(version('habitCheckins', id), event.seq, 'Each pair needs its own exact ACK');
    for (const actual of [row, event.data]) {
      for (const key of ['habitId', 'date', 'done']) assert.equal(actual[key], expected[key]);
      assert.equal(actual.source, 'manual'); assert.equal(actual.confirmed, true);
    }
  }
  const expected = recordedFacts(local.habits, local.habitCheckins, TUESDAY);
  assert.deepEqual(expected, recordedFacts(parents.map(row => row.data), pairs.map(row => row.data), TUESDAY));
  assert.equal(expected.done, phase === 'recorded' ? 1 : 0);
  // This fixture has two explicitly unchanged weekly plans. It does not infer
  // a historical denominator or introduce historical frequency semantics.
  assert.ok(ids.every(id => pairs.some(row => row.data.habitId === id && row.data.done === true && row.data.date >= MONDAY && row.data.date <= TODAY)));
  return { ...expected, currentWeek: { done: 2, total: 2, from: MONDAY, through: '2026-10-11' } };
}
function sourcesPreserved(before, after) {
  return ['habits', 'habitCheckins', 'outbox'].every(table => same(before.local[table], after.local[table])) && same(relevantSettings(before.local.settings), relevantSettings(after.local.settings)) && same(before.server, after.server) && same(before.events, after.events);
}
function undoTransition(recorded, undone, targetId) {
  const targetTuesday = `${targetId}|${TUESDAY}`, targetMonday = `${targetId}|${MONDAY}`;
  const added = undone.events.slice(recorded.events.length), oldTuesday = currentRows(recorded.events, 'habitCheckins').find(row => row.entityId === targetTuesday)?.data;
  const unchangedFields = (before, after) => before && after && [...new Set([...Object.keys(before), ...Object.keys(after)])].every(key => ['done', 'updatedAt'].includes(key) || Object.hasOwn(before, key) === Object.hasOwn(after, key) && same(before[key], after[key]));
  const exactUndo = (before, after, canonical = false) => {
    const timestamp = value => canonical ? typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value : Number.isSafeInteger(value) && value > 0;
    return unchangedFields(before, after) && before.done === true && after.done === false && timestamp(before.updatedAt) && timestamp(after.updatedAt) && (canonical ? Date.parse(after.updatedAt) >= Date.parse(before.updatedAt) : after.updatedAt >= before.updatedAt);
  };
  return same(recorded.local.habits, undone.local.habits) && same(recorded.events, undone.events.slice(0, recorded.events.length)) &&
    added.length === 2 && added.every((event, index) => event.entity === 'habitCheckins' && event.entityId === (index === 0 ? targetMonday : targetTuesday) && event.operation === 'upsert' && event.data.done === (index === 0)) &&
    exactUndo(recorded.local.habitCheckins.find(row => row.id === targetTuesday), undone.local.habitCheckins.find(row => row.id === targetTuesday)) && exactUndo(oldTuesday, added[1].data, true) &&
    recorded.local.habitCheckins.filter(row => row.id !== targetTuesday).every(row => same(row, undone.local.habitCheckins.find(next => next.id === row.id)));
}
function responseAttributed(brief, expected, before, after, clock) {
  const valid = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
  return valid(brief?.generatedAt) && valid(before?.instant) && valid(after?.instant) && same(before.config, clock) && same(after.config, clock) &&
    shanghai(before.instant) === TODAY && shanghai(after.instant) === TODAY && shanghai(brief.generatedAt) === TODAY &&
    Date.parse(brief.generatedAt) >= Date.parse(before.instant) - 1500 && Date.parse(brief.generatedAt) <= Date.parse(after.instant) + 1500 &&
    brief.reviewDate === expected.reviewDate;
}
function responseMatches(brief, expected, before, after, clock) {
  return responseAttributed(brief, expected, before, after, clock) && Number.isSafeInteger(brief.yesterdayReview?.habits?.done) && brief.yesterdayReview.habits.done === expected.done;
}
function readingMatches(fields, expected, brief, responseBound) {
  const text = fields.habits?.text ?? '', tokens = [...text.matchAll(/该日记为已打卡的习惯\s*(0|[1-9]\d*)\s*项(?![\p{L}\p{N}_])/gu)];
  const generatedMinute = typeof brief?.generatedAt === 'string' && Number.isFinite(Date.parse(brief.generatedAt)) ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(brief.generatedAt)) : null;
  return responseBound && ['date', 'provenance', 'habits'].every(key => fields[key]?.visible) && fields.date.text.trim() === `${expected.reviewDate} 记录回顾` &&
    fields.provenance.text.startsWith('云端已同步记录') && generatedMinute !== null && fields.provenance.text.includes(generatedMinute) &&
    tokens.length === 1 && tokens[0][1] === String(expected.done) && !/习惯完成|\d\s*[/／]\s*\d|未完成|失败|达成率/.test(text);
}
export const habitRecapChecks = { recordedFacts, assertSources, sourcesPreserved, undoTransition, responseAttributed, responseMatches, readingMatches };

// Executed inside the page before the Puppeteer JSON boundary. This deliberately
// supports only plain structured values, with an explicit own-undefined tag.
// Unsupported shapes stop the source proof; no full-DB/lossless claim is made.
export function readHabitRecapLocal(owner) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(`youtrace:user:${owner}:schedule-v1`);
    request.onupgradeneeded = () => { request.transaction.abort(); reject(new Error('Expected existing habit account DB')); };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      try {
        const tables = ['habits', 'habitCheckins', 'settings', 'outbox', 'coachInsights', 'coachPushes'], tx = db.transaction(tables, 'readonly'), result = {};
        for (const table of tables) { const read = tx.objectStore(table).getAll(); read.onsuccess = () => { result[table] = read.result; }; }
        tx.oncomplete = () => {
          db.close();
          try {
            const seen = new Set();
            const encode = value => {
              if (value === undefined) return { __habitRecapUndefined: true };
              if (value === null || ['string', 'boolean'].includes(typeof value)) return value;
              if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) return value;
              if (!value || typeof value !== 'object' || seen.has(value)) throw new Error('Unsupported cyclic or aliased habit source value');
              seen.add(value); const keys = Reflect.ownKeys(value);
              if (Array.isArray(value)) {
                if (keys.length !== value.length + 1 || !Array.from({ length: value.length }, (_, index) => index).every(index => Object.hasOwn(value, index))) throw new Error('Unsupported sparse or extended habit source array');
                return value.map(encode);
              }
              if (Object.getPrototypeOf(value) !== Object.prototype || Object.hasOwn(value, '__habitRecapUndefined') || keys.some(key => typeof key !== 'string' || !Object.getOwnPropertyDescriptor(value, key).enumerable || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))) throw new Error('Unsupported habit source object');
              return Object.fromEntries(keys.map(key => [key, encode(value[key])]));
            };
            resolve(JSON.stringify(encode(result)));
          } catch (error) { reject(error); }
        };
        tx.onabort = tx.onerror = () => { db.close(); reject(tx.error ?? new Error('Readonly habit source aborted')); };
      } catch (error) { db.close(); reject(error); }
    };
  });
}

export async function readHabitRecap(h, { page, api, target, neighbor, label, phase, originalFacts, recorded, facts, home, enter, readControl, readable }) {
  const { writeFile, join, artifacts, observe, capture, pointer, habitClock } = h;
  const prefix = `${label}-yesterday-habit-${phase}`;
  const save = (name, value) => writeFile(join(artifacts, `${prefix}-${name}.json`), JSON.stringify({ syntheticOnly: true, ...value }, null, 2));
  const clock = () => page.evaluate(() => ({ instant: new Date().toISOString(), config: globalThis.__youtraceAuditClock }));
  async function snapshot(name, existing) {
    const readback = existing ?? await facts(page, api, `${prefix}-${name}`, [target.id, neighbor.id]);
    const local = JSON.parse(await page.evaluate(readHabitRecapLocal, api.ownerId));
    const source = { local: { habits: ordered(local.habits), habitCheckins: ordered(local.habitCheckins), settings: ordered(local.settings), outbox: local.outbox }, server: ordered(readback.server), events: readback.events };
    await save(`${name}-sources`, { ...source, derivedCoach: { insights: local.coachInsights, pushes: local.coachPushes }, scope: 'Complete habits/habitCheckins/settings/outbox table sample plus separate derived Coach tables, raw habit GET and complete all-entity ledger. Not the full database. Supported original fields retained, own undefined tagged; unsupported values rejected.' });
    assertSources(source, { target, neighbor, phase, ownerId: api.ownerId }); return source;
  }
  const before = await snapshot('before', originalFacts), expected = assertSources(before, { target, neighbor, phase, ownerId: api.ownerId });
  if (phase === 'undone') assert.ok(recorded && undoTransition(recorded, before, target.id), 'Only the original Monday add and Tuesday false undo may separate checkpoints');
  await save('declaration', { expected, targetId: target.id, neighborId: neighbor.id, note: 'Yesterday counts retained true pairs with a surviving parent, deduplicated by habitId. Current plans never supply a historical denominator; Monday weekly completion is not Tuesday failure.' });
  const captures = [], requests = []; let finish, headerTimer, attributed = false, requestFailure;
  const mountedAt = await clock();
  assert.ok(same(mountedAt.config, habitClock) && shanghai(mountedAt.instant) === TODAY, 'Original controlled business date must still hold before reading');
  const received = new Promise(resolve => { finish = resolve; });
  const bounded = (promise, message) => { let timer; return Promise.race([promise, new Promise(resolve => { timer = setTimeout(() => resolve({ error: message }), 12000); })]).finally(() => clearTimeout(timer)); };
  const onRequest = request => { if (request.method() === 'GET' && new URL(request.url()).pathname === '/api/coach/brief') requests.push(request); };
  const onResponse = response => {
    if (!requests.includes(response.request())) return;
    // Consume immediately, and bound body completion from the response event.
    const body = bounded(response.text().then(text => ({ text }), error => ({ error: error.message })), 'Actual Home response body exceeded 12 seconds');
    captures.push({ response, body }); finish({ received: true });
  };
  page.on('request', onRequest); page.on('response', onResponse);
  try {
    const headers = Promise.race([received, new Promise(resolve => { headerTimer = setTimeout(() => resolve({ error: 'Actual Home brief response not observed within 12 seconds' }), 12000); })]);
    await home(page); const arrival = await headers; clearTimeout(headerTimer);
    if (arrival.error) throw new Error(arrival.error);
    const responses = await Promise.all(captures.map(async ({ response, body }) => ({ status: response.status(), ...await body }))), receivedAt = await clock();
    await save('network', { request: { method: 'GET', path: '/api/coach/brief', origin: 'Ordinary Home mount; no diagnostic request' }, requestCount: requests.length, responses, mountedAt, receivedAt, boundary: 'Complete response text only; no cookie, credential or other headers captured' });
    assert.equal(requests.length, 1, 'One actual ordinary Home request required'); assert.equal(captures.length, 1);
    const payload = responses[0];
    assert.equal(payload.status, 200); assert.ok(!payload.error, payload.error);
    const raw = JSON.parse(payload.text), brief = raw.brief;
    attributed = responseAttributed(brief, expected, mountedAt, receivedAt, habitClock);
    assert.ok(attributed, 'Actual Home response date/controlled-clock attribution is unknown; stop dependent actions');
    const bound = responseMatches(brief, expected, mountedAt, receivedAt, habitClock);
    await observe(page, `${prefix}-actual-response-facts`, bound, JSON.stringify({ expected, actualBrief: brief, mountedAt, receivedAt, totalContextOnly: brief?.yesterdayReview?.habits?.total, historicalDenominatorClaim: false }));
    await page.waitForFunction(() => [...document.querySelectorAll('main details')].some(el => el.querySelector(':scope > summary')?.textContent.trim() === '查看今日回顾与建议'), { timeout: 7000 });
    if (!await page.$$eval('main details', rows => rows.find(el => el.querySelector(':scope > summary')?.textContent.trim() === '查看今日回顾与建议')?.open)) await pointer(page, 'summary', '查看今日回顾与建议');
    await page.waitForFunction(() => [...document.querySelectorAll('main details p')].some(el => /^(云端已同步记录|本机记录)/.test(el.innerText)), { timeout: 7000 });
    const selectors = await page.evaluate(() => {
      const path = el => { if (!el) return null; const parts = []; for (let node = el; node && node !== document.body; node = node.parentElement) { const siblings = [...node.parentElement.children].filter(row => row.tagName === node.tagName); parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(node) + 1})`); } return 'body > ' + parts.join(' > '); };
      const detail = [...document.querySelectorAll('main details')].find(el => el.querySelector(':scope > summary')?.textContent.trim() === '查看今日回顾与建议'), paragraphs = [...(detail?.querySelectorAll('p') ?? [])];
      const weekly = [...document.querySelectorAll('main [data-component="home-overview"] button')].filter(el => ['本周习惯', '习惯打卡', '今日习惯'].includes(el.querySelector('[data-overview-label]')?.textContent.trim()));
      const one = rows => rows.length === 1 ? path(rows[0]) : null;
      const weekField = name => weekly.length === 1 ? one([...weekly[0].querySelectorAll(`[data-overview-${name}]`)]) : null;
      return { date: one(paragraphs.filter(el => /记录回顾|昨日复盘/.test(el.innerText))), provenance: one(paragraphs.filter(el => /^(云端已同步记录|本机记录|正在读取记录)/.test(el.innerText))), habits: one(paragraphs.filter(el => /^已记录支出/.test(el.innerText) && /习惯/.test(el.innerText))), weekLabel: weekField('label'), weekValue: weekField('value'), weekExplanation: weekField('detail') };
    });
    const fields = {};
    for (const [name, selector] of Object.entries(selectors)) {
      try { assert.ok(selector, `Actual ${name} paragraph absent or ambiguous`); await readControl(page, selector); fields[name] = await readable(page, selector); await capture(page, `${prefix}-${name}`); }
      catch (error) { fields[name] = { visible: false, error: error.message }; }
    }
    const finishedAt = await clock(), stillBound = bound && responseMatches(brief, expected, mountedAt, finishedAt, habitClock);
    await observe(page, `${prefix}-recorded-day-reader`, readingMatches(fields, expected, brief, stillBound), JSON.stringify({ expected, fields, responseBound: stillBound, actualBrief: brief, oldRatioIsReaderRed: true, bindingBoundary: 'Current native response and individually visible paragraphs must agree with frozen sources. Minute label alone does not identify a React commit; no placeholder or cached zero credit.' }));
    const weekly = ['weekLabel', 'weekValue', 'weekExplanation'].every(key => fields[key]?.visible) && fields.weekLabel.text.trim() === '本周习惯' && /^2\s*\/\s*2$/.test(fields.weekValue.text.trim()) && fields.weekExplanation.text.includes('本周已全部打卡');
    await observe(page, `${prefix}-separate-current-week`, weekly, JSON.stringify({ expected: expected.currentWeek, fields: { label: fields.weekLabel, value: fields.weekValue, explanation: fields.weekExplanation }, boundary: 'Two present weekly plans are satisfied at both original endpoints; this does not provide yesterday with a target count.' }));
    assert.equal(requests.length, 1); assert.equal(captures.length, 1);
  } catch (error) {
    const mechanical = !attributed || requests.length !== 1 || captures.length !== 1;
    if (mechanical) requestFailure = error;
    const kind = mechanical ? 'request-attribution-blocked' : 'reader-gap';
    await save(kind, { error: error.message, requestCount: requests.length, responses: await Promise.all(captures.map(async ({ response, body }) => ({ status: response.status(), ...await body }))), mountedAt, receivedAt: await clock() });
    await observe(page, `${prefix}-${kind}`, false, error.message);
  } finally { clearTimeout(headerTimer); page.off('request', onRequest); page.off('response', onResponse); }
  // Include the existing native return in the same preservation interval.
  // An unattributed request stays at the failure scene and never resumes it.
  if (!requestFailure) await enter(page);
  const after = await snapshot('after');
  const returnedAt = await clock();
  assert.ok(same(returnedAt.config, habitClock) && shanghai(returnedAt.instant) === TODAY, 'Original controlled business date must still hold after reading');
  const preserved = sourcesPreserved(before, after);
  await observe(page, `${prefix}-source-preservation`, preserved, JSON.stringify({ before: `${prefix}-before-sources.json`, after: `${prefix}-after-sources.json`, protected: 'Every captured habit/checkin field, related versions/conflicts/epoch, full outbox, complete raw habit GET and all-entity ledger; derived Coach objects retained separately without deleting any table for comparison' }));
  assert.ok(preserved, 'Reading changed original business sources; stop dependent actions');
  if (requestFailure) throw requestFailure;
  return before;
}
