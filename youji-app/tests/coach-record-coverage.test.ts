import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatRecordCoverageWelcome } from '../src/services/coldStartStrategy';

test('old source coverage never claims a long relationship or knowledge of the person', () => {
  const welcome = formatRecordCoverageWelcome('2020-01-01', 1);
  assert.match(welcome, /1条/); assert.match(welcome, /2020-01-01/);
  assert.match(welcome, /不代表连续记录或相处时长/);
  assert.doesNotMatch(welcome, /越来越了解|已经相处|观察你/);
});
test('zero and unknown-date coverage do not manufacture a period or an advice obligation', () => {
  assert.match(formatRecordCoverageWelcome(null, 0), /没有足够记录/);
  assert.doesNotMatch(formatRecordCoverageWelcome(null, 2), /最早的日期|undefined|null/);
});
