import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Wallet, BookOpen, Smile, Tag, Trash2, Plus, Check, ListTodo } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Checkbox } from '../components/ui/Checkbox';
import { parseQuickNote, type ParsedExpense, type ParsedHabit, type ParsedTodo, type MoodLevel } from '../services/parser';
import { useQuickNoteStore } from '../stores/quickNoteStore';
import { applyParsedResult } from '../services/quickNoteIntegration';
import { toast } from '../services/toastBus';
import { MOOD_LEVELS, getMoodMeta, EXPENSE_CATEGORY_KEYS, expenseCategoryIcons, normalizeExpenseCategory } from '../utils/icons';

const typeColors = {
  expense: { icon: Wallet, color: 'text-[var(--accent)]', bg: 'bg-[var(--accent-soft)]', label: '花销' },
  diary: { icon: BookOpen, color: 'text-[var(--success)]', bg: 'bg-[var(--success)]/8', label: '日记' },
  mood: { icon: Smile, color: 'text-[var(--warning)]', bg: 'bg-[var(--warning)]/8', label: '情绪' },
  habit: { icon: Tag, color: 'text-[var(--violet)]', bg: 'bg-[var(--violet)]/8', label: '习惯' },
  todo: { icon: ListTodo, color: 'text-[#5B5FC7]', bg: 'bg-[#5B5FC7]/8', label: '待办' },
};

const MAX_EXPENSE_AMOUNT_FEN = 100_000_000_00;

export default function QuickNoteResult() {
  const location = useLocation();
  const navigate = useNavigate();
  const addRecord = useQuickNoteStore((s) => s.addRecord);
  const input = (location.state as { input?: unknown })?.input;
  const safeInput = typeof input === 'string' ? input : '';

  const parsed = safeInput ? parseQuickNote(safeInput) : { expenses: [], diary: null, mood: null as MoodLevel | null, moodScore: 5, habits: [], todos: [] };

  const [expenses, setExpenses] = useState<ParsedExpense[]>(parsed.expenses);
  const [amountTexts, setAmountTexts] = useState<Record<string, string>>(() =>
    Object.fromEntries(parsed.expenses.map((e) => [e.id, e.amount ? String(e.amount / 100) : ''])),
  );
  const [habits, setHabits] = useState<ParsedHabit[]>(parsed.habits);
  const [todos, setTodos] = useState<ParsedTodo[]>(parsed.todos);
  const [diary, setDiary] = useState<string | null>(parsed.diary);
  const [mood, setMood] = useState<MoodLevel | null>(parsed.mood);
  const [moodScore, setMoodScore] = useState(parsed.moodScore);
  const [saving, setSaving] = useState(false);

  if (!safeInput) {
    return (
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 320 }}
        className="fixed inset-0 flex flex-col bg-[var(--bg)]"
        style={{ zIndex: 'var(--z-page-overlay)' }}
      >
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            type="button"
            onClick={() => navigate('/quick-note')}
            className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--surface-2)] text-[var(--text-2)] transition-colors hover:bg-[var(--border)]"
            aria-label="返回"
          >
            <ArrowLeft size={18} aria-hidden />
          </button>
          <h1 className="text-[15px] font-bold text-[var(--text-1)]">AI 拆分结果</h1>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <p className="text-sm font-medium text-[var(--text-3)]">没有输入内容</p>
            <button type="button" onClick={() => navigate('/quick-note')} className="mt-4 text-sm font-semibold text-[var(--primary)]">
              去记录
            </button>
          </div>
        </div>
      </motion.div>
    );
  }

  const toggleExpense = (id: string) => {
    setExpenses((prev) => prev.map((e) => (e.id === id ? { ...e, confirmed: !e.confirmed } : e)));
  };

  const updateExpense = (id: string, field: keyof ParsedExpense, value: string | number) => {
    setExpenses((prev) => prev.map((e) => (e.id === id ? { ...e, [field]: value } : e)));
  };

  const removeExpense = (id: string) => {
    setExpenses((prev) => prev.filter((e) => e.id !== id));
  };

  const addExpense = () => {
    setExpenses((prev) => [
      ...prev,
      { id: `exp-new-${Date.now()}-${prev.length}`, name: '', amount: 0, category: 'other', confirmed: true },
    ]);
  };

  const toggleHabit = (id: string) => {
    setHabits((prev) => prev.map((h) => (h.id === id ? { ...h, confirmed: !h.confirmed } : h)));
  };

  const updateHabit = (id: string, field: keyof ParsedHabit, value: string | boolean) => {
    setHabits((prev) => prev.map((h) => (h.id === id ? { ...h, [field]: value } : h)));
  };

  const removeHabit = (id: string) => {
    setHabits((prev) => prev.filter((h) => h.id !== id));
  };

  const toggleTodo = (id: string) => {
    setTodos((prev) => prev.map((todo) => (todo.id === id ? { ...todo, confirmed: !todo.confirmed } : todo)));
  };

  const updateTodo = (id: string, value: string) => {
    setTodos((prev) => prev.map((todo) => (todo.id === id ? { ...todo, text: value } : todo)));
  };

  const removeTodo = (id: string) => {
    setTodos((prev) => prev.filter((todo) => todo.id !== id));
  };

  const addTodo = () => {
    setTodos((prev) => [
      ...prev,
      { id: `todo-new-${Date.now()}-${prev.length}`, text: '', confirmed: true },
    ]);
  };

  const confirmedExpenses = expenses.filter((e) => e.confirmed);
  const invalidExpenses = confirmedExpenses.some(
    (e) => !e.name.trim() || !Number.isFinite(e.amount) || e.amount <= 0 || e.amount > MAX_EXPENSE_AMOUNT_FEN
  );

  const handleSave = async () => {
    if (invalidExpenses) {
      toast.error('请补全花销的名称和有效金额（大于0）');
      return;
    }
    if (saving) return;
    setSaving(true);
    try {
      await addRecord(safeInput);

      const result = await applyParsedResult(
        confirmedExpenses,
        habits.filter((h) => h.confirmed),
        todos.filter((todo) => todo.confirmed && todo.text.trim()),
        diary,
        mood,
        moodScore,
      );

      if (result.failures.length > 0) {
        toast.warning(`已保存大部分内容，${result.failures.length}项失败：${result.failures[0]}`);
      } else {
        const parts = [
          result.expenseCount > 0 && `${result.expenseCount}笔账单`,
          result.todoCount > 0 && `${result.todoCount}个待办`,
          (result.diaryCreated || result.diaryUpdated) && '日记',
          result.habitCount > 0 && `${result.habitCount}次打卡`,
        ].filter(Boolean);
        if (parts.length > 0) {
          toast.success(`已保存：${parts.join('、')}`);
        } else {
          toast.success('速记已保存');
        }
      }

      navigate('/');
    } catch {
      toast.error('保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const hasAnyData = expenses.length > 0 || diary !== null || mood !== null || habits.length > 0 || todos.length > 0;

  return (
    <motion.div
      initial={{ y: '100%' }}
      animate={{ y: 0 }}
      exit={{ y: '100%' }}
      transition={{ type: 'spring', damping: 28, stiffness: 320 }}
      className="fixed inset-0 flex flex-col bg-[var(--bg)]"
      style={{ zIndex: 'var(--z-page-overlay)' }}
      role="dialog"
      aria-label="AI 拆分结果"
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--surface-2)] text-[var(--text-2)] transition-colors hover:bg-[var(--border)]"
          aria-label="返回"
        >
          <ArrowLeft size={18} aria-hidden />
        </button>
        <h1 className="text-[15px] font-bold text-[var(--text-1)]">AI 拆分结果</h1>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 pb-4">
        <div className="rounded-[var(--radius-lg)] border border-[var(--border-light)] bg-[var(--surface)] p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--text-3)]">原始输入</p>
          <p className="mt-1.5 text-[13px] font-medium text-[var(--text-1)]">{safeInput}</p>
        </div>

        {!hasAnyData && (
          <div className="py-16 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--surface-2)]">
              <Smile size={28} className="text-[var(--text-3)]" aria-hidden />
            </div>
            <p className="text-sm font-medium text-[var(--text-3)]">AI 没有识别到可拆分的内容</p>
            <p className="mt-1 text-xs text-[var(--text-4)]">可以直接保存为一条纯文本速记</p>
          </div>
        )}

        {expenses.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            aria-label="识别到的花销"
            className="rounded-[var(--radius-lg)] border border-[var(--border-light)] border-l-[3px] border-l-[var(--accent)] bg-[var(--surface)] p-4"
          >
            <div className="mb-3 flex items-center gap-2">
              <div className={`flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] ${typeColors.expense.bg}`}>
                <Wallet size={16} className={typeColors.expense.color} aria-hidden />
              </div>
              <span className="text-[13px] font-bold text-[var(--text-1)]">{typeColors.expense.label}</span>
              <button type="button" onClick={addExpense} aria-label="添加一笔花销" className="ml-auto rounded-full p-2.5 text-[var(--accent)] transition-colors hover:bg-[var(--accent-soft)]">
                <Plus size={16} aria-hidden />
              </button>
            </div>
            {invalidExpenses && (
              <p role="alert" className="mb-2 text-xs font-medium text-[var(--danger)]">存在未填写名称或金额无效的条目，保存前请修正</p>
            )}
            <div className="space-y-2">
              {expenses.map((exp) => (
                <div key={exp.id} className="flex flex-wrap items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--surface-2)] px-3 py-2.5">
                  <Checkbox checked={exp.confirmed} onChange={() => toggleExpense(exp.id)} ariaLabel={`确认 ${exp.name || '该笔花销'}`} />
                  <input
                    value={exp.name}
                    onChange={(e) => updateExpense(exp.id, 'name', e.target.value.slice(0, 100))}
                    className="w-24 bg-transparent text-[13px] font-medium text-[var(--text-1)] outline-none"
                    placeholder="名称"
                    aria-label="花销名称"
                  />
                  <span className="text-[13px] font-medium text-[var(--text-3)]">¥</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={amountTexts[exp.id] ?? ''}
                    onChange={(e) => {
                      const text = e.target.value;
                      setAmountTexts((prev) => ({ ...prev, [exp.id]: text }));
                      const yuan = parseFloat(text);
                      const fen = Number.isFinite(yuan) && yuan > 0 ? Math.round(yuan * 100) : 0;
                      updateExpense(exp.id, 'amount', fen);
                    }}
                    className="w-20 bg-transparent font-mono text-[13px] font-medium tabular-nums text-[var(--text-1)] outline-none"
                    placeholder="0"
                    aria-label={`${exp.name || '花销'}金额`}
                  />
                  <select
                    value={normalizeExpenseCategory(exp.category)}
                    onChange={(e) => updateExpense(exp.id, 'category', e.target.value)}
                    aria-label={`${exp.name || '花销'}分类`}
                    className="rounded-full bg-transparent text-right text-xs font-medium text-[var(--text-3)] outline-none"
                  >
                    {EXPENSE_CATEGORY_KEYS.map((key) => (
                      <option key={key} value={key}>{expenseCategoryIcons[key].label}</option>
                    ))}
                  </select>
                  <button type="button" onClick={() => removeExpense(exp.id)} aria-label={`删除 ${exp.name || '花销'}`} className="-mr-1 shrink-0 rounded-[var(--radius-sm)] p-2.5 text-[var(--text-3)] transition-colors hover:bg-[var(--danger)]/10 hover:text-[var(--danger)]">
                    <Trash2 size={14} aria-hidden />
                  </button>
                </div>
              ))}
            </div>
          </motion.section>
        )}

        {diary !== null && (
          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            aria-label="识别到的日记"
            className="rounded-[var(--radius-lg)] border border-[var(--border-light)] border-l-[3px] border-l-[var(--success)] bg-[var(--surface)] p-4"
          >
            <div className="mb-2 flex items-center gap-2">
              <div className={`flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] ${typeColors.diary.bg}`}>
                <BookOpen size={16} className={typeColors.diary.color} aria-hidden />
              </div>
              <span className="text-[13px] font-bold text-[var(--text-1)]">{typeColors.diary.label}</span>
            </div>
            <textarea
              value={diary}
              onChange={(e) => setDiary(e.target.value.slice(0, 10000))}
              maxLength={10000}
              rows={3}
              aria-label="日记内容"
              className="w-full resize-none rounded-[var(--radius-sm)] bg-[var(--surface-2)] p-3 text-[13px] font-medium text-[var(--text-1)] outline-none"
            />
          </motion.section>
        )}

        {mood && (
          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            aria-label="识别到的情绪"
            className="rounded-[var(--radius-lg)] border border-[var(--border-light)] border-l-[3px] border-l-[var(--warning)] bg-[var(--surface)] p-4"
          >
            <div className="mb-3 flex items-center gap-2">
              <div className={`flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] ${typeColors.mood.bg}`}>
                <Smile size={16} className={typeColors.mood.color} aria-hidden />
              </div>
              <span className="text-[13px] font-bold text-[var(--text-1)]">{typeColors.mood.label}</span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className={`flex items-center gap-2 rounded-[var(--radius-sm)] px-3 py-2 ${getMoodMeta(mood)?.bg ?? ''}`}>
                <span className="text-lg" aria-hidden>{getMoodMeta(mood)?.emoji}</span>
                <span className="text-[13px] font-semibold">{getMoodMeta(mood)?.label}</span>
                <span className="text-xs font-medium text-[var(--text-3)]">{moodScore}/10</span>
              </div>
              <div className="flex flex-wrap gap-1" role="group" aria-label="选择情绪">
                {MOOD_LEVELS.map((level) => {
                  const meta = getMoodMeta(level)!;
                  return (
                    <button
                      key={level}
                      type="button"
                      onClick={() => {
                        setMood(level);
                        setMoodScore(meta.score);
                      }}
                      aria-pressed={mood === level}
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold transition-all duration-200 ${
                        mood === level
                          ? 'bg-[var(--primary-soft)] text-[var(--primary)]'
                          : 'bg-[var(--surface-2)] text-[var(--text-3)]'
                      }`}
                    >
                      {meta.emoji} {meta.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </motion.section>
        )}

        {habits.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            aria-label="识别到的习惯"
            className="rounded-[var(--radius-lg)] border border-[var(--border-light)] border-l-[3px] border-l-[var(--violet)] bg-[var(--surface)] p-4"
          >
            <div className="mb-3 flex items-center gap-2">
              <div className={`flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] ${typeColors.habit.bg}`}>
                <Tag size={16} className={typeColors.habit.color} aria-hidden />
              </div>
              <span className="text-[13px] font-bold text-[var(--text-1)]">{typeColors.habit.label}</span>
            </div>
            <div className="space-y-2">
              {habits.map((habit) => (
                <div key={habit.id} className="flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--surface-2)] px-3 py-2.5">
                  <Checkbox checked={habit.confirmed} onChange={() => toggleHabit(habit.id)} ariaLabel={`确认习惯 ${habit.name}`} />
                  <input
                    value={habit.name}
                    onChange={(e) => updateHabit(habit.id, 'name', e.target.value.slice(0, 100))}
                    className="min-w-0 flex-1 bg-transparent text-[13px] font-medium text-[var(--text-1)] outline-none"
                    aria-label="习惯名称"
                  />
                  <button
                    type="button"
                    onClick={() => updateHabit(habit.id, 'done', !habit.done)}
                    aria-pressed={habit.done}
                    className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold transition-all duration-200 ${
                      habit.done
                        ? 'bg-[var(--success)]/8 text-[var(--success)]'
                        : 'bg-[var(--surface)] text-[var(--text-3)]'
                    }`}
                  >
                    {habit.done ? '已完成' : '未完成'}
                  </button>
                  <button type="button" onClick={() => removeHabit(habit.id)} aria-label={`删除习惯 ${habit.name}`} className="-mr-1 shrink-0 rounded-[var(--radius-sm)] p-2.5 text-[var(--text-3)] transition-colors hover:bg-[var(--danger)]/10 hover:text-[var(--danger)]">
                    <Trash2 size={14} aria-hidden />
                  </button>
                </div>
              ))}
            </div>
          </motion.section>
        )}

        {todos.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            aria-label="识别到的待办"
            className="rounded-[var(--radius-lg)] border border-[var(--border-light)] border-l-[3px] border-l-[#5B5FC7] bg-[var(--surface)] p-4"
          >
            <div className="mb-3 flex items-center gap-2">
              <div className={`flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] ${typeColors.todo.bg}`}>
                <ListTodo size={16} className={typeColors.todo.color} aria-hidden />
              </div>
              <span className="text-[13px] font-bold text-[var(--text-1)]">{typeColors.todo.label}</span>
              <button type="button" onClick={addTodo} aria-label="添加一个待办" className="ml-auto rounded-full p-2.5 text-[#5B5FC7] transition-colors hover:bg-[#5B5FC7]/10">
                <Plus size={16} aria-hidden />
              </button>
            </div>
            <div className="space-y-2">
              {todos.map((todo) => (
                <div key={todo.id} className="flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--surface-2)] px-3 py-2.5">
                  <Checkbox checked={todo.confirmed} onChange={() => toggleTodo(todo.id)} ariaLabel={`确认待办 ${todo.text}`} />
                  <input
                    value={todo.text}
                    onChange={(e) => updateTodo(todo.id, e.target.value.slice(0, 200))}
                    className="min-w-0 flex-1 bg-transparent text-[13px] font-medium text-[var(--text-1)] outline-none"
                    placeholder="待办内容"
                    maxLength={200}
                    aria-label="待办内容"
                  />
                  <button type="button" onClick={() => removeTodo(todo.id)} aria-label={`删除待办 ${todo.text}`} className="-mr-1 shrink-0 rounded-[var(--radius-sm)] p-2.5 text-[var(--text-3)] transition-colors hover:bg-[var(--danger)]/10 hover:text-[var(--danger)]">
                    <Trash2 size={14} aria-hidden />
                  </button>
                </div>
              ))}
            </div>
          </motion.section>
        )}
      </div>

      <div className="border-t border-[var(--border-light)] p-4" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
        <Button onClick={handleSave} className="h-12 w-full text-[15px]" disabled={saving}>
          <Check size={16} className="mr-1 inline" aria-hidden />
          {saving ? '保存中...' : '确认保存'}
        </Button>
      </div>
    </motion.div>
  );
}
