import assert from 'node:assert/strict';
import test from 'node:test';
import { reminderEntryChecks as checks } from '../scripts/audit-reminder-entry.mjs';

const NOW = Date.parse('2026-10-07T03:00:00.000Z'), clock = checks.businessClock(NOW);
const clone = structuredClone;
function encode(value: unknown): unknown {
  if (value === undefined) return { type: 'undefined' };
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return { type: 'array', length: value.length, entries: Object.keys(value).map(key => [key, encode(value[Number(key)])]) };
  return { type: 'object', entries: Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, encode(item)]) };
}
function makeSource() {
  const values = { coachStyle: 'gentle', coachPushEnabled: false, coachPushFrequency: 3, quietHours: { enabled: true, start: '22:00', end: '08:00' }, eveningReviewEnabled: false, eveningReviewTime: '21:00' };
  const wire = { coachStyle: 'gentle', coachPushEnabled: false, pushLimit: 3, quietEnabled: true, quietStart: '22:00', quietEnd: '08:00', eveningReviewEnabled: false, eveningReviewTime: '21:00' };
  const rows = [...Object.entries(values).map(([key, value]) => ({ key, value })), { key: 'accountPreferences:state:v1', value: { version: 1, epoch: 'initial', localRevision: 1, initial: clone(values), server: { protocol: 1, revision: '0', settings: clone(values) }, active: null, queued: null, readFailures: 0 } }, { key: 'unknown-existing', value: { present: undefined, untouched: true } }].sort((a, b) => a.key.localeCompare(b.key));
  const raw = { databaseName: 'youtrace:user:synthetic-reminder:schedule-v1', version: 12, schema: ['synthetic-existing-schema'], tables: [...checks.business, 'outbox', 'coachInsights', 'coachPushes', 'settings'].sort().map(name => { const items = name === 'settings' ? rows : []; return { name, rows: items, losslessRows: encode(items), keys: encode(items.map(row => row.key)) }; }) };
  return { owner: 'synthetic-reminder', startedAt: NOW, finishedAt: NOW + 1000, raw, ...checks.project(raw), cloud: { ledger: { protocol: 2, features: ['goals-v1'], events: [], nextCursor: '0', hasMore: false }, preferences: { protocol: 1, revision: '0', settings: wire }, pushes: { pushes: [] }, insights: { insights: [] }, chat: { rawSessions: { sessions: [] }, rawMessages: {} } } };
}
type Facts = ReturnType<typeof makeSource>;
function refresh(facts: Facts) {
  facts.raw.tables = Object.entries(facts.local).sort(([a], [b]) => a.localeCompare(b)).map(([name, entries]) => {
    const rows = [...entries].sort((a, b) => String(a.id ?? a.key).localeCompare(String(b.id ?? b.key)));
    return { name, rows, losslessRows: encode(rows), keys: encode(rows.map(row => row.id ?? row.key)) };
  });
  Object.assign(facts, checks.project(facts.raw)); return facts;
}
function put(facts: Facts, key: string, value: unknown) { facts.local.settings = [...facts.local.settings.filter(row => row.key !== key), { key, value }]; return refresh(facts); }
function delivered() {
  const before = makeSource(), after = clone(before);
  after.local.coachPushes = [{ id: `push-${NOW + 100}-test`, type: 'evening_review', title: checks.title, body: checks.body, actions: clone(checks.actions), read: false, acted: false, origin: 'local', createdAt: NOW + 100 }];
  for (const [key, value] of Object.entries({ pushControlDate: clock.day, pushControlCount: 1, todayPositiveCount: 0, [checks.delivery]: clock.day })) put(after, key, value);
  return { before, after, window: { before: NOW, after: NOW + 1000 } };
}
function acted() {
  const before = delivered().after, after = clone(before), key = `capture-input:${'a'.repeat(32)}`, composer = { key, before: NOW, after: NOW + 1000, day: clock.day };
  after.local.coachPushes[0].read = true; after.local.coachPushes[0].acted = true;
  put(after, 'consecutiveIgnores', 0); put(after, key, ''); put(after, `${key}:context`, { capturedAt: NOW + 200, timeZone: 'Asia/Shanghai', date: clock.day });
  return { before, after, composer };
}
function preferenceChange() {
  const before = makeSource(), after = clone(before), key = 'coachPushEnabled';
  const old = after.local.settings.find(row => row.key === 'accountPreferences:state:v1').value;
  after.cloud.preferences = { ...after.cloud.preferences, revision: '1', settings: { ...after.cloud.preferences.settings, coachPushEnabled: true } };
  put(after, key, true); put(after, 'accountPreferences:state:v1', { ...old, localRevision: 4, server: { ...old.server, revision: '1', settings: { ...old.server.settings, [key]: true } } });
  const request = { account: before.owner, body: { protocol: 1, mutationId: 'native-mutation', baseRevision: '0', changes: { coachPushEnabled: true } } };
  const response = { status: 200, request: request.body, body: { ...after.cloud.preferences, acknowledged: true, mutationId: 'native-mutation' } };
  return { before, after, key, request, response };
}
test('Complete new-account source requires all eight tables including checkins and uncapped cloud evidence', () => {
  const facts = makeSource(); assert.equal(checks.empty(facts, { pushes: true }), true);
  const checkins = clone(facts); checkins.local.habitCheckins.push({ id: 'unexpected' }); refresh(checkins); assert.equal(checks.empty(checkins), false);
  const missing = clone(facts); delete missing.local.habitCheckins; assert.throws(() => checks.complete(missing), /Missing source/);
  const partial = clone(facts); partial.cloud.ledger.hasMore = true; assert.throws(() => checks.complete(partial));
  const capped = clone(facts); capped.cloud.pushes.pushes = Array.from({ length: 50 }, (_, id) => ({ id })); assert.throws(() => checks.complete(capped));
  const noLossless = clone(facts.raw); noLossless.tables[0].losslessRows = null; assert.throws(() => checks.project(noLossless));
  const duplicateKeys = clone(facts.raw), table = duplicateKeys.tables.find(row => row.name === 'settings')!;
  table.keys = encode([table.rows[0].key, table.rows[0].key, ...table.rows.slice(2).map(row => row.key)]); assert.throws(() => checks.project(duplicateKeys), /keys must be unique/);
  for (const rows of [[{ description: 'missing ID' }], [{ id: 'duplicate' }, { id: 'duplicate' }]]) { const incomplete = clone(facts); incomplete.cloud.insights.insights = rows; assert.throws(() => checks.complete(incomplete), /IDs must be present and unique/); }
  const insight = clone(facts); insight.local.coachInsights.push({ id: 'native-home-brief', unknown: undefined }); insight.cloud.insights.insights.push({ id: 'native-home-brief', description: 'Existing native brief' }); refresh(insight);
  assert.equal(checks.empty(insight), true, 'An app-created brief does not make the eight business sources nonempty');
});
test('All source fields and unknown settings survive; only actual bounded lastPullAt progress is exempt', () => {
  const before = makeSource(); assert.equal(checks.preserved(before, clone(before)), true);
  for (const change of [
    (f: Facts) => { f.local.habitCheckins.push({ id: 'new' }); },
    (f: Facts) => { f.local.coachInsights.push({ id: 'new' }); },
    (f: Facts) => { delete f.local.settings.find(row => row.key === 'unknown-existing').value.present; },
    (f: Facts) => { f.local.outbox.push({ seq: 1 }); },
    (f: Facts) => { f.cloud.pushes.pushes.push({ id: 'cloud-unrelated', body: 'changed' }); },
    (f: Facts) => { f.cloud.insights.insights.push({ id: 'cloud-unrelated' }); },
  ]) { const after = clone(before); change(after); refresh(after); assert.equal(checks.preserved(before, after), false); }
  assert.equal(checks.preserved(before, put(clone(before), 'lastPullAt', new Date(NOW + 500).toISOString())), true);
  for (const at of [NOW - 1, NOW + 1001]) assert.equal(checks.preserved(before, put(clone(before), 'lastPullAt', new Date(at).toISOString())), false);
  assert.equal(checks.preserved(before, put(clone(before), 'capture-input:unknown', '')), false);
});
test('Only the exact real local evening-review row and four exact delivery counters are admissible', () => {
  const { before, after, window } = delivered(); assert.equal(checks.delivered(before, after, clock, window), true);
  for (const change of [
    (f: Facts) => { f.local.coachPushes[0].body += 'wrong'; },
    (f: Facts) => { f.local.coachPushes[0].origin = 'cloud'; },
    (f: Facts) => { f.local.coachPushes[0].read = true; },
    (f: Facts) => { f.local.coachPushes[0].createdAt = NOW - 1; },
    (f: Facts) => { f.local.coachPushes[0].extra = undefined; },
    (f: Facts) => { put(f, 'pushControlCount', 2); },
    (f: Facts) => { put(f, 'todayPositiveCount', 1); },
    (f: Facts) => { put(f, checks.delivery, '2026-10-06'); },
  ]) { const bad = clone(after); change(bad); refresh(bad); assert.equal(checks.delivered(before, bad, clock, window), false); }
  const seeded = clone(before); put(seeded, 'pushControlCount', 1); assert.equal(checks.delivered(seeded, after, clock, window), false);
  const coercedId = clone(after); coercedId.local.coachPushes[0].id = [after.local.coachPushes[0].id]; refresh(coercedId); assert.equal(checks.delivered(before, coercedId, clock, window), false);
});
test('Current minute is real Beijing time; crossing day or 30-minute boundary cannot qualify', () => {
  assert.deepEqual(clock, { day: '2026-10-07', time: '11:00' });
  assert.equal(checks.clockStillCurrent(clock, NOW + 30 * 60000), true);
  assert.equal(checks.clockStillCurrent(clock, NOW + 31 * 60000), false);
  assert.equal(checks.clockStillCurrent({ day: '2026-10-06', time: '11:00' }, NOW), false);
  const quiet = { quietEnabled: true, quietStart: '22:00', quietEnd: '08:00' };
  assert.equal(checks.insideQuiet('23:00', quiet), true); assert.equal(checks.insideQuiet('11:00', quiet), false);
});
test('Reading may mark only the unique target read; missing entry cannot excuse action or other writes', () => {
  const before = delivered().after, after = clone(before); after.local.coachPushes[0].read = true; refresh(after);
  assert.equal(checks.opened(before, after), true); assert.equal(checks.preserved(before, after), false);
  after.local.coachPushes[0].acted = true; refresh(after); assert.equal(checks.opened(before, after), false);
});
test('Go record requires same-ID read/acted and exactly two native empty-input keys', () => {
  const { before, after, composer } = acted(); assert.equal(checks.feedback(before, after, '去记录', composer), true);
  assert.equal(checks.feedback(before, after, '去记录', { ...composer, key: [composer.key] }), false);
  for (const change of [
    (f: Facts) => { f.local.coachPushes[0].id = `push-${NOW + 100}-other`; },
    (f: Facts) => { f.local.coachPushes[0].acted = false; },
    (f: Facts) => { put(f, composer.key, 'unrequested record'); },
    (f: Facts) => { put(f, `${composer.key}:context`, { capturedAt: NOW - 1, timeZone: 'Asia/Shanghai', date: clock.day }); },
    (f: Facts) => { put(f, `${composer.key}:context`, { capturedAt: NOW + 200, timeZone: 'UTC', date: clock.day }); },
    (f: Facts) => { put(f, 'capture-review:unexpected', {}); },
    (f: Facts) => { put(f, 'consecutiveIgnores', 1); },
    (f: Facts) => { f.local.quickNotes.push({ id: 'unrequested-save' }); },
  ]) { const bad = clone(after); change(bad); refresh(bad); assert.equal(checks.feedback(before, bad, '去记录', composer), false); }
  const preexisting = clone(before); put(preexisting, composer.key, ''); assert.equal(checks.feedback(preexisting, after, '去记录', composer), false);
  assert.equal(checks.preserved(after, clone(after)), true, 'Ordinary Home return keeps even the empty native input keys');
});
test('Enough for today deletes only that local ID and increments ignore once without new business data', () => {
  const before = delivered().after, after = clone(before); after.local.coachPushes = []; put(after, 'consecutiveIgnores', 1);
  assert.equal(checks.feedback(before, after, '今天够了'), true);
  const neighbors = clone(before); neighbors.local.coachPushes.push({ ...before.local.coachPushes[0], id: 'untouched-neighbor' }); refresh(neighbors); assert.equal(checks.feedback(neighbors, after, '今天够了'), false);
  for (const [key, value] of [['consecutiveIgnores', 2], ['pushControlCount', 0], ['todayPositiveCount', 1], ['unexpected', true]] as const) assert.equal(checks.feedback(before, put(clone(after), key, value), '今天够了'), false);
  const redelivery = clone(after); redelivery.local.coachPushes.push({ ...before.local.coachPushes[0], id: 'another' }); refresh(redelivery); assert.equal(checks.preserved(after, redelivery), false);
});
test('Settings full ACK is exact, while a valid settings ACK cannot substitute for actual push delivery', () => {
  const { before, after, key, request, response } = preferenceChange();
  assert.equal(checks.preferenceChanged(before, after, key, true, [request], [response]), true);
  assert.equal(checks.preferenceChanged(before, after, key, true, [request], []), false);
  const partial = clone(response); delete partial.body.settings.quietEnd; assert.equal(checks.preferenceChanged(before, after, key, true, [request], [partial]), false);
  const changed = clone(after); put(changed, 'unexpected-setting', true); assert.equal(checks.preferenceChanged(before, changed, key, true, [request], [response]), false);
  const foreign = clone(request); foreign.account = 'different-account'; assert.equal(checks.preferenceChanged(before, after, key, true, [foreign], [response]), false);
  assert.equal(checks.delivered(before, after, clock, { before: NOW, after: NOW + 1000 }), false);
});
test('Lossless preference state preserves own undefined and nested metadata even when raw CDP rows omit it', () => {
  const { before, after, key, request, response } = preferenceChange();
  const state = (facts: Facts) => facts.local.settings.find(row => row.key === 'accountPreferences:state:v1').value;
  for (const facts of [before, after]) { Object.assign(state(facts), { originalUndefined: undefined, nestedUnknown: { retainedUndefined: undefined } }); refresh(facts); facts.raw = JSON.parse(JSON.stringify(facts.raw)); }
  assert.equal(Object.hasOwn(before.raw.tables.find(row => row.name === 'settings')!.rows.find(row => row.key === 'accountPreferences:state:v1')!.value, 'originalUndefined'), false);
  assert.equal(Object.hasOwn(state(before), 'originalUndefined'), true);
  assert.equal(checks.preferenceChanged(before, after, key, true, [request], [response]), true);
  for (const erase of [(facts: Facts) => { delete state(facts).originalUndefined; }, (facts: Facts) => { delete state(facts).nestedUnknown.retainedUndefined; }]) {
    const changed = clone(after); erase(changed); refresh(changed); changed.raw = JSON.parse(JSON.stringify(changed.raw));
    assert.equal(checks.preferenceChanged(before, changed, key, true, [request], [response]), false);
  }
});
test('Preference writes preserve the entire cloud snapshot shell outside revision and declared settings', () => {
  const { before, after, key, request, response } = preferenceChange();
  const metadata = { retained: true, nested: { ownerLabel: 'synthetic' } };
  for (const facts of [before, after]) Object.assign(facts.cloud.preferences, { metadata: clone(metadata) });
  assert.equal(checks.preferenceChanged(before, after, key, true, [request], [response]), true);
  const removed = clone(after); Reflect.deleteProperty(removed.cloud.preferences, 'metadata'); assert.equal(checks.preferenceChanged(before, removed, key, true, [request], [response]), false);
  const changed = clone(after); Object.assign(changed.cloud.preferences, { metadata: { retained: false } }); assert.equal(checks.preferenceChanged(before, changed, key, true, [request], [response]), false);
  const extra = clone(after); Object.assign(extra.cloud.preferences, { unrequestedExtra: true }); assert.equal(checks.preferenceChanged(before, extra, key, true, [request], [response]), false);
});
test('Every same-mutation retry must be a valid wire request even when the first request has a matching ACK', () => {
  const { before, after, key, request, response } = preferenceChange();
  assert.equal(checks.preferenceChanged(before, after, key, true, [request, clone(request)], [response]), true);
  for (const body of [{ ...request.body, protocol: 99 }, { ...request.body, unexpected: true }]) {
    const malformed = { ...request, body }; assert.equal(checks.preferenceChanged(before, after, key, true, [request, malformed], [response]), false);
  }
});
test('Read status is monotonic across arrival and the later before-action source freeze', () => {
  const frozen = delivered().after, arrived = clone(frozen); arrived.local.coachPushes[0].read = true; refresh(arrived);
  assert.equal(checks.opened(frozen, clone(frozen)), true);
  assert.equal(checks.opened(frozen, arrived), true);
  assert.equal(checks.opened(arrived, clone(arrived)), true);
  const reverted = clone(arrived); reverted.local.coachPushes[0].read = false; refresh(reverted);
  assert.equal(checks.opened(arrived, reverted), false, 'Compare the action freeze with arrival; the earlier unread state cannot excuse a later regression');
});
