import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isCaptureDate, parseQuickNote } from '../src/services/parser.ts';
import { addDays, formatBusinessDate, parseBusinessDate } from '../src/utils/date.ts';
const parse = (text: string, date = '2026-10-04') => Reflect.apply(parseQuickNote, undefined, [text, { capturedAt: Date.parse(`${date}T15:59:00Z`), timeZone: 'Asia/Shanghai', date }]);
test('capture outcome: naked lunch amount and tomorrow stay explicit before confirmation', () => {
  const result = parse('明天要交报销单；午饭15');
  assert.equal(result.expenses[0]?.amount, 1500);
  assert.equal(result.expenses[0]?.currency, 'CNY');
  assert.equal(result.expenses[0]?.date, '2026-10-04');
  assert.equal(result.todos[0]?.text, '交报销单');
  assert.equal(result.todos[0]?.dueDate, '2026-10-05');
});
test('capture outcome: date interpretation uses captured business date, never later confirmation clock', () => {
  assert.equal(parse('后天要交报告', '2024-02-28').todos[0]?.dueDate, '2024-03-01');
  assert.equal(parse('明天要交报告', '2026-12-31').todos[0]?.dueDate, '2027-01-01');
});
test('capture outcome: partial native year edits remain canonical through relative-date preview', () => {
  const raw = '明天要交报销单；午饭18；后天要取快递';
  const context = { capturedAt: 1791345600000, timeZone: 'Asia/Shanghai', date: '2026-10-06' };
  const ordinary = parseQuickNote(raw, context);
  for (const year of ['0002', '0020', '0202', '2026']) {
    const date = `${year}-10-06`;
    assert.equal(isCaptureDate(date), true);
    assert.equal(formatBusinessDate(parseBusinessDate(date)), date);
    const result = parseQuickNote(raw, { ...context, date });
    assert.deepEqual(result, {
      ...ordinary,
      expenses: ordinary.expenses.map((expense) => ({ ...expense, date })),
      todos: ordinary.todos.map((todo, index) => ({ ...todo, dueDate: `${year}-10-0${7 + index}` })),
    });
  }
});
test('business date padding retains calendar rollover and strict invalid-date refusal', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('0099-12-31', 1), '0100-01-01');
  assert.equal(addDays('0020-02-28', 1), '0020-02-29');
  assert.equal(addDays('0200-02-28', 1), '0200-03-01');
  assert.equal(addDays('2024-02-28', 2), '2024-03-01');
  for (const date of ['2-10-06', '0000-10-06', '10000-10-06', '0200-02-29', '2026-02-30', '2026-13-01', '2026-01-00']) {
    assert.throws(() => parseBusinessDate(date), RangeError, date);
    assert.equal(isCaptureDate(date), false, date);
  }
});
test('capture outcome: absent mood remains unknown and quoted or negated emotion is not a personal fact', () => {
  for (const text of ['午饭15', '今天很开心但这不是我的心情，是书里一句话', '我并不开心']) {
    const result = parse(text); assert.equal(result.mood, null); assert.equal(result.moodScore, null);
  }
});
test('capture outcome: removing a recognized monetary clause never leaves regex capture fragments in a diary', () => {
  assert.equal(parse('午饭15元').diary, null);
  assert.equal(parse('午饭15元；今天见到老朋友').diary, '今天见到老朋友');
});
test('capture outcome: bare non-money quantities and imprecise dates are never invented exact commitments', () => {
  assert.equal(parse('药片15').expenses.length, 0);
  const result = parse('下周要整理资料');
  assert.equal(result.todos[0]?.dueDate, null);
  assert.equal(result.todos[0]?.dateUncertain, true);
});

test('money candidates fail closed on malformed amounts, foreign currency, negation and future tasks', () => {
  const context = { capturedAt: 1, timeZone: 'Asia/Shanghai', date: '2026-10-03' };
  for (const input of ['午饭15.999元', '午饭-15元', '咖啡$5', '咖啡€5', '没买咖啡20元', '明天午饭15', '书里写咖啡20元', '午饭1,000元', '咖啡1e3元', '午饭＋15元', '昨天要买书30']) assert.equal(parseQuickNote(input, context).expenses.length, 0, input);
  const todo = parseQuickNote('明天要买书30', context); assert.equal(todo.expenses.length, 0); assert.equal(todo.todos[0].text, '买书30'); assert.equal(todo.todos[0].dueDate, '2026-10-04');
  assert.equal(parseQuickNote('昨天午饭15', context).expenses[0].date, '2026-10-02');
  assert.equal(parseQuickNote('前天咖啡15.50元', context).expenses[0].date, '2026-10-01');
});
