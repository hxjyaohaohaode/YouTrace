import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { CAPTURE_CATALOG_ENTRY, CAPTURE_CATALOG_LONG_RAW, CAPTURE_CATALOG_LONG_LINES, expectedCatalogLongDraft, parseCaptureReadonlyFields, installCaptureCatalogWriteAudit, assertCaptureCatalogUnchanged, assertCaptureCatalogLines, runCaptureCatalogReadOnly, runCaptureCatalogLongOriginal } from '../scripts/audit-capture-catalog.mjs';
import { parseQuickNote } from '../src/services/parser.ts';

const basis = { capturedAt: 1791360000000, date: '2026-10-06', timeZone: 'Asia/Shanghai' }, actor = { ownerId: 'synthetic-catalog-native', dataEpoch: 'initial', sessionRevision: 'synthetic-revision', sessionActive: true };

test('independently declared long original is produced by the existing literal parser, with no task, money or mood invention', () => {
  const expected = expectedCatalogLongDraft('L', 'capture-input:long', basis, actor);
  assert.equal(CAPTURE_CATALOG_LONG_LINES.length, 40); assert.equal(expected.input, CAPTURE_CATALOG_LONG_RAW); assert.ok(expected.input.length < 5000);
  assert.deepEqual(parseQuickNote(CAPTURE_CATALOG_LONG_RAW, basis), { expenses: [], habits: [], todos: [], diary: expected.diary, mood: null, moodScore: null });
  assert.deepEqual(expected.context, basis); assert.deepEqual(Object.fromEntries(Object.keys(actor).map(key => [key, expected[key]])), actor);
});

test('display parser preserves whitespace, own undefined, negative zero and arrays without using app formatter', () => {
  const source = '{"raw": "  alpha\\n末尾  ","present": undefined（字段存在）,"n": -0,"rows":[null,true,false,1.25e2,{"__proto__":{"kept":true}}]}';
  const value = parseCaptureReadonlyFields(source);
  const long = 'x'.repeat(150000); assert.equal(parseCaptureReadonlyFields(JSON.stringify(long)), long);
  assert.equal(value.raw, '  alpha\n末尾  '); assert.ok(Object.hasOwn(value, 'present')); assert.equal(value.present, undefined); assert.ok(!Object.hasOwn(value, 'missing')); assert.ok(Object.is(value.n, -0));
  assert.deepEqual(value.rows.slice(0,4), [null,true,false,125]); assert.ok(Object.hasOwn(value.rows[4], '__proto__')); assert.equal(Object.getPrototypeOf(value.rows[4]), Object.prototype); assert.equal(({} as { kept?: boolean }).kept, undefined);
  for (const bad of ['{"a":1,"a":2}', '[,]', '[1,]', '{"x":NaN}', '{"x":Infinity}', '{"x":undefined}', '{"x":null} tail', '{"x":01}', '{"x":1e999}', '('.repeat(10), '[]'.repeat(130000)]) assert.throws(() => parseCaptureReadonlyFields(bad));
});

function readonlyFacts() {
  const row = { key: 'capture-review:O', value: { id: 'O', raw: ' x ', own: undefined, n: -0 } };
  return { snapshot: { databaseName: 'synthetic', version: 1, schema: [], tables: [{ name: 'settings', keys: ['capture-review:O'], losslessRows: row }] }, local: { settings: [row], todos: [{ id: 'neighbor', text: 'untouched' }], outbox: [] }, allEvents: [{ seq: '9', entity: 'todos', entityId: 'neighbor' }] };
}
test('readonly oracle rejects every source/settings/ledger/pointer/editor change and all write attempts without allowances', () => {
  const before = readonlyFacts(), editor = { href: 'synthetic/quick-note', input: 'D-input', review: 'D', fields: [{ value: ' current D ' }] }, audit = { writes: [], dropped: 0 };
  assertCaptureCatalogUnchanged(before, structuredClone(before), editor, structuredClone(editor), audit);
  for (const mutate of [
    (x: ReturnType<typeof readonlyFacts>) => { x.local.settings[0].value.raw = 'changed'; },
    (x: ReturnType<typeof readonlyFacts>) => { x.snapshot.tables[0].keys.push('added'); },
    (x: ReturnType<typeof readonlyFacts>) => { x.local.settings.push({ key: 'lastPullAt', value: {} } as never); },
    (x: ReturnType<typeof readonlyFacts>) => { x.allEvents[0].seq = '10'; },
    (x: ReturnType<typeof readonlyFacts>) => { delete (x.local.settings[0].value as { own?: undefined }).own; },
    (x: ReturnType<typeof readonlyFacts>) => { x.local.settings[0].value.n = 0; },
  ]) { const changed = structuredClone(before); mutate(changed); assert.throws(() => assertCaptureCatalogUnchanged(before, changed, editor, editor, audit)); }
  for (const changed of [{ ...editor, input: 'O' }, { ...editor, review: 'O' }, { ...editor, fields: [{ value: 'O raw' }] }, { ...editor, href: 'hidden-old-route' }]) assert.throws(() => assertCaptureCatalogUnchanged(before, before, editor, changed, audit));
  for (const changed of [{ writes: [{ method: 'put', aborted: true }], dropped: 0 }, { writes: [], dropped: 1 }]) assert.throws(() => assertCaptureCatalogUnchanged(before, before, editor, editor, changed));
});

test('native write observer records original store/cursor writes and exact sync return/throw without additional requests', () => {
  class Store {
    name = 'settings'; transaction = { db: { name: 'synthetic-owner' }, mode: 'readwrite' }; calls = 0;
    put(value: unknown) { this.calls++; return value; } add(value: unknown) { this.calls++; return value; } delete() { this.calls++; throw new Error('original failure'); } clear() { this.calls++; return 'clear-request'; }
  }
  class Cursor { source = new Store(); update(value: unknown) { return value; } delete() { return 'cursor-delete'; } }
  const callbacks = new Map<string, (event: unknown) => void>(), context: Record<string, unknown> = { IDBObjectStore: Store, IDBCursor: Cursor, performance: { timeOrigin: 77, now: () => 5 }, structuredClone, document: { addEventListener: (key: string, fn: (event: unknown) => void) => callbacks.set(key, fn), removeEventListener: (key: string) => callbacks.delete(key) } };
  const before = ['put','add','delete','clear'].map(key => Object.getOwnPropertyDescriptor(Store.prototype,key));
  runInNewContext(`(${installCaptureCatalogWriteAudit.toString()})()`, context);
  const store = new Store(), cursor = new Cursor(), request = { untouched: true };
  assert.equal(store.put(request), request); assert.equal(store.add(request), request); assert.throws(() => store.delete(), /original failure/); assert.equal(store.clear(), 'clear-request'); assert.equal(cursor.update(request), request); assert.equal(cursor.delete(), 'cursor-delete'); assert.equal(store.calls, 4);
  callbacks.get('keydown')!({ key: 'Escape', isTrusted: true, target: { tagName: 'BUTTON' } });
  const audit = context.__captureCatalogAudit as { snapshot: () => { writes: unknown[]; keys: unknown[] }; release: () => { restored: boolean; dropped: number } };
  assert.equal(audit.snapshot().writes.length, 6); assert.equal(audit.snapshot().keys.length, 1); const released = audit.release(); assert.equal(released.restored, true); assert.equal(released.dropped, 0);
  assert.deepEqual(['put','add','delete','clear'].map(key => Object.getOwnPropertyDescriptor(Store.prototype,key)), before); assert.equal(callbacks.size,0);
});

function lineState() {
  return { raw: 'one\ntwo', horizontalFits: true, whiteSpace: 'pre-wrap', painted: true, clip: { left:0,top:0,right:300,bottom:600 }, lines: ['one','two'].map((value,index) => ({ index,value,visible:true,rects:[{ left:10,top:10+index*20,right:40,bottom:25+index*20,width:30,height:15,hit:true }] })) };
}
test('every original line needs raw painted unclipped geometry; a true visible flag cannot hide clipping, cover or omissions', () => {
  const state = lineState(); assertCaptureCatalogLines([state],state.raw);
  for (const mutate of [
    (s: ReturnType<typeof lineState>) => { s.lines[1].rects[0].hit = false; },
    (s: ReturnType<typeof lineState>) => { s.lines[1].rects[0].bottom = 601; },
    (s: ReturnType<typeof lineState>) => { s.lines[1].value = 'same-looking substituted line'; },
    (s: ReturnType<typeof lineState>) => { s.lines[1].index = 0; },
    (s: ReturnType<typeof lineState>) => { s.painted = false; },
    (s: ReturnType<typeof lineState>) => { s.horizontalFits = false; },
  ]) { const changed = structuredClone(state); mutate(changed); assert.throws(() => assertCaptureCatalogLines([changed], state.raw)); }
  const page1 = structuredClone(state), page2 = structuredClone(state); page1.lines[1].rects[0].bottom = 700; page1.lines[1].visible = false; page2.lines[0].rects[0].top = -20; page2.lines[0].visible = false;
  assert.throws(() => assertCaptureCatalogLines([page1], state.raw)); assertCaptureCatalogLines([page1,page2], state.raw);
});

test('native extension preserves first error and tries remaining evidence before cleanup, even when first artifact write and local snapshot fail', async () => {
  const previous = process.env.GITHUB_ACTIONS; process.env.GITHUB_ACTIONS = 'true'; const order: string[] = [], saved: Record<string, unknown> = {}, original = new Error('original native failure');
  const facts = readonlyFacts(), editor = { href:'synthetic',input:'D',review:'D',fields:[] };
  const page = { evaluate: async (fn: (...args: unknown[]) => unknown) => { const code = fn.toString(); if (code.includes('Prior catalog observer')) { order.push('install'); return; } if (code.includes('Original editor missing')) return editor; if (code.includes('.release()')) { order.push('release'); return { restored:true,dropped:0 }; } if (code.includes('.snapshot()')) { order.push('snapshot'); return { writes:[],dropped:0 }; } throw Error('unexpected evaluate'); } };
  try {
    await assert.rejects(runCaptureCatalogReadOnly({ page,label:'contract',current:actor,reviewed:[],before:facts, facts:async (name:string) => { order.push(`facts:${name}`); if(name.endsWith('-failure')) throw Error('synthetic local snapshot failure'); return facts; }, readLedger:async () => { order.push('independent-ledger'); return { allEvents:facts.allEvents,pages:[] }; }, tap:async () => { throw original; }, save:async (name:string,value:unknown) => { saved[name] = structuredClone(value); order.push(`save:${name}`); if(name.endsWith('FIRST-FAILURE')) throw Error('synthetic disk failure'); }, capture:async () => { order.push('screenshot'); }, mark() {}, actions:[] }), error => error === original);
    assert.ok(order.includes('save:catalog-review-editor-before')); assert.deepEqual(saved['catalog-review-failure-editor-before'], editor); assert.deepEqual(saved['catalog-review-failure-editor-after'], editor);
    assert.ok(order.includes('snapshot')); assert.ok(order.includes('screenshot')); assert.ok(order.includes('facts:catalog-review-failure')); assert.ok(order.includes('independent-ledger')); assert.ok(order.includes('save:catalog-review-failure-ledger')); assert.ok(order.indexOf('release') > order.indexOf('independent-ledger')); assert.ok(order.indexOf('release') > order.indexOf('screenshot')); assert.ok(order.includes('save:catalog-review-collection-results'));
    const report = saved['catalog-review-collection-results'] as { originalError:string;collectionFailures:Array<{part:string}> };
    assert.equal(report.originalError, original.message); assert.deepEqual(report.collectionFailures.map(row=>row.part), ['first-error','source']);
  } finally { if(previous === undefined) delete process.env.GITHUB_ACTIONS; else process.env.GITHUB_ACTIONS = previous; }
});

test('same two capture-return profiles preserve exact prior controls, original speech, read-only source oracles and declared long native preparation', () => {
  const entry = readFileSync(new URL('../scripts/audit-capture-return-outcomes.mjs',import.meta.url),'utf8'), script = readFileSync(new URL('../scripts/audit-capture-catalog.mjs',import.meta.url),'utf8'), matrix=readFileSync(new URL('../../.github/workflows/ci.yml',import.meta.url),'utf8');
  assert.equal(CAPTURE_CATALOG_ENTRY,'查看本机未提交稿'); assert.match(entry, /'复制原文', '查看本机未提交稿', '查看确认稿'\]\.sort\(\)/); assert.match(entry, /'查看原文与本机确认稿', '查看本机未提交稿', '添加收支'/);
  assert.ok(entry.indexOf('const catalog = await runCaptureCatalogReadOnly') < entry.indexOf('const speech = await runCaptureSpeechTail')); assert.ok(entry.indexOf('const speech = await runCaptureSpeechTail') < entry.indexOf('await runCaptureCatalogLongOriginal'));
  assert.match(script, /page\.keyboard\.press\('Escape'\)/); assert.match(script,/Natural modal return focus must already be painted/); assert.doesNotMatch(script,/\.focus\(|\.scrollIntoView\(|\.click\(|setOfflineMode|indexedDB\.open|await import\(/);
  assert.match(script,/no settings exclusion/); assert.match(script,/No native write attempt/); assert.match(matrix,/keyboard-records, capture-return\]/); assert.doesNotMatch(matrix,/capture-catalog/);
});


test('both native catalog entry points reject local execution before accessing a harness', async () => {
  const previous = process.env.GITHUB_ACTIONS; delete process.env.GITHUB_ACTIONS;
  try { await assert.rejects(runCaptureCatalogReadOnly(undefined), /Hosted CI only/); await assert.rejects(runCaptureCatalogLongOriginal(undefined), /Hosted CI only/); }
  finally { if (previous !== undefined) process.env.GITHUB_ACTIONS = previous; }
});

test('failure editor read or write cannot skip independent source/ledger/screenshot collection or replace original UI error', async () => {
 const previous=process.env.GITHUB_ACTIONS;process.env.GITHUB_ACTIONS='true';
 try {for(const failure of ['read','write']){
  const original=new Error('original unreadable target'),saved:Record<string,unknown>={},order:string[]=[],facts=readonlyFacts(),editor={href:'synthetic',input:'D-input',review:'D-review',fields:[{value:' original D '}]};let editorReads=0;
  const page={evaluate:async(fn:(...args:unknown[])=>unknown)=>{const code=fn.toString();if(code.includes('Original editor missing')){editorReads++;if(editorReads===2&&failure==='read')throw Error('synthetic editor collection failure');return editor;}if(code.includes('Prior catalog observer'))return;if(code.includes('.snapshot()'))return{writes:[],dropped:0};if(code.includes('.release()')){order.push('release');return{restored:true,dropped:0};}throw Error('unexpected evaluate');}};
  await assert.rejects(runCaptureCatalogReadOnly({page,label:'contract',current:actor,reviewed:[],before:facts,facts:async()=>{order.push('source');return facts;},readLedger:async()=>{order.push('ledger');return{allEvents:facts.allEvents,pages:[]};},tap:async()=>{throw original;},save:async(name:string,value:unknown)=>{if(name.endsWith('failure-editor-after')&&failure==='write')throw Error('synthetic editor disk failure');saved[name]=structuredClone(value);},capture:async()=>{order.push('screenshot');},mark(){},actions:[]}),e=>e===original);
  assert.deepEqual(saved['catalog-review-editor-before'],editor);assert.deepEqual(saved['catalog-review-failure-editor-before'],editor);assert.equal(saved['catalog-review-failure-editor-after'],undefined);assert.ok(order.includes('ledger')&&order.includes('screenshot'));assert.ok(order.lastIndexOf('source')<order.indexOf('release')&&order.indexOf('ledger')<order.indexOf('release'));
  assert.deepEqual((saved['catalog-review-collection-results']as{collectionFailures:Array<{part:string}>}).collectionFailures.map(x=>x.part),['editor-after']);
 }}finally{if(previous===undefined)delete process.env.GITHUB_ACTIONS;else process.env.GITHUB_ACTIONS=previous;}
});
