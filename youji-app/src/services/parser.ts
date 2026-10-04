import { getMoodMeta } from '../utils/icons';
import { addDays, BUSINESS_TIME_ZONE, formatBusinessDate } from '../utils/date';

export type MoodLevel = 'happy' | 'good' | 'normal' | 'low' | 'sad' | 'angry' | 'anxious';
/** Evidence about the input, not the time the user eventually presses Save. */
export interface CaptureContext { capturedAt: number | null; timeZone: string | null; date: string | null }
export interface ParsedExpense { id: string; name: string; amount: number; amountText?: string; category: string; confirmed: boolean; date?: string | null; currency?: 'CNY'; isIncome?: boolean }
export interface ParsedHabit { id: string; name: string; done: boolean; confirmed: boolean; habitId?: string; date?: string | null }
export interface ParsedTodo { id: string; text: string; confirmed: boolean; dueDate?: string | null; dateUncertain?: boolean; dateConfirmed?: boolean }
export interface ParsedResult { expenses: ParsedExpense[]; diary: string | null; mood: MoodLevel | null; moodScore: number | null; habits: ParsedHabit[]; todos: ParsedTodo[] }
export const MOOD_LEVELS: MoodLevel[] = ['happy', 'good', 'normal', 'low', 'sad', 'angry', 'anxious'];
export const newCaptureContext = (at = Date.now()): CaptureContext => ({ capturedAt: at, timeZone: BUSINESS_TIME_ZONE, date: formatBusinessDate(new Date(at)) });
export function isCaptureDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function getMoodScore(level: MoodLevel): number { return getMoodMeta(level)?.score ?? 5; }
const categories: Array<[RegExp, string]> = [[/饭|餐|面|粉|奶茶|咖啡|早餐|午餐|晚餐/, 'food'], [/地铁|公交|打车|车费/, 'transport'], [/书|笔|打印|课程/, 'study'], [/电影|游戏|会员/, 'entertainment'], [/超市|衣服|鞋|零食|日用/, 'daily']];
const knownHabits = ['跑步', '背单词', '早睡', '读书', '运动', '健身', '冥想', '写日记'];
const clauses = (input: string) => input.split(/(?<!\d)[，,]|[，,](?!\d)|[。；;\n!?！？]+/).map(value => value.trim()).filter(Boolean);

function expenseClause(clause: string, context: CaptureContext): ParsedExpense | null {
  // Only complete, unambiguous monetary tokens become selected candidates.
  // Foreign currency, negation, quotations and future plans remain raw text.
  if (/[$€£₩₽₹]|美元|港币|日元|欧元|美金|[＋－+-]|要|得买|想买|没买|没花|没有|未支付|未付款|不买|不用|不会|取消|明天|后天|下周|这周|周末|打算|准备|计划|书里|书上|引用|别人说|朋友说|[“”「」]/.test(clause)) return null;
  let date = context.date;
  const dated = /^(今天|昨天|前天|\d{4}-\d{2}-\d{2})\s*/.exec(clause);
  if (dated) {
    if (isCaptureDate(dated[1])) date = dated[1];
    else date = isCaptureDate(context.date) ? addDays(context.date, dated[1] === '昨天' ? -1 : dated[1] === '前天' ? -2 : 0) : null;
    clause = clause.slice(dated[0].length);
  }
  const match = /^(.*?)\s*(\d+(?:\.\d{1,2})?)\s*(元|块|CNY|人民币)?$/i.exec(clause);
  if (!match) return null;
  const rawName = match[1].trim().replace(/[¥￥]$/, '').trim();
  // Reject suffix matches such as name='午饭15.' amount='999'.
  if (!rawName || /\d|[.,＋－+-]/.test(rawName) || /[¥￥]/.test(rawName)) return null;
  const hasMoneyVerb = /花了|花费|消费了|付了|用了|收入|收到/.test(rawName);
  if (!match[3] && !hasMoneyVerb && !categories.some(([pattern]) => pattern.test(rawName))) return null;
  const [whole, fraction = ''] = match[2].split('.');
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 10_000_000_000) return null;
  const name = rawName.replace(/(?:花了|花费|消费了|付了|用了|买了)\s*$/, '').trim() || '消费';
  if (name.length > 100) return null;
  return { id: '', name, amount, category: categories.find(([pattern]) => pattern.test(name))?.[1] ?? 'other', confirmed: true, date, currency: 'CNY', isIncome: /^(?:收入|收到)/.test(rawName) };
}
function todoClause(clause: string, context: CaptureContext): ParsedTodo | null {
  const match = /^(?:(今天|明天|后天|今晚|下周|这周|周末|\d{4}-\d{2}-\d{2})\s*)?(?:我)?(?:要|得|需要|记得|别忘了)(?:去|做)?(.{1,200})$/.exec(clause)
    ?? /^(明天|后天|今晚|下周|这周|周末)\s*(.{2,200})$/.exec(clause);
  if (!match) return null;
  const marker = match[1], text = match[2].trim();
  if (!text) return null;
  let dueDate: string | null = null, dateUncertain = false;
  if (marker) {
    if (isCaptureDate(marker)) dueDate = marker;
    else if (['今天', '今晚', '明天', '后天'].includes(marker) && isCaptureDate(context.date)) dueDate = addDays(context.date, marker === '明天' ? 1 : marker === '后天' ? 2 : 0);
    else dateUncertain = true;
  }
  return { id: '', text, confirmed: true, dueDate, dateUncertain };
}
function moodCandidate(input: string): { mood: MoodLevel | null; moodScore: number | null } {
  // A suggestion is still optional in the review; don't mistake quotations or
  // obvious negations for the person's mood. This is rules, not a diagnosis.
  if (/不是我的心情|书里|电影里|角色|引用|别人说|朋友说|同事说|[“”「」]|不(?:太|很|那么|怎么)?(?:开心|不错|平静|低落|难过|生气|焦虑)/.test(input)) return { mood: null, moodScore: null };
  const match = MOOD_LEVELS.find(level => { const meta = getMoodMeta(level); return meta && input.includes(meta.label); });
  return match ? { mood: match, moodScore: getMoodScore(match) } : { mood: null, moodScore: null };
}

/** Deterministic candidates. Never writes data, chooses ownership or calls a model. */
export function parseQuickNote(input: string, context: CaptureContext = newCaptureContext()): ParsedResult {
  const expenses: ParsedExpense[] = [], todos: ParsedTodo[] = [], habits: ParsedHabit[] = [], diary: string[] = [];
  const seenTodos = new Set<string>(), seenHabits = new Set<string>();
  for (const clause of clauses(input)) {
    const todo = todoClause(clause, context);
    const expense = todo ? null : expenseClause(clause, context);
    if (expense) { expenses.push({ ...expense, id: `exp-${expenses.length}` }); continue; }
    if (todo && !seenTodos.has(`${todo.text}|${todo.dueDate}`)) { seenTodos.add(`${todo.text}|${todo.dueDate}`); todos.push({ ...todo, id: `todo-${todos.length}` }); }
    for (const name of knownHabits) {
      if (!clause.includes(name) || seenHabits.has(name)) continue;
      const future = /明天|后天|今晚|下周|这周|周末|打算|待会|等会/.test(clause);
      const negated = /没去|没有|不想|没空|来不及|忘了|没.{0,3}(跑步|背单词|早睡|读书|运动|健身|冥想|写日记)/.test(clause);
      seenHabits.add(name); habits.push({ id: `habit-${habits.length}`, name, done: !negated && !future, confirmed: false, date: context.date });
    }
    // A task-only clause should not also be silently appended to a diary.
    if (!todo) diary.push(clause);
  }
  return { expenses, todos, habits, diary: diary.join('；') || null, ...moodCandidate(input) };
}
