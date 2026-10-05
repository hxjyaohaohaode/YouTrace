import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';

const sha256 = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');

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
