import assert from 'node:assert/strict';
import { test } from 'node:test';
import { timelineKeyboardChecks as checks } from '../scripts/audit-timeline-keyboard.mjs';
import { expenseOutcomeChecks as expense } from '../scripts/audit-expense-outcomes.mjs';

// Pure false-green checks only. These fixtures do not claim native key delivery,
// real CSS visibility, browser return behavior or durability.
const values = [
  ['2026-10-07', 987, false], ['2026-10-06', 1234, false], ['2026-10-04', 321, false],
  ['2026-09-30', 456, false], ['2026-10-08', 567, false], ['2026-10-07', 10001, true],
  ['2026-10-06', 1002, true], ['2026-09-08', 222, false], ['2026-09-07', 9999, false],
].map(([date, amount, isIncome], index) => ({ date: String(date), amount: Number(amount), isIncome: Boolean(isIncome), name: index < 2 ? 'Synthetic 同名记账' : `Synthetic ${index}`, category: index === 1 ? 'transport' : 'other' }));
const wanted = values[1];
const layout = () => ({ rect: { width: 150, height: 24, top: 100, bottom: 124, left: 10, right: 160 }, styles: [{ visibility: 'visible', opacity: '1', display: 'block', contentVisibility: 'visible' }, { visibility: 'visible', opacity: '1', display: 'block', contentVisibility: 'visible' }] });
const member = (row: typeof wanted) => ({ ...checks.identity(row), rect: layout().rect, paint: { button: layout(), title: layout(), heading: layout() } });
const timeline = () => ({ url: '/timeline?range=30&from=2026-09-08&through=2026-10-07', periodLabels: ['固定期间：2026-09-08 至 2026-10-07（含首尾）。跨日与返回时保持此期间。'], present: true, loading: false, range: '30', pressed: ['近30天'], businessDay: '2026-10-07', from: '2026-09-08', through: '2026-10-07', rows: values.filter(row => row.date >= '2026-09-08' && row.date <= '2026-10-07').map(member) });
const reading = () => ({ timeline: timeline(), anchor: { ...checks.identity(wanted), matches: 1, node: 9, rect: { top: 200 }, geometry: { visible: true }, titleGeometry: { visible: true }, dateGeometry: { visible: true, text: wanted.date } }, active: { node: 9, tag: 'BUTTON', disabled: false, tabIndex: 0 }, viewport: { scrollY: 300 }, geometry: { visible: true }, modalCount: 0, modalAnimations: 0 });

test('Timeline scope needs the unique selected range, exact seven visible identities and actual business interval', () => {
  const correct = timeline(); assert.equal(checks.scopeResult(correct, values).pass, true);
  for (const change of [
    { url: '/timeline?range=7' },
    { url: '/timeline?range=30' },
    { url: '/timeline?range=30&from=2026-09-08' },
    { url: '/timeline?range=30&through=2026-10-07' },
    { url: '/timeline?range=30&from=2026-09-07&through=2026-10-06' },
    { url: '/timeline?range=30&from=2026-09-09&through=2026-10-07' },
    { url: '/timeline?range=30&from=2026-09-08&through=2026-10-08' },
    { url: '/timeline?range=30&from=invalid&through=2026-10-07' },
    { url: '/timeline?range=30&from=2026-09-08&through=2026-10-07&from=2026-09-08' },
    { url: '/timeline?range=30&from=2026-09-08&through=2026-10-07&record=neighbor' },
    { periodLabels: [] },
    { periodLabels: ['固定期间：2026-09-09 至 2026-10-08（含首尾）。跨日与返回时保持此期间。'] }, { range: '7' }, { pressed: ['近7天', '近30天'] }, { pressed: [] },
    { from: '2026-09-09' }, { through: '2026-10-08' }, { rows: correct.rows.slice(1) },
    { rows: [...correct.rows, checks.identity(values[4])] }, { rows: [...correct.rows.slice(1), checks.identity(values[8])] },
    { rows: correct.rows.map(row => row.date === wanted.date ? { ...row, date: '2026-10-07' } : row) },
    { rows: correct.rows.map(row => row.date === wanted.date ? { ...row, heading: '2026-10-07' } : row) },
    { rows: correct.rows.map(row => row.ariaLabel === checks.identity(wanted).ariaLabel ? { ...row, title: '-¥9.87 Synthetic 同名记账' } : row) },
  ]) {
    assert.equal(checks.scopeResult({ ...correct, ...change }, values).pass, false, 'Initial URL/period/membership validation must reject this independently of return-URL equality');
    assert.equal(checks.scopeResult({ ...correct, ...change }, values, correct).pass, false);
  }
  const reordered = { ...correct, url: '/timeline?from=2026-09-08&through=2026-10-07&range=30' };
  assert.equal(checks.scopeResult(reordered, values).pass, true, 'Initial parsing accepts equivalent key order while binding all exact fixed boundaries');
  assert.equal(checks.scopeResult(reordered, values, correct).pass, false, 'Return must retain the actual frozen origin URL, even for equivalent parameter order');
  const midnight = checks.scopeResult({ ...correct, businessDay: '2026-10-08', from: '2026-09-09', through: '2026-10-08' }, values, correct);
  assert.equal(midnight.pass, false); assert.equal(midnight.dayChanged, true);
  assert.match(midnight.note, /not a data-loss claim/);
  assert.equal(checks.scopeResult({ ...correct, range: '7', from: '2026-10-01' }, values, correct).dayChanged, false, 'A wrong range is not mislabeled as crossing midnight');
  const invisible = (mutate: (row: ReturnType<typeof member>) => void) => { const copy = timeline(); mutate(copy.rows[0]); assert.equal(checks.scopeResult(copy, values).pass, false, 'A non-target hidden DOM member must not count toward the seven rendered rows'); };
  invisible(row => { row.rect = { width: 0, height: 0, top: 0, bottom: 0, left: 0, right: 0 }; });
  for (const part of ['button', 'title', 'heading'] as const) {
    invisible(row => { row.paint[part].rect.height = 0; });
    invisible(row => { row.paint[part].styles[0].visibility = 'hidden'; });
    invisible(row => { row.paint[part].styles[1].opacity = '0'; });
    invisible(row => { row.paint[part].styles[1].display = 'none'; });
    invisible(row => { row.paint[part].styles[1].contentVisibility = 'hidden'; });
    invisible(row => { row.paint[part].styles = []; });
  }
  const offscreen = timeline(); offscreen.rows[0].rect.top = 5000; offscreen.rows[0].rect.bottom = 5024;
  for (const part of ['button', 'title', 'heading'] as const) { offscreen.rows[0].paint[part].rect.top = 5000; offscreen.rows[0].paint[part].rect.bottom = 5024; }
  assert.equal(checks.scopeResult(offscreen, values).pass, true, 'Paintable layout outside the viewport remains a range member without scrolling it into view');
});

test('Natural return accepts a remounted same logical row, never another node, late stolen focus or a clipped anchor', () => {
  const surface = reading(), { anchor } = surface;
  const origin = { ...structuredClone(surface), anchor: { ...anchor, node: 4, rect: { top: 20 } }, viewport: { scrollY: 80 } };
  const samples = [0, 100, 250, 500, 650, 700, 750, 800, 850, 900, 950].map(elapsedMs => ({ elapsedMs, ...structuredClone(surface) }));
  const result = checks.returnResult(samples, origin, wanted, values);
  assert.equal(result.pass, true); assert.deepEqual(result.deltas, { scrollY: 220, anchorTop: 180 }, 'Pixel deltas are evidence, not arbitrary rejection thresholds');
  for (const change of [
    { active: { ...surface.active, node: 4 } }, { active: { ...surface.active, tag: 'DIV' } },
    { active: { ...surface.active, disabled: true } }, { active: { ...surface.active, tabIndex: -1 } },
    { geometry: { visible: false } }, { modalCount: 1 }, { modalAnimations: 1 },
    { anchor: { ...anchor, matches: 2 } }, { anchor: { ...anchor, date: '2026-10-07' } },
    { anchor: { ...anchor, heading: '2026-10-07' } },
    { anchor: { ...anchor, dateGeometry: { visible: false, text: wanted.date } } },
    { anchor: { ...anchor, dateGeometry: { visible: true, text: '2026-10-07' } } },
    { anchor: { ...anchor, geometry: { visible: false } } }, { anchor: { ...anchor, titleGeometry: { visible: false } } },
  ]) assert.equal(checks.returnResult(samples.map(row => row.elapsedMs < 800 ? row : { ...row, ...change }), origin, wanted, values).pass, false);
  assert.equal(checks.returnResult(samples.slice(0, 5), origin, wanted, values).pass, false);
  const churning = samples.map(row => row.elapsedMs === 850 ? { ...row, active: { ...row.active, node: 10 }, anchor: { ...row.anchor, node: 10 } } : row);
  assert.equal(checks.returnResult(churning, origin, wanted, values).pass, false, 'A remounted return must settle to one usable node in its final window');
  const dayChanged = samples.map(row => ({ ...row, timeline: { ...row.timeline, businessDay: '2026-10-08' } }));
  assert.equal(checks.returnResult(dayChanged, origin, wanted, values).dayChanged, true);
  const wrongRows = samples.map(row => ({ ...row, timeline: { ...row.timeline, rows: row.timeline.rows.slice(1) } }));
  assert.equal(checks.returnResult(wrongRows, origin, wanted, values).pass, false);
  const savedValues = values.map((row, i) => i === 1 ? { ...row, amount: 1111 } : row), savedWanted = savedValues[1];
  const savedSamples = samples.map(row => ({ ...row, timeline: { ...row.timeline, rows: savedValues.filter(row => row.date >= '2026-09-08' && row.date <= '2026-10-07').map(member) }, anchor: { ...row.anchor, ...checks.identity(savedWanted) } }));
  assert.equal(checks.returnResult(savedSamples, origin, savedWanted, savedValues).pass, true);
  assert.equal(checks.returnResult(savedSamples, origin, wanted, values).pass, false);
});

test('Close and return require 350ms of continuously observed readiness within the original 4s limit', () => {
  const surface = reading(), expenseURL = '/expense?record=yesterday';
  const samples = [0, 3500, 3650, 3700, 3750, 3800, 3850, 3900, 3950, 4000].map(elapsedMs => ({ ...structuredClone(surface), elapsedMs }));
  const lateRoute = samples.map(row => ({ ...row, timeline: { ...row.timeline, loading: row.elapsedMs < 3750 } }));
  const late = checks.returnResult(lateRoute, surface, wanted, values);
  assert.equal(late.pass, false); assert.equal(late.readiness.readyMs, 250); assert.equal(late.readiness.settledAt, 3750);
  const enough = samples.map(row => ({ ...row, timeline: { ...row.timeline, loading: row.elapsedMs < 3650 } }));
  assert.equal(checks.returnResult(enough, surface, wanted, values).pass, true);
  const interrupted = enough.map(row => row.elapsedMs === 3750 ? { ...row, timeline: { ...row.timeline, loading: true } } : row);
  assert.equal(checks.returnResult(interrupted, surface, wanted, values).pass, false, 'An observed loading restart resets the contiguous ready suffix');
  assert.equal(checks.returnResult([...enough, { ...structuredClone(surface), elapsedMs: 4001 }], surface, wanted, values).pass, false, 'No pass from extending the deadline');
  const closed = enough.map(row => ({ ...row, timeline: { ...row.timeline, url: expenseURL }, modalAnimations: row.elapsedMs < 3650 ? 1 : 0 }));
  assert.equal(checks.closeResult(closed, expenseURL).pass, true);
  const lateClose = closed.map(row => ({ ...row, modalAnimations: row.elapsedMs < 3750 ? 1 : 0 }));
  assert.equal(checks.closeResult(lateClose, expenseURL).pass, false);
  assert.equal(checks.closeResult(closed.map(row => ({ ...row, elapsedMs: row.elapsedMs / 10 })), expenseURL).pass, false, 'Total observation must also reach 900ms');
  const lateWrongRoute = closed.map(row => row.elapsedMs < 3750 ? { ...row, timeline: { ...row.timeline, url: '/timeline' } } : row);
  assert.equal(checks.closeResult(lateWrongRoute, expenseURL).pass, false);
});

test('Reentry reverses the subsequent Tab only when frozen actual focus was the wanted logical row', () => {
  const frozen = reading();
  assert.equal(checks.reentryReverse(frozen, wanted), true);
  assert.equal(checks.reentryReverse({ ...frozen, geometry: { visible: false } }, wanted), true, 'Direction does not depend on the natural-return or painted-indicator pass label');
  for (const change of [{ active: { ...frozen.active, tag: 'BODY' } }, { active: { ...frozen.active, node: 2 } }, { anchor: { ...frozen.anchor, ...checks.identity(values[0]) } }, { anchor: { ...frozen.anchor, matches: 2 } }]) assert.equal(checks.reentryReverse({ ...frozen, ...change }, wanted), false);
});

test('Pre-open source freeze allows only the exact Expense draft envelope, preserving all unknown fields and ledger entries', () => {
  const source = { id: 'yesterday', ...wanted, createdAt: 123, unknownField: { presentUndefined: undefined, keep: ['old'] } };
  const other = { id: 'today', ...values[0] };
  const event = { seq: '1', entity: 'expenses', entityId: source.id, operation: 'upsert', data: { ...source } };
  const before = { local: { expenses: [source, other], settings: [{ key: 'existing-extra-setting', value: { preserve: true } }], outbox: [] }, server: [{ ...source }, { ...other }], events: [event], allEvents: [event, { seq: '2', entity: 'todos', entityId: 'old-todo', operation: 'upsert', data: { text: 'retain' } }] };
  const typed = { ...wanted, amount: '11.11' }, key = `record-draft:expense:${source.id}`;
  const envelope = { revision: 'a'.repeat(32), value: { id: source.id, ...typed, base: source } };
  const after = { ...structuredClone(before), local: { ...structuredClone(before.local), settings: [...structuredClone(before.local.settings), { key, value: envelope }] } };
  assert.equal(checks.draftWriteResult(before, after, source.id, typed, expense).pass, true);
  const invalid = (mutate: (copy: typeof after) => void) => { const copy = structuredClone(after); mutate(copy); assert.equal(checks.draftWriteResult(before, copy, source.id, typed, expense).pass, false); };
  invalid(copy => { copy.local.settings.at(-1)!.key = 'record-draft:expense:today'; });
  invalid(copy => { Object.assign(copy.local.settings.at(-1)!, { unknown: 'not-in-contract' }); });
  invalid(copy => { Object.assign(copy.local.settings.at(-1)!.value, { revision: '' }); });
  invalid(copy => { Object.assign(copy.local.settings.at(-1)!.value, { revision: 'not-a-generated-revision' }); });
  invalid(copy => { Object.assign(copy.local.settings.at(-1)!.value, { extra: true }); });
  for (const patch of [{ id: 'today' }, { name: 'wrong record' }, { date: '2026-10-07' }, { amount: '12.34' }, { category: 'food' }, { isIncome: true }, { extra: true }, { base: { ...source, amount: 1111 } }]) {
    invalid(copy => { const stored = copy.local.settings.at(-1)!.value as typeof envelope; Object.assign(stored.value, patch); });
  }
  invalid(copy => { Reflect.deleteProperty(copy.local.expenses[0], 'unknownField'); });
  invalid(copy => { copy.local.expenses[1].amount = 1234; });
  invalid(copy => { Object.assign(copy.server[0], { extra: 'changed' }); });
  invalid(copy => { copy.local.settings[0].value = { preserve: false }; });
  invalid(copy => { copy.allEvents.pop(); });
  invalid(copy => { copy.events[0].operation = 'delete'; });
  invalid(copy => { Object.assign(copy.local.outbox, { 0: { id: 'unexpected' } }); });
  invalid(copy => { copy.local.settings.push(copy.local.settings.at(-1)!); });
  const oldDraft = { ...structuredClone(before), local: { ...structuredClone(before.local), settings: [...before.local.settings, { key, value: envelope }] } };
  assert.equal(checks.draftWriteResult(oldDraft, after, source.id, typed, expense).pass, false, 'An unexplained pre-existing target draft cannot be ignored');
});

test('Activation revalidates the actual button node and visible semantics rather than only a matching label', () => {
  const before = { active: { node: 4, tag: 'BUTTON', tabIndex: 0, disabled: false, id: '', text: 'row text', ariaLabel: checks.identity(wanted).ariaLabel, logical: checks.identity(wanted) }, anchor: { ...reading().anchor, node: 4 }, geometry: { visible: true } };
  assert.equal(checks.activationResult(before, structuredClone(before)).pass, true);
  for (const patch of [{ node: 5 }, { tag: 'DIV' }, { disabled: true }, { tabIndex: -1 }, { text: 'different row' }, { logical: checks.identity(values[0]) }]) assert.equal(checks.activationResult(before, { ...before, active: { ...before.active, ...patch } }).pass, false);
  assert.equal(checks.activationResult(before, { ...before, geometry: { visible: false } }).pass, false);
  const wrongDate = { ...before, anchor: { ...before.anchor, heading: '2026-10-07' }, active: { ...before.active, logical: { ...before.active.logical, heading: '2026-10-07' } } };
  assert.equal(checks.activationResult(wrongDate, structuredClone(wrongDate)).pass, false, 'A consistently wrong visible date cannot pass merely because before/after agree');
  assert.equal(checks.activationResult(before, { ...before, anchor: { ...before.anchor, dateGeometry: { visible: false, text: wanted.date } } }).pass, false);
  assert.equal(checks.activationResult(before, { ...before, anchor: { ...before.anchor, dateGeometry: { visible: true, text: '2026-10-07' } } }).pass, false);
});
