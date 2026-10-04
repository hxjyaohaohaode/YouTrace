// Preserve exact successful/failed evidence bytes in connector-downloadable parts.
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '..'), evidence = join(root, 'test-artifacts/user-outcomes'), destination = join(root, 'test-artifacts/outcome-package');
// An exclusive directory prevents stale parts from a prior attempt joining this run.
await mkdir(destination);
let terminalReportPresent = false;
try { const report = JSON.parse(await readFile(join(evidence, 'outcome-report.json'), 'utf8')); terminalReportPresent = typeof report.metadata?.endedAt === 'string'; } catch { /* Missing/partial report is evidence of incomplete execution, never success. */ }
const executionEvidence = { terminalReportPresent, incomplete: !terminalReportPresent, mediaVerification: 'Packaging preserves bytes only; playable video and complete trace require independent review.' };
if (!terminalReportPresent) await writeFile(join(evidence, 'INCOMPLETE.txt'), 'INCOMPLETE HARNESS RUN: no terminal result report was produced. The last partial checkpoint and any completed PNG/DOM, trace or media bytes are preserved unchanged. Missing or unfinished media are evidence gaps. No successful outcome, sourceEnd verification, or playable-video conclusion is inferred. Inspect the exact CI step status and partial checkpoint.\n');
const files = [];
for (const file of (await readdir(evidence)).sort()) { const body = await readFile(join(evidence, file)); files.push({ file, bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') }); }
const archive = join(destination, 'evidence.tar.gz'); execFileSync('tar', ['-czf', archive, '-C', evidence, '.']);
const body = await readFile(archive), size = 24 * 1024 * 1024, parts = [];
if (body.length > size * 16) throw new Error('Evidence exceeds configured artifact parts; expand packaging, never discard evidence');
for (let index = 0; index * size < body.length; index++) { const data = body.subarray(index * size, (index + 1) * size), file = `evidence.part-${String(index).padStart(2, '0')}`; await writeFile(join(destination, file), data); parts.push({ file, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') }); }
const reassembled = createHash('sha256'); let reassembledBytes = 0;
for (const part of parts) { const bytes = await readFile(join(destination, part.file)); reassembled.update(bytes); reassembledBytes += bytes.length; }
const archiveSha256 = createHash('sha256').update(body).digest('hex');
if (reassembledBytes !== body.length || reassembled.digest('hex') !== archiveSha256) throw new Error('Written evidence parts do not match complete archive');
const manifest = JSON.stringify({ format: 'ordered-byte-parts-of-tar-gzip', executionEvidence, commit: process.env.GITHUB_SHA, archiveBytes: body.length, archiveSha256, parts, files }, null, 2);
if (Buffer.byteLength(manifest) > 1024 * 1024) throw new Error('Evidence manifest exceeds 1 MiB summary limit');
await writeFile(join(destination, 'manifest.json'), manifest);
