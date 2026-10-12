import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { seedLegacyBackupFixture, legacyBackupFacts, validateLegacyDownloadedEnvelope } from '../scripts/audit-legacy-backup.mjs';
import { exportLegacySnapshot } from '../src/db/legacySnapshot.ts';
after(async () => { await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase('youtrace'); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); }); });

test('native legacy fixture and independent semantic oracle verify real exporter without altering source', async () => {
  await seedLegacyBackupFixture(false);
  const before = await legacyBackupFacts(undefined);
  const data = JSON.parse(JSON.stringify(await exportLegacySnapshot()));
  const decoded = validateLegacyDownloadedEnvelope(data);
  assert.deepEqual(await legacyBackupFacts(decoded), before);
  assert.deepEqual(await legacyBackupFacts(undefined), before);
  await assert.rejects(seedLegacyBackupFixture(false), /must not replace/);
  assert.deepEqual(await legacyBackupFacts(undefined), before);
});

test('independent oracle exposes raw content, key, typed alias and binary corruption', async () => {
  const data = await exportLegacySnapshot(), original = await legacyBackupFacts(undefined);
  const mutate = [
    (value: ReturnType<typeof validateLegacyDownloadedEnvelope>) => { value.tables[1].rows[0].key = 42; },
    (value: ReturnType<typeof validateLegacyDownloadedEnvelope>) => { value.tables[1].rows[0].value.original = 'truncated'; },
    (value: ReturnType<typeof validateLegacyDownloadedEnvelope>) => { new Uint8Array(value.tables[1].rows[0].value.buffer)[0] = 0; },
    (value: ReturnType<typeof validateLegacyDownloadedEnvelope>) => { value.tables[1].rows[0].value.view = new Uint16Array(8); },
    (value: ReturnType<typeof validateLegacyDownloadedEnvelope>) => { value.tables[1].indexes = []; },
  ];
  for (const change of mutate) {
    const decoded = validateLegacyDownloadedEnvelope(data); change(decoded); assert.notDeepEqual(await legacyBackupFacts(decoded), original);
  }
  for (const bad of [{ ...data, format: 'youtrace-legacy-quarantine' }, { ...data, ownership: 'current-user' }, { ...data, tables: {} }, { ...data, keyGeneratorState: 'captured' }, { ...data, summary: [] }]) assert.throws(() => validateLegacyDownloadedEnvelope(bad));
});

test('declared unsupported fixture fails whole actual export and retains original raw source', async () => {
  await seedLegacyBackupFixture(true); const before = await legacyBackupFacts(undefined);
  await assert.rejects(exportLegacySnapshot(), /未生成/);
  assert.deepEqual(await legacyBackupFacts(undefined), before);
});

test('hosted native backup chain uses original warning and download, checking positive failure not only a timeout', async () => {
  const source = await readFile(new URL('../scripts/audit-legacy-backup.mjs', import.meta.url), 'utf8');
  assert.match(source, /process\.env\.GITHUB_ACTIONS, 'true'/); assert.match(source, /Browser\.downloadWillBegin/); assert.match(source, /Browser\.downloadProgress/);
  assert.match(source, /查看导出说明/); assert.match(source, /导出记录与结构备份/); assert.match(source, /document\.body\.innerText\.includes\('旧版记录与结构备份未生成/);
  assert.match(source, /assert\.equal\(begins\.length, completedEvents/); assert.match(source, /assert\.deepEqual\(await readdir\(directory\), completedFiles/);
  assert.doesNotMatch(source, /localStorage\.setItem|window\.location|evaluate\([^\n]*exportLegacy/);
});


test('independent oracle distinguishes File identity metadata and nested Error cause contents', async () => {
  const a = new File(['same bytes'], 'a.txt', { lastModified: 1 }), b = new File(['same bytes'], 'b.txt', { lastModified: 2 });
  assert.notDeepEqual(await legacyBackupFacts(a), await legacyBackupFacts(b));
  const error = new Error('same message', { cause: { retained: 'old' } });
  const before = await legacyBackupFacts(error); (error.cause as { retained: string }).retained = 'changed';
  assert.notDeepEqual(await legacyBackupFacts(error), before);
});

test('named current-owner oracle reads every table and key without creating missing databases', async () => {
  const name = 'synthetic-native-backup-owner';
  await assert.rejects(legacyBackupFacts(undefined, name));
  assert.equal((await indexedDB.databases()).some(db => db.name === name), false);
  const opening = indexedDB.open(name, 30);
  opening.onupgradeneeded = () => { opening.result.createObjectStore('settings', { keyPath: 'key' }); opening.result.createObjectStore('records'); };
  const database = await new Promise<IDBDatabase>((resolve, reject) => { opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error); });
  try {
    const tx = database.transaction(['settings', 'records'], 'readwrite');
    const complete = new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
    tx.objectStore('settings').put({ key: 'private', value: '原账号设置' }); tx.objectStore('records').put({ text: '原账号原文' }, 42); await complete;
    const before = await legacyBackupFacts(undefined, name);
    await assert.rejects(exportLegacySnapshot(), /未生成/);
    assert.deepEqual(await legacyBackupFacts(undefined, name), before);
    const changed = database.transaction('settings', 'readwrite'), done = new Promise<void>((resolve, reject) => { changed.oncomplete = () => resolve(); changed.onabort = () => reject(changed.error); });
    changed.objectStore('settings').put({ key: 'private', value: 'changed' }); await done;
    assert.notDeepEqual(await legacyBackupFacts(undefined, name), before);
  } finally { database.close(); await new Promise<void>((resolve, reject) => { const deletion = indexedDB.deleteDatabase(name); deletion.onsuccess = () => resolve(); deletion.onerror = () => reject(deletion.error); }); }
});
