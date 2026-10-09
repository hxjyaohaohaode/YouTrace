import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import { act, createElement } from 'react';
import { create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import ts from 'typescript';
import { getExpensePeriodTotals } from '../src/utils/expensePeriod';
import * as expenseFilters from '../src/components/expense/expenseListFilter';
import * as expensePresentation from '../src/components/expense/expensePresentation';
import { expenseOutcomeChecks } from '../scripts/audit-expense-outcomes.mjs';

// Actual page/component JSX and React state. Only data boundaries, motion host
// wrappers and router are doubles. This is not native layout, HTTP or IndexedDB
// acceptance, and does not mark hosted outcome journeys passed.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const require = createRequire(import.meta.url);
const host = (tag: string) => ({ children, ...props }: React.HTMLAttributes<HTMLElement>) => createElement(tag, props, children);
const icon = () => createElement('svg', { 'aria-hidden': true });
const motion = { div: host('div'), section: host('section'), button: host('button') };
const frame = ({ open, children, title, footer }: { open: boolean; children: React.ReactNode; title: string; footer: React.ReactNode }) => open ? createElement('div', { role: 'dialog' }, createElement('h3', {}, title), children, footer) : null;
const text = (node: ReactTestInstance | string): string => typeof node === 'string' ? node : node.children.map(child => text(child)).join('');
const exact = (tree: ReactTestRenderer, tag: string, label: string) => tree.root.findAllByType(tag).filter(node => text(node) === label);
const dates = { getToday: () => '2026-10-07', getDateDaysAgo: () => '2026-09-08', getBusinessMonth: () => '2026-10', formatDateLabel: (date: string) => date };
const categories = { food: { label: '餐饮', icon, color: 'black' }, transport: { label: '交通', icon, color: 'black' }, other: { label: '其他', icon, color: 'black' } };
function load(path: string, mocks: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: Record<string, React.ComponentType<Record<string, unknown>>> = {};
  runInNewContext(code, { exports, require: (name: string) => name.endsWith('.css') ? {} : mocks[name] ?? require(name), URLSearchParams, console, structuredClone, ...globals });
  return exports;
}
const input = ({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) => createElement('label', {}, label, createElement('input', props));
const router = { useLocation: () => ({ key: 'local-contract', search: '', state: null }), useNavigate: () => () => undefined };
const empty = () => null;
const fixture = [
  { id: 'today', name: 'Synthetic 同名记账', amount: 1234, date: '2026-10-07', category: 'food', isIncome: false },
  { id: 'yesterday', name: 'Synthetic 同名记账', amount: 1234, date: '2026-10-06', category: 'transport', isIncome: false },
  { id: 'sunday', name: 'Synthetic 自然周以外', amount: 321, date: '2026-10-04', category: 'other', isIncome: false },
  { id: 'last-month', name: 'Synthetic 上月记录', amount: 456, date: '2026-09-30', category: 'other', isIncome: false },
  { id: 'future', name: 'Synthetic 未来日期', amount: 567, date: '2026-10-08', category: 'other', isIncome: false },
  { id: 'income', name: 'Synthetic 今日收入', amount: 10001, date: '2026-10-07', category: 'other', isIncome: true },
  { id: 'weekly-income', name: 'Synthetic 本周收入', amount: 1002, date: '2026-10-06', category: 'other', isIncome: true },
  { id: 'boundary', name: 'Synthetic 近30天首日', amount: 222, date: '2026-09-08', category: 'food', isIncome: false },
  { id: 'before-window', name: 'Synthetic 近30天之前', amount: 9999, date: '2026-09-07', category: 'other', isIncome: false },
];

test('Mounted actual Expense renders exact period cents, current dated identities and native add control', async () => {
  const store = (select: (value: { items: typeof fixture; loaded: boolean }) => unknown) => select({ items: fixture, loaded: true });
  const StatsRow = load('../src/components/expense/StatsRow.tsx', { '../../stores/expenseStore': { useExpenseStore: store }, '../../utils/date': dates, '../../utils/expensePeriod': { getExpensePeriodTotals } }).StatsRow;
  const ExpenseDetail = load('../src/components/expense/ExpenseDetail.tsx', { '../../stores/expenseStore': { useExpenseStore: store }, '../../utils/date': dates, '../../utils/icons': { expenseCategoryIcons: categories }, './expenseListFilter': expenseFilters, './expensePresentation': expensePresentation, '../ui/Button': { Button: host('button') }, 'framer-motion': { motion, AnimatePresence: host('div') } }).ExpenseDetail;
  const Page = load('../src/pages/Expense.tsx', { 'react-router-dom': router, 'framer-motion': { motion }, '../components/ui/Button': { Button: host('button') }, '../stores/expenseStore': { useExpenseStore: store }, '../stores/coachStore': { useCoachStore: (select: (value: { insights: unknown[] }) => unknown) => select({ insights: [] }) }, '../utils/date': dates, '../utils/icons': { expenseCategoryIcons: categories }, '../components/expense': { StatsRow, ExpenseDetail, BudgetCard: empty, AddExpenseModal: ({ open }: { open: boolean }) => open ? createElement('div', { 'data-native-add-open': true }) : null } }).default;
  let tree!: ReactTestRenderer; await act(async () => { tree = create(createElement(Page)); });
  try {
    for (const [period, amount] of [['今日', '12.34'], ['本周', '24.68'], ['本月', '27.89']]) assert.equal(text(tree.root.findByProps({ 'aria-label': `${period}支出人民币${amount}元` })), `¥${amount}`);
    for (const row of fixture) assert.equal(tree.root.findAllByProps({ 'aria-label': `编辑记账 ${row.name} ${row.date} ${row.isIncome ? '收入' : '支出'} ${(row.amount / 100).toFixed(2)}元` }).length, 1);
    await act(async () => tree.root.findByProps({ 'aria-label': '添加花销' }).props.onClick());
    assert.equal(tree.root.findAllByProps({ 'data-native-add-open': true }).length, 1);
  } finally { await act(async () => tree.unmount()); }
});

test('Actual SpendingPatternCard keeps native audit scope, row meaning, exact cents and expense-only shares', async () => {
  const store = (select: (value: { items: typeof fixture; loaded: boolean }) => unknown) => select({ items: fixture, loaded: true });
  const Page = load('../src/pages/Expense.tsx', { 'react-router-dom': router, 'framer-motion': { motion }, '../components/ui/Button': { Button: host('button') }, '../stores/expenseStore': { useExpenseStore: store }, '../stores/coachStore': { useCoachStore: (select: (value: { insights: unknown[] }) => unknown) => select({ insights: [] }) }, '../utils/date': dates, '../utils/icons': { expenseCategoryIcons: categories }, '../components/expense': { StatsRow: empty, ExpenseDetail: empty, BudgetCard: empty, AddExpenseModal: empty } }).default;
  let tree!: ReactTestRenderer; await act(async () => { tree = create(createElement(Page)); });
  try {
    const title = exact(tree, 'h3', '消费模式')[0]; assert.ok(title);
    const header = title.parent!.parent!, card = header.parent!;
    const scope = header.findAllByType('p').map(text).join(' '), rows = card.children[1] as ReactTestInstance;
    const expected = expenseOutcomeChecks.expectedSpendingPattern(fixture);
    assert.equal(expenseOutcomeChecks.patternScopeMatches(scope, expected), true, scope);
    assert.equal(rows.children.length, 2);
    for (const [i, kind] of ['weekday', 'category'].entries()) assert.equal(expenseOutcomeChecks.patternRowMatches(text(rows.children[i]), kind, expected), true, kind);
  } finally { await act(async () => tree.unmount()); }
});

test('Mounted BudgetCard distinguishes unset, explicit zero and overspend with unchanged native edit controls', async () => {
  let status = 'unset', budget = 0, spent = 0, income = 0;
  const useExpenseStore = Object.assign((select: (value: object) => unknown) => select({ items: [], budgetStatus: status, monthBudget: budget, monthTotal: () => spent, monthIncome: () => income }), { getState: () => ({ setMonthBudget: async () => undefined }) });
  const Card = load('../src/components/expense/BudgetCard.tsx', { '../ui/Button': { Button: host('button') }, '../ui/Input': { Input: input }, '../../utils/date': dates, '../../stores/expenseStore': { useExpenseStore, parseYuanToFen: () => 0 }, './expensePresentation': expensePresentation }).BudgetCard;
  let tree!: ReactTestRenderer; await act(async () => { tree = create(createElement(Card)); });
  try {
    assert.match(text(tree.root), /尚未设置月预算/); assert.equal(exact(tree, 'button', '设置预算').length, 1);
    await act(async () => exact(tree, 'button', '设置预算')[0].props.onClick());
    assert.equal(tree.root.findAllByProps({ placeholder: '可明确设为 0' }).filter(node => node.type === 'input').length, 1);
    assert.equal(exact(tree, 'p', '预算仅保存在本设备。保存后才采用新金额；取消会保留本页输入。').length, 1);
    assert.equal(exact(tree, 'button', '保存预算').length, 1);
    await act(async () => exact(tree, 'button', '取消')[0].props.onClick());
    status = 'configured'; spent = 1435; income = 10001;
    await act(async () => tree.update(createElement(Card)));
    assert.match(text(tree.root), /已明确设置为 0 元，支出 ¥14\.35/); assert.match(text(tree.root), /本月收入 ¥100\.01/);
    budget = 1001; await act(async () => tree.update(createElement(Card)));
    assert.match(text(tree.root), /月预算 ¥10\.01/); assert.match(text(tree.root), /超出预算 ¥4\.34/); assert.doesNotMatch(text(tree.root), /剩余/);
  } finally { await act(async () => tree.unmount()); }
});

test('Mounted DiaryContent retains exact visible-card ancestry, original prose and full-content expansion', async () => {
  const content = '合成日记。'.repeat(90), item = { id: 'local-diary', date: '2026-10-06', createdAt: 1, content, mood: null, moodScore: null, source: 'manual' };
  const Page = load('../src/components/diary/DiaryContent.tsx', { 'react-router-dom': router, 'framer-motion': { motion, AnimatePresence: host('div') }, '../../stores/diaryStore': { useDiaryStore: (select: (value: object) => unknown) => select({ items: [item], loaded: true, loadError: '', removeItem() {} }) }, '../ui/Modal': { Modal: frame }, '../ui/Button': { Button: host('button') }, './DiaryEditor': { DiaryEditor: empty }, '../../services/toastBus': { toast: { success() {} } }, '../../utils/date': dates, '../../utils/icons': { getMoodMeta: () => null } }).DiaryContent;
  let tree!: ReactTestRenderer; await act(async () => { tree = create(createElement(Page)); });
  try {
    const edit = tree.root.findByProps({ 'aria-label': '编辑2026-10-06的日记' }), card = edit.parent!.parent!.parent!;
    assert.equal(card.type, 'div'); assert.equal(card.parent!.props.id, 'diary-record-local-diary');
    const prose = card.children.find(node => typeof node !== 'string' && node.type === 'p') as ReactTestInstance;
    assert.equal(text(prose), content); assert.match(text(card), /2026-10-06/); assert.match(text(card), /未记录心情/);
    assert.match(prose.props.className, /line-clamp-6/);
    await act(async () => exact(tree, 'button', '展开')[0].props.onClick());
    assert.equal(text(prose), content); assert.doesNotMatch(prose.props.className, /line-clamp/); assert.equal(exact(tree, 'button', '收起').length, 1);
    assert.equal(tree.root.findAllByProps({ 'aria-label': '删除2026-10-06的日记' }).length, 1);
  } finally { await act(async () => tree.unmount()); }
});

test('Mounted actual DiaryEditor preserves original date, optional mood, same-day refusal and retained-draft controls', async () => {
  const existing = { id: 'existing', date: '2026-10-07', content: '原始日记', mood: null, moodScore: null, createdAt: 1 }, initial = { id: 'new', date: '2026-10-07', content: '新的未提交原文', mood: null, moodScore: null, base: null };
  let opened: unknown;
  const Editor = load('../src/components/diary/DiaryEditor.tsx', { '../../db': { generateLocalId: () => 'new' }, '../../stores/diaryStore': { useDiaryStore: (select: (value: object) => unknown) => select({ items: [existing] }), sameDiarySnapshot: () => true, DiaryDateConflict: Error }, '../../utils/date': dates, '../../utils/icons': { MOOD_LEVELS: ['good'], getMoodMeta: (mood: string) => mood === 'good' ? { label: '不错', emoji: '', score: 7 } : null }, '../ui/Modal': { Modal: frame }, '../ui/Button': { Button: host('button') }, '../../services/toastBus': { toast: { success() {} } }, './diaryPresentation': { diaryWriteFailure: String }, './useDiaryEditorDraft': { useDiaryEditorDraft: () => { const [value, update] = React.useState(initial); return { value, update, prepare: async () => ({}), ready: true, restored: false, loading: false, pending: false, error: '' }; } } }).DiaryEditor;
  let tree!: ReactTestRenderer; await act(async () => { tree = create(createElement(Editor, { onClose() {}, onOpenRecord: (id: string) => { opened = id; } })); });
  try {
    assert.equal(tree.root.findByProps({ 'aria-label': '日记日期' }).props.value, '2026-10-07');
    assert.equal(tree.root.findByProps({ id: 'diary-content' }).props.value, initial.content);
    assert.equal(exact(tree, 'button', '未记录心情')[0].props['aria-pressed'], true);
    const comparison = tree.root.findByProps({ 'aria-label': '同日日记对照' });
    assert.match(text(comparison), /2026-10-07 已有日记，本次不会覆盖/); assert.match(text(comparison), /当前输入会保留为本机草稿/); assert.match(text(comparison), /不要为绕过冲突填写不真实的日期/);
    assert.equal(exact(tree, 'button', '保存')[0].props.disabled, true);
    assert.equal(exact(tree, 'button', '取消（保留草稿）').length, 1);
    await act(async () => exact(tree, 'button', '保留当前稿，打开这篇日记')[0].props.onClick());
    assert.equal(opened, 'existing');
  } finally { await act(async () => tree.unmount()); }
});

const memoryStorage = () => { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } }; };
const browserWindow = { addEventListener() {}, removeEventListener() {} };

test('Mounted Capture composer keeps header Return, named source/status/basis and passes edited raw text to one review', async () => {
  const context = { capturedAt: 1, date: '2026-10-07', timeZone: 'Asia/Shanghai' }, source = { key: 'capture-input:local', text: '', context };
  const navigated: unknown[] = [], saves: unknown[] = [], drafts: unknown[] = [];
  const Page = load('../src/pages/QuickNote.tsx', {
    'react-router-dom': { ...router, useNavigate: () => (...args: unknown[]) => { navigated.push(structuredClone(args)); } },
    'framer-motion': { motion, useReducedMotion: () => true }, '../components/ui/Button': { Button: host('button') },
    '../services/quickNoteIntegration': { forkCaptureInput: async () => source, saveCaptureInput: async (...args: unknown[]) => { saves.push(structuredClone(args)); }, createCaptureDraft: async (...args: unknown[]) => { drafts.push(structuredClone(args)); return { id: 'review-local' }; }, saveCaptureDraft: async () => undefined, captureSessionKey: () => 'current-review' },
    '../services/capturePresentation': {}, '../services/parser': { newCaptureContext: () => context, parseQuickNote: () => ({ expenses: [], todos: [], habits: [] }) }, '../db': { db: { ownerId: 'synthetic-owner' } }, '../services/diagnostics': { recordDiagnostic() {} },
  }, { window: browserWindow, sessionStorage: memoryStorage(), setTimeout, clearTimeout }).default;
  let tree!: ReactTestRenderer; await act(async () => { tree = create(createElement(Page)); });
  try {
    const composer = tree.root.findAllByType('section').find(node => node.props['data-component'] === 'capture-composer')!;
    assert.ok(composer); assert.equal(composer.findByType('header').findByProps({ 'aria-label': '返回' }).type, 'button');
    assert.equal(tree.root.findByProps({ 'aria-label': '速记内容' }).props.value, '');
    assert.equal(tree.root.findByProps({ 'aria-label': '记录基准日期' }).props.value, context.date);
    assert.equal(exact(tree, 'summary', `记录基准：${context.date}（Asia/Shanghai）`).length, 1);
    assert.equal(exact(tree, 'span', '原文已保留在本机').length, 1);
    await act(async () => tree.root.findByProps({ 'aria-label': '速记内容' }).props.onChange({ target: { value: '合成原文；明天交资料' } }));
    assert.equal(tree.root.findByProps({ 'aria-label': '速记内容' }).props.value, '合成原文；明天交资料');
    await act(async () => exact(tree, 'button', '查看确认稿')[0].props.onClick());
    assert.equal(drafts.length, 1); assert.deepEqual(drafts[0], ['合成原文；明天交资料', source, context]);
    assert.deepEqual(navigated, [['/quick-note/result?draft=review-local', { state: { draftId: 'review-local' } }]]);
    assert.ok(saves.length >= 2);
  } finally { await act(async () => tree.unmount()); }
});

test('Mounted actual Capture review exposes all audited named fields, exact selected scope and unchanged raw on correction/Return', async () => {
  const context = { capturedAt: 1, date: '2026-10-07', timeZone: 'Asia/Shanghai' };
  const original = { id: 'review-local', inputKey: 'capture-input:local', ownerId: 'synthetic-owner', sessionRevision: 'local-session', dataEpoch: 'initial', input: '明天交资料；午饭15；合成尾记', context,
    expenses: [{ id: 'expense-local', name: '午饭', amount: 1500, amountText: '15', category: 'food', confirmed: true, date: context.date, currency: 'CNY', isIncome: false }],
    todos: [{ id: 'todo-local', text: '交资料', confirmed: true, dueDate: '2026-10-08', dateConfirmed: true }], habits: [], diary: '合成尾记', diaryDate: context.date, mood: null, moodScore: null, moodConfirmed: false };
  const snapshots: typeof original[] = [], navigated: unknown[] = [];
  const Checkbox = load('../src/components/ui/Checkbox.tsx', { 'framer-motion': { motion: { span: host('span') } } }).Checkbox;
  const Page = load('../src/pages/QuickNoteResult.tsx', {
    'react-router-dom': { ...router, useLocation: () => ({ key: 'review', search: '?draft=review-local', state: null }), useNavigate: () => (...args: unknown[]) => { navigated.push(structuredClone(args)); } },
    'framer-motion': { motion, useReducedMotion: () => true }, '../components/ui/Button': { Button: host('button') }, '../components/ui/Checkbox': { Checkbox },
    '../services/parser': { getMoodScore: () => 7 },
    '../services/quickNoteIntegration': { loadCaptureReceipt: async () => null, loadCaptureDraft: async () => original, upgradeCaptureReview: (value: unknown) => value, captureFingerprint: JSON.stringify, captureSessionKey: () => 'current-review', saveCaptureDraft: async (value: typeof original) => { snapshots.push(structuredClone(value)); return value.id; }, CaptureChangedError: Error },
    '../utils/icons': { MOOD_LEVELS: ['good'], getMoodMeta: () => ({ label: '不错' }), EXPENSE_CATEGORY_KEYS: Object.keys(categories), expenseCategoryIcons: categories, normalizeExpenseCategory: (value: string) => value },
    '../db': { db: { ownerId: 'synthetic-owner' }, generateLocalId: () => 'new-local' }, '../stores/habitStore': { useHabitStore: (select: (value: object) => unknown) => select({ items: [] }) }, '../stores/authStore': { useAuthStore: (select: (value: object) => unknown) => select({ user: { id: 'synthetic-owner', nickname: 'Synthetic' } }) },
    '../services/pendingEditorMemory': { readPendingEditor: () => null, retainPendingEditor: () => 'token', releasePendingEditor() {} }, '../services/apiClient': { SESSION_REVISION_KEY: 'session' }, '../services/captureReceiptView': {}, '../services/diagnostics': { recordDiagnostic() {} }, '../services/capturePresentation': { captureSaveFailure: String },
  }, { window: browserWindow, sessionStorage: memoryStorage(), localStorage: memoryStorage() }).default;
  let tree!: ReactTestRenderer; await act(async () => { tree = create(createElement(Page)); });
  try {
    for (const label of ['第1笔收支名称', '第1笔金额（人民币元）', '第1笔记录日期', '第1笔收支方向', '第1笔分类', '第1个待办内容', '第1个待办截止日期', '日记日期', '日记内容', '记录第1笔收支', '记录第1个待办', '将这段文字记入日记', '我愿意记录这次心情']) assert.equal(tree.root.findAllByProps({ 'aria-label': label }).length, 1, label);
    for (const label of ['添加收支', '移除第1笔收支', '添加待办', '移除第1个待办', '添加习惯打卡']) assert.equal(tree.root.findAllByType('button').filter(node => node.props['aria-label'] === label).length, 1, label);
    assert.equal(text(tree.root.findByProps({ 'aria-label': '本次保存范围' })), '原文 + 1 笔收支 · 1 个待办 · 记入日记 · 不记录情绪');
    assert.equal(tree.root.findByProps({ 'aria-label': '我愿意记录这次心情' }).props.checked, false);
    assert.equal(exact(tree, 'button', '不设截止日期').length, 1); assert.equal(exact(tree, 'button', '确认保存所选记录').length, 1);
    const rawDetails = exact(tree, 'summary', '查看原文与本机确认稿')[0].parent!;
    assert.equal(rawDetails.props.open, undefined); assert.equal(text(rawDetails.children[1]), original.input);
    await act(async () => tree.root.findByProps({ 'aria-label': '第1笔金额（人民币元）' }).props.onChange({ target: { value: '16.25' } }));
    assert.equal(snapshots.at(-1)!.expenses[0].amount, 1625); assert.equal(snapshots.at(-1)!.input, original.input);
    await act(async () => tree.root.findAllByType('button').find(node => node.props['aria-label'] === '返回')!.props.onClick());
    assert.deepEqual(navigated, [['/quick-note', { state: { reviewId: original.id, inputKey: original.inputKey } }]]);
    assert.equal(snapshots.at(-1)!.input, original.input); assert.equal(snapshots.at(-1)!.expenses[0].amount, 1625);
  } finally { await act(async () => tree.unmount()); }
});
