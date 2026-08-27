import { getMoodMeta, type MoodMeta } from '../utils/icons';

export type MoodLevel = 'happy' | 'good' | 'normal' | 'low' | 'sad' | 'angry' | 'anxious';

export interface ParsedExpense {
  id: string;
  name: string;
  amount: number;
  category: string;
  confirmed: boolean;
}

export interface ParsedHabit {
  id: string;
  name: string;
  done: boolean;
  confirmed: boolean;
}

export interface ParsedTodo {
  id: string;
  text: string;
  confirmed: boolean;
}

export interface ParsedResult {
  expenses: ParsedExpense[];
  diary: string | null;
  mood: MoodLevel | null;
  moodScore: number;
  habits: ParsedHabit[];
  todos: ParsedTodo[];
}

export const MOOD_LEVELS: MoodLevel[] = ['happy', 'good', 'normal', 'low', 'sad', 'angry', 'anxious'];

const expenseKeywords: Array<[string, string]> = [
  ['饭', 'food'],
  ['餐', 'food'],
  ['面', 'food'],
  ['粉', 'food'],
  ['奶茶', 'food'],
  ['咖啡', 'food'],
  ['零食', 'daily'],
  ['超市', 'daily'],
  ['买', 'daily'],
  ['衣服', 'daily'],
  ['鞋', 'daily'],
  ['书', 'study'],
  ['笔', 'study'],
  ['打印', 'study'],
  ['地铁', 'transport'],
  ['公交', 'transport'],
  ['打车', 'transport'],
  ['电影', 'entertainment'],
  ['游戏', 'entertainment'],
  ['会员', 'entertainment'],
];

const knownHabits = ['跑步', '背单词', '早睡', '读书', '运动', '健身', '冥想', '写日记'];

const futureMarkers = ['明天', '后天', '今晚', '下周', '这周', '周末', '打算', '待会', '等会'];

const negationMarkers = ['没去', '没有', '不想', '没空', '来不及', '忘了'];

function stripAll(text: string, pattern: RegExp): string {
  return text.split(pattern).join('');
}

export function getMoodScore(level: MoodLevel): number {
  return getMoodMeta(level)?.score ?? 5;
}

function detectExpenses(input: string): ParsedExpense[] {
  const expenses: ParsedExpense[] = [];
  const seen = new Set<string>();

  const patterns = [
    /(\S+?)(\d+(?:\.\d+)?)\s*(?:元|块)/g,
    /(?:花了|用了|消费了|买了)(\d+(?:\.\d+)?)\s*(?:元|块)?/g,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(input)) !== null) {
      let name = match[1];
      let amount: number;

      if (!Number.isNaN(parseFloat(name)) && /^\d/.test(name.trim())) {
        amount = parseFloat(match[2]);
        const before = input.slice(0, match.index);
        const nounMatch = before.match(/(\S{1,4})(?:花了|用了|消费了|买了)$/);
        name = nounMatch ? nounMatch[1] : '消费';
      } else {
        amount = parseFloat(match[2]);
        if (Number.isNaN(amount)) amount = parseFloat(name);
      }

      if (!Number.isFinite(amount) || amount <= 0 || amount >= 100_000) continue;

      const key = `${name}-${amount}`;
      if (seen.has(key)) continue;
      seen.add(key);

      let category = 'other';
      for (const [keyword, canonical] of expenseKeywords) {
        if (name.includes(keyword)) {
          category = canonical;
          break;
        }
      }

      expenses.push({
        id: `exp-${expenses.length}`,
        name,
        amount: Math.round(amount * 100),
        category,
        confirmed: true,
      });
    }
  }

  return expenses;
}

function isNegated(input: string, index: number): boolean {
  const windowStart = Math.max(0, index - 8);
  const window = input.slice(windowStart, index);
  if (negationMarkers.some((marker) => window.includes(marker))) return true;
  return /没[^，。,.！!？?\s]{0,3}$/.test(window) || /不[^，。,.！!？?\s]{0,2}$/.test(window);
}

function hasFutureMarker(input: string, index: number): boolean {
  const windowStart = Math.max(0, index - 10);
  const window = input.slice(windowStart, index);
  return futureMarkers.some((marker) => window.includes(marker));
}

function detectHabits(input: string): ParsedHabit[] {
  const habits: ParsedHabit[] = [];

  for (const habit of knownHabits) {
    const index = input.indexOf(habit);
    if (index === -1) continue;

    const negated = isNegated(input, index);
    const future = !negated && hasFutureMarker(input, index);

    habits.push({
      id: `habit-${habits.length}`,
      name: habit,
      done: !negated && !future,
      confirmed: !future,
    });
  }

  return habits;
}

function detectMood(input: string): { mood: MoodLevel | null; score: number } {
  let bestMood: MoodLevel | null = null;
  let bestDeviation = 0;
  let bestScore = 5;

  for (const level of MOOD_LEVELS) {
    const meta: MoodMeta | null = getMoodMeta(level);
    if (!meta) continue;
    if (input.includes(meta.label)) {
      const deviation = Math.abs(meta.score - 5);
      if (deviation > bestDeviation) {
        bestMood = level;
        bestScore = meta.score;
        bestDeviation = deviation;
      }
    }
  }

  return { mood: bestMood, score: bestScore };
}

function detectTodos(input: string): ParsedTodo[] {
  const todos: ParsedTodo[] = [];
  const patterns = [
    /(?:要|得|需要|记得|别忘了)(?:去|做)?(.{2,20}?)(?:[，。,.\n；;]|$)/g,
    /(?:明天|后天|今晚|下周|这周|周末)(?:要|得|去|做)(.{2,20}?)(?:[，。,.\n；;]|$)/g,
  ];
  const seen = new Set<string>();

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;

    while ((match = pattern.exec(input)) !== null) {
      const text = match[1]?.trim();
      if (!text || text.length < 2 || text.length > 20 || seen.has(text)) {
        continue;
      }

      seen.add(text);
      todos.push({
        id: `todo-${todos.length}`,
        text,
        confirmed: true,
      });
    }
  }

  return todos;
}

function extractDiary(input: string): string | null {
  let diary = input;
  diary = stripAll(diary, /(\S+?)(\d+(?:\.\d+)?)\s*(?:元|块)/g);
  diary = stripAll(diary, /(?:花了|用了|消费了|买了)\d+(?:\.\d+)?\s*(?:元|块)?/g);

  diary = diary.replace(/\s+/g, ' ').trim();
  diary = diary.replace(/^[，。,.\s]+/, '').trim();
  diary = diary.replace(/[，。,.\s]+$/, '').trim();

  if (diary.length < 3) return null;
  return diary;
}

export function parseQuickNote(input: string): ParsedResult {
  const expenses = detectExpenses(input);
  const habits = detectHabits(input);
  const { mood, score } = detectMood(input);
  const todos = detectTodos(input);
  const diary = extractDiary(input);

  return {
    expenses,
    diary,
    mood,
    moodScore: score,
    habits,
    todos,
  };
}
