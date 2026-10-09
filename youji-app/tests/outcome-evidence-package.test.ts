import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';

const sha256 = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'synthetic-outcome-package-'));
  await mkdir(join(root, 'scripts'));
  await copyFile(resolve(import.meta.dirname, '../scripts/package-outcome-evidence.mjs'), join(root, 'scripts/package-outcome-evidence.mjs'));
  return { root, evidence: join(root, 'test-artifacts/user-outcomes'), packed: join(root, 'test-artifacts/outcome-package'),
    run: () => spawnSync(process.execPath, [join(root, 'scripts/package-outcome-evidence.mjs')], { encoding: 'utf8', env: { ...process.env, GITHUB_SHA: 'synthetic-package-commit' } }) };
}

for (const state of ['no-artifacts', 'no-evidence', 'empty-evidence', 'malformed-report', 'partial-report']) {
  test(`evidence package records incomplete execution after ${state}`, async () => {
    const { root, evidence, packed, run } = await fixture();
    try {
      if (state === 'no-evidence') await mkdir(join(root, 'test-artifacts'));
      if (!['no-artifacts', 'no-evidence'].includes(state)) await mkdir(evidence, { recursive: true });
      const report = state === 'malformed-report' ? '{"metadata":' : state === 'partial-report' ? '{"metadata":{"startedAt":"2026-10-09T00:00:00Z"}}' : null;
      if (report) await writeFile(join(evidence, 'outcome-report.json'), report);
      const result = run();
      assert.equal(result.status, 0, result.stderr);
      const manifest = JSON.parse(await readFile(join(packed, 'manifest.json'), 'utf8'));
      assert.equal(manifest.executionEvidence.terminalReportPresent, false);
      assert.equal(manifest.executionEvidence.incomplete, true);
      assert.equal(manifest.commit, 'synthetic-package-commit');
      assert.deepEqual(manifest.files.map((file: { file: string }) => file.file).sort(), report ? ['INCOMPLETE.txt', 'outcome-report.json'] : ['INCOMPLETE.txt']);
      const marker = await readFile(join(evidence, 'INCOMPLETE.txt'), 'utf8');
      assert.match(marker, /INCOMPLETE HARNESS RUN/);
      assert.match(marker, /No successful outcome/);
      const archive = Buffer.concat(await Promise.all(manifest.parts.map((part: { file: string }) => readFile(join(packed, part.file)))));
      assert.equal(sha256(archive), manifest.archiveSha256);
      await writeFile(join(root, 'restored.tar.gz'), archive);
      const restored = join(root, 'restored'); await mkdir(restored);
      execFileSync('tar', ['-xzf', join(root, 'restored.tar.gz'), '-C', restored]);
      assert.equal(await readFile(join(restored, 'INCOMPLETE.txt'), 'utf8'), marker);
      if (report) assert.equal(await readFile(join(restored, 'outcome-report.json'), 'utf8'), report, 'A partial report is preserved byte-for-byte, never replaced by a fabricated result');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}

for (const location of ['artifacts-root', 'evidence-root', 'nested-entry']) {
  test(`evidence package refuses ${location} symlink without following it`, async () => {
    const { root, evidence, packed, run } = await fixture();
    const outside = await mkdtemp(join(tmpdir(), 'synthetic-outside-evidence-'));
    try {
      const sentinel = join(outside, 'keep.txt'); await writeFile(sentinel, 'unchanged outside bytes');
      if (location === 'artifacts-root') await symlink(outside, join(root, 'test-artifacts'), 'dir');
      else if (location === 'evidence-root') { await mkdir(join(root, 'test-artifacts')); await symlink(outside, evidence, 'dir'); }
      else { await mkdir(evidence, { recursive: true }); await symlink(outside, join(evidence, 'nested'), 'dir'); }
      const result = run();
      assert.notEqual(result.status, 0);
      await assert.rejects(readFile(join(packed, 'manifest.json')), { code: 'ENOENT' });
      assert.equal(await readFile(sentinel, 'utf8'), 'unchanged outside bytes');
      await assert.rejects(readFile(join(outside, 'INCOMPLETE.txt')), { code: 'ENOENT' });
      await assert.rejects(readFile(join(outside, 'outcome-package/manifest.json')), { code: 'ENOENT' });
      assert.deepEqual(await readdir(outside), ['keep.txt'], 'No directory or marker may be created through an outside symlink');
    } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
  });
}

test('evidence package refuses an existing package directory and preserves stale bytes', async () => {
  const { root, packed, run } = await fixture();
  try {
    await mkdir(packed, { recursive: true });
    const oldPart = join(packed, 'evidence.part-00'); await writeFile(oldPart, 'prior attempt bytes');
    const result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /EEXIST/);
    assert.equal(await readFile(oldPart, 'utf8'), 'prior attempt bytes');
    await assert.rejects(readFile(join(packed, 'manifest.json')), { code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

for (const name of ['INCOMPLETE.txt', 'outcome-report.json']) {
  test(`evidence package refuses the ${name} leaf symlink before reading or writing`, async () => {
    const { root, evidence, packed, run } = await fixture();
    const outside = await mkdtemp(join(tmpdir(), 'synthetic-outside-evidence-'));
    try {
      await mkdir(evidence, { recursive: true });
      const sentinel = join(outside, 'keep.txt'), bytes = '{"metadata":{"endedAt":"2026-10-09T00:00:00Z"},"syntheticOutside":true}';
      await writeFile(sentinel, bytes); await symlink(sentinel, join(evidence, name));
      const result = run(); assert.notEqual(result.status, 0);
      assert.equal(await readFile(sentinel, 'utf8'), bytes, 'A pre-existing marker symlink must not overwrite the outside target before collection rejects it');
      assert.match(result.stderr, /regular evidence file/);
      await assert.rejects(readFile(join(packed, 'manifest.json')), { code: 'ENOENT' });
      assert.deepEqual(await readdir(outside), ['keep.txt']);
    } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
  });
}

test('evidence package preserves an existing regular incomplete marker byte-for-byte', async () => {
  const { root, evidence, packed, run } = await fixture();
  try {
    await mkdir(evidence, { recursive: true });
    const original = Buffer.from('Original partial-run diagnostic\n\0retained bytes\n');
    await writeFile(join(evidence, 'INCOMPLETE.txt'), original);
    const result = run(); assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(await readFile(join(packed, 'manifest.json'), 'utf8'));
    assert.equal(manifest.executionEvidence.terminalReportPresent, false); assert.equal(manifest.executionEvidence.incomplete, true);
    assert.deepEqual(await readFile(join(evidence, 'INCOMPLETE.txt')), original);
    const recorded = manifest.files.find((entry: { file: string }) => entry.file === 'INCOMPLETE.txt');
    assert.equal(recorded.sha256, sha256(original)); assert.equal(recorded.bytes, original.length);
  } finally { await rm(root, { recursive: true, force: true }); }
});

for (const terminal of [true, false]) test(`evidence package preserves nested real-download bytes and ${terminal ? 'terminal' : 'incomplete'} state`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'synthetic-outcome-package-'));
  const evidence = join(root, 'test-artifacts/user-outcomes'), packed = join(root, 'test-artifacts/outcome-package');
  try {
    await mkdir(join(root, 'scripts'), { recursive: true });
    await mkdir(join(evidence, 'actual-download/nested'), { recursive: true });
    await copyFile(resolve(import.meta.dirname, '../scripts/package-outcome-evidence.mjs'), join(root, 'scripts/package-outcome-evidence.mjs'));
    const originals = new Map([
      ['actual-download/nested/原始 备份.json', Buffer.from('{"syntheticOnly":true,"original":{"targetDate":"","privateMemo":[null,"保留"]}}')],
      ['original-media.bin', Buffer.from([0, 255, 1, 127, 0, 10])],
    ]);
    if (terminal) originals.set('outcome-report.json', Buffer.from(JSON.stringify({ metadata: { endedAt: '2026-10-05T00:00:00Z' } })));
    for (const [name, bytes] of originals) await writeFile(join(evidence, name), bytes);
    const result = spawnSync(process.execPath, [join(root, 'scripts/package-outcome-evidence.mjs')], { encoding: 'utf8', env: { ...process.env, GITHUB_SHA: 'synthetic-package-commit' } });
    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(await readFile(join(packed, 'manifest.json'), 'utf8'));
    assert.equal(manifest.executionEvidence.terminalReportPresent, terminal);
    assert.equal(manifest.executionEvidence.incomplete, !terminal);
    assert.equal(manifest.commit, 'synthetic-package-commit');
    assert.equal(manifest.files.length, originals.size + Number(!terminal));
    const parts = [];
    for (const part of manifest.parts) {
      const bytes = await readFile(join(packed, part.file));
      assert.equal(bytes.length, part.bytes); assert.equal(sha256(bytes), part.sha256); parts.push(bytes);
    }
    const archive = Buffer.concat(parts);
    assert.equal(archive.length, manifest.archiveBytes); assert.equal(sha256(archive), manifest.archiveSha256);
    const restored = join(root, 'restored'); await mkdir(restored);
    await writeFile(join(root, 'reassembled.tar.gz'), archive);
    execFileSync('tar', ['-xzf', join(root, 'reassembled.tar.gz'), '-C', restored]);
    for (const [name, expected] of originals) {
      const recorded = manifest.files.find((file: { file: string }) => file.file === name);
      assert.ok(recorded, `Nested file missing from manifest: ${name}`);
      assert.equal(recorded.bytes, expected.length); assert.equal(recorded.sha256, sha256(expected));
      assert.deepEqual(await readFile(join(restored, name)), expected, 'Complete archive roundtrip retains exact original bytes and relative path');
    }
    if (!terminal) assert.match(await readFile(join(restored, 'INCOMPLETE.txt'), 'utf8'), /INCOMPLETE HARNESS RUN/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
