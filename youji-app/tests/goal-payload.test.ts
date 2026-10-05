import test from 'node:test';
import assert from 'node:assert/strict';
import { goalSyncPayload } from '../src/services/goalPayload';
const source = { id: 'synthetic-payload-goal', title: 'Synthetic only', description: '', level: 'short', domain: '学习', priority: 'medium', progress: 25, targetDate: null, createdAt: 1 };
for (const key of Object.keys(source)) test(`Goal wire projection rejects private object under allowlisted ${key}`, () => {
  const value = { ...source, [key]: { unexpectedPrivate: 'Synthetic unselected audit detail' } };
  const before = structuredClone(value); assert.throws(() => goalSyncPayload(value), /尚未传输/); assert.deepEqual(value, before);
});
test('Goal wire keeps valid primitives without unknown local metadata', () => {
  const value = { ...source, unknownPrivate: { keepLocal: true }, updatedAt: 2, syncScope: 'local' };
  assert.deepEqual(goalSyncPayload(value), source); assert.equal(value.unknownPrivate.keepLocal, true);
});
test('Goal wire refuses invalid numerical audit values, preserving the raw source', () => {
  for (const createdAt of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER, '2026-01-01']) assert.throws(() => goalSyncPayload({ ...source, createdAt }), /尚未传输/);
});
