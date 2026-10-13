// Independent, bounded evidence assertions. No application imports or browser writes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const row = (facts, key) => facts.local.settings.find(item => item.key === key);
const snapshot = value => value === undefined ? { present: false } : { present: true, row: value };
const plain = value => value !== null && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function keys(value, names) { assert.ok(plain(value)); const descriptors = Object.getOwnPropertyDescriptors(value); assert.deepEqual(Reflect.ownKeys(value).sort(), [...names].sort()); assert.ok(names.every(name => descriptors[name].enumerable && 'value' in descriptors[name])); }
function epoch(facts) { const value = row(facts, 'localDataEpoch'); if (value === undefined) return undefined; keys(value, ['key', 'value']); assert.equal(typeof value.value, 'string'); assert.ok(value.value.length > 0 && value.value.length <= 256); return value.value; }
const originKey = key => `capture-input-origin:${key}`;
const indexKey = key => `capture-input-consumption:${key}`;
const headKey = key => `capture-input-consumption-head:${key}`;
const proofKey = id => `capture-continuation-proof:${id}`;
const validKey = key => typeof key === 'string' && /^capture-input:.{1,256}$/.test(key);
function originShape(value, key, owner, currentEpoch) {
  keys(value, ['format', 'key', 'ownerId', 'epoch', 'sourceKey', 'parent', 'sourceMetadataPresent', 'sourceConsumptionPresent', 'input', 'context']);
  assert.equal(value.format, 'youtrace-capture-input-origin-v1'); assert.equal(value.key, key); assert.equal(value.ownerId, owner); assert.equal(value.epoch, currentEpoch);
  assert.ok(['root', 'input'].includes(value.parent), 'Native positive fixture cannot silently accept unknown provenance');
  assert.equal(typeof value.sourceMetadataPresent, 'boolean'); assert.equal(typeof value.sourceConsumptionPresent, 'boolean');
  assert.equal(value.sourceConsumptionPresent, false, 'Positive native forks must not inherit consumed input');
  assert.ok(value.sourceKey === 'quicknote_draft' || validKey(value.sourceKey));
  for (const [name, sourceKey] of [['input', value.sourceKey], ['context', `${value.sourceKey}:context`]]) {
    const recorded = value[name];
    if (recorded?.present === false) keys(recorded, ['present']);
    else {
      keys(recorded, ['present', 'row']); assert.equal(recorded.present, true); keys(recorded.row, ['key', 'value']); assert.equal(recorded.row.key, sourceKey);
      if (name === 'input') assert.equal(typeof recorded.row.value, 'string');
      else { const context = recorded.row.value; keys(context, ['capturedAt', 'timeZone', 'date']); assert.ok(context.capturedAt === null || Number.isSafeInteger(context.capturedAt) && context.capturedAt >= 0); assert.ok(context.timeZone === null || context.timeZone === 'Asia/Shanghai'); assert.ok(context.date === null || typeof context.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(context.date)); }
    }
  }
  if (value.parent === 'root') { assert.equal(value.sourceMetadataPresent, false); assert.deepEqual(value.input, { present: false }); assert.deepEqual(value.context, { present: false }); }
  else { assert.equal(value.sourceMetadataPresent, true); assert.ok(validKey(value.sourceKey)); }
}
function knownOriginChain(facts, sourceKey, owner) {
  const seen = new Set(); let current = sourceKey;
  for (let i = 0; i < 32; i++) {
    assert.ok(!seen.has(current), 'Provenance cycle'); seen.add(current);
    const saved = row(facts, originKey(current)); keys(saved, ['key', 'value']); assert.equal(saved.key, originKey(current)); originShape(saved.value, current, owner, epoch(facts));
    assert.equal(row(facts, indexKey(current)), undefined); assert.equal(row(facts, headKey(current)), undefined);
    if (saved.value.parent === 'root') return;
    current = saved.value.sourceKey;
  }
  assert.fail('Native positive provenance exceeds bounded 32-node chain');
}
function newContext(value, before, after) {
  keys(value, ['capturedAt', 'timeZone', 'date']); assert.equal(value.timeZone, 'Asia/Shanghai'); assert.equal(value.date, '2026-10-07');
  assert.ok(Number.isSafeInteger(before.clockMillis) && Number.isSafeInteger(after.clockMillis) && after.clockMillis >= before.clockMillis);
  assert.ok(Number.isSafeInteger(value.capturedAt) && value.capturedAt >= before.clockMillis && value.capturedAt <= after.clockMillis, 'New context timestamp is within the actual fork interval');
}
/** Existing ordinary composer fork: exactly one input/context/origin triple,
 * whose source is the before-action session pointer, not a matching text guess. */
export function captureForkInputs(before, after, raw, context, owner) {
  assert.equal(before.databaseName, `youtrace:user:${owner}:schedule-v1`); assert.equal(after.databaseName, before.databaseName); assert.equal(epoch(after), epoch(before));
  assert.ok(before.pointers && after.pointers); const sourceKey = before.pointers.input ?? 'quicknote_draft';
  assert.ok(sourceKey === 'quicknote_draft' || validKey(sourceKey));
  const added = after.local.settings.filter(item => item.key.startsWith('capture-input:') && !row(before, item.key));
  const inputs = added.filter(item => !item.key.endsWith(':context')); assert.equal(inputs.length, 1); assert.equal(added.length, 2);
  const input = inputs[0], key = input.key; assert.ok(validKey(key)); keys(input, ['key', 'value']); assert.equal(input.value, raw);
  const basisRow = row(after, `${key}:context`); keys(basisRow, ['key', 'value']);
  const source = row(before, sourceKey), sourceContext = row(before, `${sourceKey}:context`), prior = row(before, originKey(sourceKey));
  assert.equal(row(before, indexKey(sourceKey)), undefined); assert.equal(row(before, headKey(sourceKey)), undefined);
  const copied = source !== undefined && typeof source.value === 'string' ? source.value : '';
  assert.equal(raw, copied, 'Fork raw must come from the exact before-action input row');
  if (copied) { assert.ok(sourceContext); assert.deepEqual(basisRow.value, sourceContext.value); }
  else newContext(basisRow.value, before, after);
  if (context !== undefined) assert.deepEqual(basisRow.value, context);
  let parent;
  if (source === undefined && sourceContext === undefined && prior === undefined) parent = 'root';
  else { assert.ok(validKey(sourceKey) && prior); keys(prior, ['key', 'value']); originShape(prior.value, sourceKey, owner, epoch(before)); knownOriginChain(before, sourceKey, owner); parent = 'input'; }
  const expected = { format: 'youtrace-capture-input-origin-v1', key, ownerId: owner, epoch: epoch(before), sourceKey, parent, sourceMetadataPresent: prior !== undefined, sourceConsumptionPresent: false, input: snapshot(source), context: snapshot(sourceContext) };
  assert.equal(row(before, originKey(key)), undefined); assert.deepEqual(row(after, originKey(key)), { key: originKey(key), value: expected });
  assert.equal(after.pointers.input, key); assert.equal(after.pointers.review, before.pointers.review);
  return { key, context: basisRow.value, writes: { [key]: raw, [`${key}:context`]: basisRow.value, [originKey(key)]: expected }, sourceKey };
}
/** Explicit new empty root, followed by the ordinary mounted composer fork. */
export function captureExplicitEmptyInputs(before, after, owner) {
  assert.equal(epoch(after), epoch(before)); assert.equal(after.databaseName, before.databaseName);
  const inputs = after.local.settings.filter(item => validKey(item.key) && !item.key.endsWith(':context') && !row(before, item.key)); assert.equal(inputs.length, 2);
  const child = inputs.find(item => item.key === after.pointers.input), root = inputs.find(item => item !== child); assert.ok(child && root);
  keys(root, ['key', 'value']); assert.equal(root.value, ''); const context = row(after, `${root.key}:context`); keys(context, ['key', 'value']); newContext(context.value, before, after);
  const expected = { format: 'youtrace-capture-input-origin-v1', key: root.key, ownerId: owner, epoch: epoch(before), sourceKey: root.key, parent: 'root', sourceMetadataPresent: false, sourceConsumptionPresent: false, input: { present: false }, context: { present: false } };
  for (const key of [root.key, `${root.key}:context`, originKey(root.key), indexKey(root.key), headKey(root.key)]) assert.equal(row(before, key), undefined);
  assert.deepEqual(row(after, originKey(root.key)), { key: originKey(root.key), value: expected }); assert.equal(row(after, indexKey(root.key)), undefined); assert.equal(row(after, headKey(root.key)), undefined);
  const intermediate = { ...before, pointers: { ...before.pointers, input: root.key }, local: { ...before.local, settings: [...before.local.settings, root, context, { key: originKey(root.key), value: expected }] } };
  const fork = captureForkInputs(intermediate, after, '', undefined, owner);
  return { ...fork, rootKey: root.key, writes: { [root.key]: '', [`${root.key}:context`]: context.value, [originKey(root.key)]: expected, ...fork.writes } };
}
// Independently specified protocol wire: finite primitive/plain records and
// dense arrays only. Own undefined and -0 remain distinct; no eval/getters.
export function captureProofDigest(value) {
  let nodes = 0;
  function encode(item, depth = 0) {
    assert.ok(++nodes <= 20000 && depth <= 12);
    if (item === null) return ['null']; if (item === undefined) return ['undefined'];
    if (typeof item === 'string') { assert.ok(item.length <= 200000); return ['string', item]; }
    if (typeof item === 'boolean') return ['boolean', item];
    if (typeof item === 'number') { assert.ok(Number.isFinite(item)); return ['number', Object.is(item, -0) ? '-0' : String(item)]; }
    assert.ok(item && typeof item === 'object'); const descriptors = Object.getOwnPropertyDescriptors(item);
    if (Array.isArray(item)) { assert.ok(item.length <= 1000); assert.equal(Reflect.ownKeys(item).length, item.length + 1); return ['array', Array.from({ length: item.length }, (_, i) => { assert.ok(descriptors[i]?.enumerable && 'value' in descriptors[i]); return encode(descriptors[i].value, depth + 1); })]; }
    assert.ok(plain(item)); const names = Reflect.ownKeys(item); assert.ok(names.every(name => typeof name === 'string' && descriptors[name].enumerable && 'value' in descriptors[name]));
    return ['object', names.sort().map(name => [name, encode(descriptors[name].value, depth + 1)])];
  }
  const wire = JSON.stringify(encode(value)); assert.ok(wire.length <= 524288); return createHash('sha256').update(wire, 'utf8').digest('hex');
}
function fingerprint(value) {
  const canonical = item => Array.isArray(item) ? item.map(canonical) : item !== null && typeof item === 'object' ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)])) : item;
  return JSON.stringify(canonical(Object.fromEntries(['input', 'context', 'expenses', 'habits', 'todos', 'diary', 'diaryExcludedText', 'diaryDate', 'mood', 'moodScore', 'moodConfirmed'].map(key => [key, value[key]]))));
}
export function assertCaptureContinuationProof(facts, expected, submitted) {
  const saved = row(facts, proofKey(expected.id)); keys(saved, ['key', 'value']); const proof = saved.value;
  keys(proof, ['format', 'body', 'digest']); assert.equal(proof.format, 'youtrace-capture-continuation-proof-v1'); assert.match(proof.digest, /^[0-9a-f]{64}$/);
  const body = proof.body; keys(body, ['ownerId', 'epoch', 'id', 'operationId', 'inputKey', 'expected', 'submitted', 'retainedInput', 'retainedContext', 'result']);
  assert.equal(body.ownerId, expected.ownerId); assert.equal(body.epoch, epoch(facts)); assert.equal(body.id, expected.id); assert.equal(body.inputKey, expected.inputKey); assert.ok(typeof body.operationId === 'string' && body.operationId.length > 0 && body.operationId.length <= 256);
  assert.equal(proof.digest, captureProofDigest(body), 'proof body SHA-256 must bind the complete typed content');
  assert.deepEqual(body.expected, expected); assert.deepEqual(body.submitted, submitted);
  assert.deepEqual(submitted, { ...expected, sessionRevision: submitted.sessionRevision, sessionActive: submitted.sessionActive });
  assert.deepEqual(row(facts, `capture-source:${expected.id}`), { key: `capture-source:${expected.id}`, value: submitted });
  assert.deepEqual(body.retainedInput, snapshot(row(facts, expected.inputKey))); assert.deepEqual(body.retainedContext, snapshot(row(facts, `${expected.inputKey}:context`)));
  const receipt = { fingerprint: fingerprint(submitted), result: body.result, input: submitted.input, ownerId: body.ownerId, continuationProtocol: 'youtrace-capture-continuation-receipt-v1', continuationOperationId: body.operationId, continuationProofDigest: proof.digest };
  assert.deepEqual(row(facts, `capture-applied:${expected.id}`), { key: `capture-applied:${expected.id}`, value: receipt });
  const indexed = row(facts, indexKey(body.inputKey)), headed = row(facts, headKey(body.inputKey)); keys(indexed, ['key', 'value']); keys(headed, ['key', 'value']);
  const index = indexed.value; keys(index, ['format', 'ownerId', 'epoch', 'inputKey', 'entries']);
  // This native fixture intentionally makes the FIRST isolated commit on O's key.
  const expectedIndex = { format: 'youtrace-capture-input-consumption-v1', ownerId: body.ownerId, epoch: body.epoch, inputKey: body.inputKey, entries: [{ id: body.id, operationId: body.operationId, digest: proof.digest }] };
  assert.deepEqual(index, expectedIndex);
  const head = { format: 'youtrace-capture-input-consumption-head-v1', ownerId: body.ownerId, epoch: body.epoch, inputKey: body.inputKey, count: 1, indexDigest: captureProofDigest(index) };
  assert.deepEqual(headed.value, head, 'whole index SHA-256/count and exact own operation');
  return { proof, receipt, index, head };
}
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const seq = value => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
function physicalKeys(table) { const value = table.keys; keys(value, ['type', 'length', 'entries']); assert.equal(value.type, 'array'); assert.equal(value.entries.length, value.length); return value.entries.map(([index, key], i) => { assert.equal(index, String(i)); assert.equal(typeof key, 'string'); return key; }); }
const canonicalRows = rows => [...rows].sort((a, b) => String(a.id ?? a.key).localeCompare(String(b.id ?? b.key)));
function settingsExactly(before, after, writes, deletes = [], pushed = false) {
  const changes = [];
  for (const key of new Set([...before.local.settings, ...after.local.settings].map(item => item.key))) {
    const a = row(before, key), b = row(after, key);
    if (Object.hasOwn(writes, key)) { assert.deepEqual(b, { key, value: writes[key] }); changes.push({ key, before: snapshot(a), after: snapshot(b), proof: 'exact declared value' }); }
    else if (deletes.includes(key)) { assert.ok(a); assert.equal(b, undefined); changes.push({ key, before: snapshot(a), after: snapshot(b), proof: 'exact selected review removal' }); }
    else if (key === 'lastPullAt' || pushed && key === 'lastPushAt') {
      assert.ok(b && iso(b.value)); keys(b, ['key', 'value']); if (a) { keys(a, ['key', 'value']); assert.ok(iso(a.value) && Date.parse(b.value) >= Date.parse(a.value)); }
      changes.push({ key, before: snapshot(a), after: snapshot(b), proof: 'canonical nondecreasing sync timestamp' });
    } else assert.deepEqual(b, a, `Unapproved setting mutation: ${key}`);
  }
  for (const [key, value] of Object.entries(writes)) assert.deepEqual(row(after, key), { key, value });
  if (after.snapshot) assert.deepEqual(physicalKeys(after.snapshot.tables.find(table => table.name === 'settings')).sort(), after.local.settings.map(item => item.key).sort(), 'Every settings physical key matches its exact retained row');
  return changes;
}
export function assertCaptureContinuationCommitted(before, after, expected, submitted, window) {
  assert.equal(after.databaseName, before.databaseName); assert.equal(after.version, before.version); assert.deepEqual(after.schema, before.schema);
  assert.deepEqual(Object.keys(after.local).sort(), Object.keys(before.local).sort()); assert.deepEqual(before.local.outbox, []); assert.deepEqual(after.local.outbox, []);
  assert.deepEqual(row(before, `capture-review:${expected.id}`), { key: `capture-review:${expected.id}`, value: expected });
  for (const key of [proofKey(expected.id), indexKey(expected.inputKey), headKey(expected.inputKey), `capture-source:${expected.id}`, `capture-applied:${expected.id}`]) assert.equal(row(before, key), undefined);
  const proof = assertCaptureContinuationProof(after, expected, submitted), receipt = proof.receipt, result = receipt.result;
  keys(result, ['expenseCount', 'habitCount', 'diaryCreated', 'diaryUpdated', 'todoCount', 'records', 'committedAt', 'captureContext']);
  assert.equal(result.expenseCount, 1); assert.equal(result.habitCount, 0); assert.equal(result.todoCount, 0); assert.equal(result.diaryCreated, false); assert.equal(result.diaryUpdated, false);
  const at = result.committedAt; assert.ok(Number.isSafeInteger(at) && at >= window.before && at <= window.after); assert.deepEqual(result.captureContext, expected.context);
  assert.equal(expected.expenses.filter(item => item.confirmed).length, 1); assert.equal(expected.todos.filter(item => item.confirmed).length, 0); assert.deepEqual(expected.habits, []); assert.equal(expected.diary, null); assert.equal(expected.moodConfirmed, false);
  assert.equal(result.records.length, 2); const expenseId = result.records[1].id, expense = expected.expenses.find(item => item.confirmed);
  assert.equal(typeof expenseId, 'string'); assert.ok(expenseId && expenseId !== expected.id && !expected.expenses.some(item => item.id === expenseId));
  const refs = [{ entity: 'quickNotes', id: expected.id, label: '原始速记', effect: 'created' }, { entity: 'expenses', id: expenseId, label: expense.name, date: expense.date, effect: 'created' }];
  assert.deepEqual(result.records, refs);
  const note = { id: expected.id, rawInput: expected.input, createdAt: at, expenses: [{ id: expense.id, name: expense.name, amount: expense.amount, category: expense.category, confirmed: true, date: expense.date, currency: 'CNY', isIncome: expense.isIncome === true }], diary: null, mood: null, moodScore: null, habits: [], todos: [], confirmed: true, captureContext: expected.context };
  const expenseRow = { id: expenseId, name: expense.name, amount: expense.amount, category: expense.category, date: expense.date, isIncome: expense.isIncome === true, source: 'quicknote' };
  const addedRows = { quickNotes: note, expenses: expenseRow };
  for (const [name, rows] of Object.entries(before.local)) {
    if (name === 'settings') continue;
    const added = addedRows[name]; if (added) assert.ok(!rows.some(item => item.id === added.id));
    assert.deepEqual(canonicalRows(after.local[name]), canonicalRows(added ? [...rows, added] : rows), `Exact business table ${name}`);
    if (before.snapshot && after.snapshot) {
      const a = before.snapshot.tables.find(table => table.name === name), b = after.snapshot.tables.find(table => table.name === name);
      if (!added) assert.deepEqual(b, a, `Physical unchanged keys/typed values ${name}`);
      else assert.deepEqual(physicalKeys(b).sort(), [...physicalKeys(a), added.id].sort(), `Exact new physical key ${name}`);
    }
  }
  assert.deepEqual(after.allEvents.slice(0, before.allEvents.length), before.allEvents); const events = after.allEvents.slice(before.allEvents.length); assert.equal(events.length, 2);
  let previous = before.allEvents.at(-1)?.seq ?? '0';
  for (const event of events) { assert.ok(seq(event.seq) && BigInt(event.seq) > BigInt(previous)); previous = event.seq; }
  const writes = { [`capture-source:${expected.id}`]: submitted, [`capture-applied:${expected.id}`]: receipt, [proofKey(expected.id)]: proof.proof, [indexKey(expected.inputKey)]: proof.index, [headKey(expected.inputKey)]: proof.head };
  for (const ref of refs) {
    const matches = events.filter(event => event.entity === ref.entity && event.entityId === ref.id); assert.equal(matches.length, 1); const event = matches[0]; assert.equal(event.operation, 'upsert');
    const server = event.data; assert.ok(iso(server.createdAt) && iso(server.updatedAt) && Date.parse(server.updatedAt) >= Date.parse(server.createdAt));
    const times = { createdAt: server.createdAt, updatedAt: server.updatedAt };
    const declared = ref.entity === 'quickNotes' ? { id: expected.id, userId: expected.ownerId, content: expected.input, timestamp: server.timestamp, parsed: { expenses: note.expenses, diary: null, mood: null, moodScore: null, habits: [], todos: [], captureContext: expected.context }, confirmed: true, ...times } : { ...expenseRow, userId: expected.ownerId, relatedMood: null, note: null, ...times };
    assert.deepEqual(server, declared); if (ref.entity === 'quickNotes') assert.ok(server.timestamp === at || server.timestamp === String(at));
    assert.equal(row(after, `sync-conflict:${ref.entity}:${ref.id}`), undefined); writes[`sync-version:${ref.entity}:${ref.id}`] = event.seq;
  }
  const changes = settingsExactly(before, after, writes, [`capture-review:${expected.id}`], true);
  assert.deepEqual(after.pointers, before.pointers, 'Isolated save does not transfer either active pointer');
  return { ...proof, events, changes, expectedNote: note, expectedExpense: expenseRow };
}
/** Separate technical full-document bootstrap boundary, never a zero-write
 * window. Only exact acknowledged owner-ledger cursor may advance. */
export function assertCaptureHistoryReload(before, after, owner) {
  assert.equal(after.databaseName, before.databaseName); assert.equal(after.version, before.version); assert.deepEqual(after.schema, before.schema); assert.deepEqual(after.allEvents, before.allEvents);
  for (const name of Object.keys(before.local)) if (name !== 'settings') { assert.deepEqual(after.local[name], before.local[name]); if (before.snapshot) assert.deepEqual(after.snapshot.tables.find(table => table.name === name), before.snapshot.tables.find(table => table.name === name)); }
  const oldCursor = row(before, 'syncV2Cursor'), cursor = row(after, 'syncV2Cursor'); const writes = {};
  if (cursor) {
    keys(cursor, ['key', 'value']); const old = oldCursor?.value ?? '0', tip = after.allEvents.at(-1)?.seq ?? '0';
    assert.ok(old === '0' || seq(old)); assert.ok(cursor.value === '0' || seq(cursor.value)); assert.ok(BigInt(cursor.value) >= BigInt(old));
    assert.ok(cursor.value === old || cursor.value === tip, 'Only exact complete owner-ledger tip can advance cursor');
    if (cursor.value !== old) {
      assert.ok(after.pages?.length > 0); let from = '0'; const collected = [];
      for (const [i, page] of after.pages.entries()) {
        assert.equal(page.path, `/api/sync/pull?protocol=2&features=goals-v1&cursor=${from}&limit=500`); const body = page.body;
        assert.equal(body.protocol, 2); assert.ok(body.features.includes('goals-v1')); assert.equal(typeof body.hasMore, 'boolean'); assert.equal(body.hasMore, i < after.pages.length - 1);
        for (const event of body.events) { assert.ok(seq(event.seq) && BigInt(event.seq) > BigInt(from)); assert.equal(event.operation, 'upsert'); assert.equal(event.data.userId, owner); assert.equal(event.data.id, event.entityId); const ack = row(before, `sync-version:${event.entity}:${event.entityId}`)?.value; assert.ok(seq(ack) && BigInt(ack) >= BigInt(event.seq)); collected.push(event); from = event.seq; }
        assert.equal(body.nextCursor, from);
      }
      assert.deepEqual(collected, before.allEvents); assert.equal(from, tip);
    }
    writes.syncV2Cursor = cursor.value;
  } else assert.equal(oldCursor, undefined);
  assert.deepEqual(after.pointers, before.pointers);
  return settingsExactly(before, after, writes);
}
export const captureContinuationEvidenceKeys = { originKey, indexKey, headKey, proofKey };
