import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import { act } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import ts from 'typescript';
import * as diaryFocusReturn from '../src/components/diary/useDiaryFocusReturn';
import { getExpensePeriodTotals } from '../src/utils/expensePeriod';

// Real page JSX/hooks rendered with synthetic read-only stores and host controls.
// This tests rendering/interaction, not browser geometry or persistence.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const require = createRequire(import.meta.url);
const button = ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => React.createElement('button', props, children);
const icon = () => React.createElement('svg', { 'aria-hidden': true });
function loadComponent(path: string, mocks: Record<string, unknown>) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: Record<string, React.ComponentType> = {};
  runInNewContext(code, { exports, require: (id: string) => id.endsWith('.css') ? {} : mocks[id] ?? require(id), URLSearchParams, console });
  return exports;
}
const today = '2026-10-08';
let diaryState: { items: unknown[]; loaded: boolean; loadError: string; removeItem: () => void };
const diary = loadComponent('../src/components/diary/DiaryContent.tsx', {
  'react-router-dom': { useLocation: () => ({ search: '', key: 'test', state: null }), useNavigate: () => () => undefined },
  './useDiaryFocusReturn': diaryFocusReturn, './DiaryEditor': { DiaryEditor: () => React.createElement('div', { 'data-editor': true }, '可编辑日记') },
  'framer-motion': { motion: { div: ({ children }: { children: React.ReactNode }) => React.createElement('div', {}, children) }, AnimatePresence: ({ children }: { children: React.ReactNode }) => children },
  'lucide-react': { Plus: icon, BookOpen: icon, Sparkles: icon, ChevronDown: icon, ChevronUp: icon, Edit3: icon, Trash2: icon },
  '../../stores/diaryStore': { useDiaryStore: (select: (state: typeof diaryState) => unknown) => select(diaryState) },
  '../ui/Modal': { Modal: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? React.createElement('div', {}, children) : null },
  '../ui/Button': { Button: button },
  '../../services/toastBus': { toast: { success: () => undefined } },
  '../../utils/date': { getToday: () => today, formatDateLabel: (date: string) => date === today ? '今天' : '过去的一天' },
  '../../utils/icons': { getMoodMeta: () => null },
});
const text = (tree: ReactTestRenderer) => JSON.stringify(tree.toJSON());

test('Empty diary renders a dated writing surface, no fake mood metric, with working create action', async () => {
  diaryState = { items: [], loaded: true, loadError: '', removeItem() {} };
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(React.createElement(diary.DiaryContent)); });
  assert.match(text(tree), /今天，有什么想留下/);
  assert.doesNotMatch(text(tree), /平均心情|0%|平均分/);
  const createButton = tree.root.findAllByType('button').find(node => node.props['aria-label'] === '写日记')!;
  await act(async () => createButton.props.onClick());
  assert.equal(tree.root.findAllByProps({ 'data-editor': true }).length, 1);
  await act(async () => tree.unmount());
});

test('Unread diary is not represented as an empty journal', async () => {
  diaryState = { items: [], loaded: false, loadError: '合成读取故障', removeItem() {} };
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(React.createElement(diary.DiaryContent)); });
  assert.match(text(tree), /合成读取故障/);
  assert.doesNotMatch(text(tree), /今天，有什么想留下|0 篇已记录/);
  await act(async () => tree.unmount());
});

test('Short diary preserves prose, source and explicit access to its existing insight', async () => {
  diaryState = { items: [{ id: 'synthetic-diary', date: today, content: '合成原文，保持完整。', mood: null, moodScore: null, source: 'quicknote_aggregated', createdAt: 1, aiInsight: '已有洞察，非新生成。' }], loaded: true, loadError: '', removeItem() {} };
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(React.createElement(diary.DiaryContent)); });
  assert.match(text(tree), /合成原文，保持完整/);
  assert.match(text(tree), /来自已确认速记/);
  const expand = tree.root.findAllByType('button').find(node => node.props['aria-expanded'] === false)!;
  await act(async () => expand.props.onClick());
  assert.match(text(tree), /已有洞察，非新生成/);
  assert.equal(tree.root.findAllByProps({ 'aria-expanded': true }).length, 1);
  await act(async () => tree.unmount());
});

test('Expense summary renders actual period totals in yuan and excludes income', async () => {
  const items = [
    { id: 'expense', date: today, amount: 1234, isIncome: false },
    { id: 'income', date: today, amount: 99000, isIncome: true },
    { id: 'old', date: '2026-09-01', amount: 7800, isIncome: false },
  ];
  const module = loadComponent('../src/components/expense/StatsRow.tsx', {
    '../../stores/expenseStore': { useExpenseStore: (select: (state: { items: typeof items }) => unknown) => select({ items }) },
    '../../utils/date': { getToday: () => today }, '../../utils/expensePeriod': { getExpensePeriodTotals },
  });
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(React.createElement(module.StatsRow)); });
  assert.equal(tree.root.findAllByProps({ 'aria-label': '今日支出人民币12.34元' }).length, 1);
  assert.equal(tree.root.findAllByProps({ 'aria-label': '本月支出人民币12.34元' }).length, 1);
  assert.doesNotMatch(text(tree), /990\.00|78\.00/);
  await act(async () => tree.unmount());
});

test('Expense waits for a verified local read before displaying totals or an empty ledger', async () => {
  let loaded = false;
  const store = Object.assign((select: (state: { items: unknown[]; loaded: boolean }) => unknown) => select({ items: [], loaded }), { getState: () => ({ loadFromDB: async () => { throw new Error('synthetic unavailable'); } }) });
  const module = loadComponent('../src/pages/Expense.tsx', {
    'react-router-dom': { useLocation: () => ({ search: '', key: 'test', state: null }), useNavigate: () => () => undefined },
    'lucide-react': { Plus: icon, Sparkles: icon, TrendingUp: icon, ChevronRight: icon },
    'framer-motion': { motion: { div: 'div' } },
    '../components/expense': { BudgetCard: () => React.createElement('div', { 'data-budget': true }), StatsRow: () => React.createElement('div', { 'data-totals': true }), ExpenseDetail: () => React.createElement('div', { 'data-ledger': true }), AddExpenseModal: () => null },
    '../components/ui/Button': { Button: button },
    '../stores/expenseStore': { useExpenseStore: store },
    '../stores/coachStore': { useCoachStore: (select: (state: { insights: unknown[] }) => unknown) => select({ insights: [] }) },
    '../utils/icons': { expenseCategoryIcons: {} },
    '../utils/date': { getToday: () => today, getDateDaysAgo: () => '2026-09-09' },
  });
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(React.createElement(module.default)); });
  assert.match(text(tree), /正在读取本机收支/);
  assert.equal(tree.root.findAllByProps({ 'data-totals': true }).length, 0);
  assert.equal(tree.root.findAllByProps({ 'data-ledger': true }).length, 0);
  const retry = tree.root.findAllByType('button').find(node => node.children.includes('重试读取'))!;
  await act(async () => retry.props.onClick());
  assert.match(text(tree), /读取失败，请检查设备存储后重试/);
  assert.equal(tree.root.findAllByProps({ 'data-budget': true }).length, 0);
  loaded = true;
  await act(async () => tree.update(React.createElement(module.default)));
  assert.equal(tree.root.findAllByProps({ 'data-totals': true }).length, 1);
  assert.equal(tree.root.findAllByProps({ 'data-ledger': true }).length, 1);
  await act(async () => tree.unmount());
});

test('Expense compact scope keeps exact loaded count, discoverable caveats and usable intersection filters', async () => {
  const items = [
    { id: 'october', date: today, amount: 1234, isIncome: false, name: '合成午饭', category: 'food' },
    { id: 'september', date: '2026-09-01', amount: 7800, isIncome: false, name: '合成旧记录', category: 'other' },
  ];
  const filters = await import('../src/components/expense/expenseListFilter');
  const presentation = await import('../src/components/expense/expensePresentation');
  const module = loadComponent('../src/components/expense/ExpenseDetail.tsx', {
    'framer-motion': { motion: { div: ({ children }: { children: React.ReactNode }) => React.createElement('div', {}, children) }, AnimatePresence: ({ children }: { children: React.ReactNode }) => children },
    'lucide-react': { ArrowUpRight: icon, ArrowDownRight: icon },
    '../../stores/expenseStore': { useExpenseStore: (select: (state: { items: typeof items }) => unknown) => select({ items }) },
    '../../utils/icons': { expenseCategoryIcons: { food: { icon, label: '餐饮' }, other: { icon, label: '其他' } } },
    '../../utils/date': { formatDateLabel: (date: string) => date },
    './expensePresentation': presentation, './expenseListFilter': filters,
    '../ui/Button': { Button: button },
  });
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(React.createElement(module.ExpenseDetail, { onEdit: () => undefined })); });
  assert.equal(tree.root.findByType('details').props.open, undefined, 'Detailed caveats are initially collapsed');
  assert.deepEqual(tree.root.findByType('summary').children, ['统计范围']);
  assert.equal(tree.root.findByProps({ id: 'expense-local-scope' }).children.join(''), '本机记录 · 已加载 2 笔');
  assert.match(tree.root.findByProps({ id: 'expense-detail-scope' }).children.join(''), /不代表远端全部历史.*统计不随明细筛选变化/);
  assert.equal(tree.root.findAllByType('select').length, 2);
  await act(async () => tree.root.findByProps({ id: 'expense-filter-month' }).props.onChange({ target: { value: '2026-10' } }));
  assert.equal(tree.root.findByProps({ role: 'status' }).children.join(''), '当前明细：2026-10 · 所有类别，显示 1 / 2 笔');
  assert.equal(tree.root.findAllByProps({ id: 'expense-record-october' }).length, 1);
  assert.equal(tree.root.findAllByProps({ id: 'expense-record-september' }).length, 0);
  assert.equal(tree.root.findByProps({ id: 'expense-local-scope' }).children.join(''), '本机记录 · 已加载 2 笔');
  await act(async () => tree.unmount());
});
