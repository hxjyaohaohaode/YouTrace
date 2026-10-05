import assert from 'node:assert/strict'
import { test } from 'node:test'
import { scheduleOccurrences } from '../src/services/scheduleExceptions.js'

test('server brief/chat project moved and cancelled occurrences rather than original series rows', () => {
  const exception = { occurrenceDate: '2026-10-12', date: '2026-10-13', title: 'Moved only once', startTime: '11:00', endTime: '12:00', type: 'work', location: 'Changed', remind: 0 }
  const series = { id: 'synthetic-schedule', date: '2026-10-05', repeat: 'weekly', startTime: '09:00', endTime: '10:00', title: 'Original', exceptions: JSON.stringify([exception]) }
  assert.equal(scheduleOccurrences([series], '2026-10-12', '2026-10-12').length, 0)
  assert.equal(scheduleOccurrences([series], '2026-10-13', '2026-10-13')[0]?.title, 'Moved only once')
  assert.equal(scheduleOccurrences([series], '2026-10-19', '2026-10-19')[0]?.title, 'Original')
  assert.equal(scheduleOccurrences([{ ...series, exceptions: JSON.stringify([{ ...exception, cancelled: true }]) }], '2026-10-12', '2026-10-13').length, 0)
})
