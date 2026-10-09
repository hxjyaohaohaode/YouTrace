import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import * as React from 'react';
import { act, createElement } from 'react';
import { create, type ReactTestInstance, type ReactTestRenderer, type ReactTestRendererJSON } from 'react-test-renderer';
import ts from 'typescript';
import * as dates from '../src/utils/date';
import { getHabitPeriod } from '../src/utils/habitPeriod';
import { habitErrorMessage } from '../src/components/habit/habitErrors';
import * as goalErrors from '../src/components/goal/goalErrors';
import { planningDayReadingMatches } from '../scripts/audit-planning-outcomes.mjs';
import { readScheduleDescriptor } from '../scripts/audit-schedule-keyboard.mjs';

// Mount actual page/component JSX and hooks against synthetic readonly stores.
// No browser, native focus/geometry, persistence, cloud ACK or CI claims are made.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const require = createRequire(import.meta.url);
const host = (tag: string) => ({ children, ...props }: React.HTMLAttributes<HTMLElement>) => createElement(tag, props, children);
const button = host('button');
const motion = { div: host('div'), button, article: host('article') };
const animate = ({ children }: { children: React.ReactNode }) => children;
const fakeDocument = { body: { style: { overflow: '' } }, activeElement: null, addEventListener() {}, removeEventListener() {} };
const globals = { structuredClone, document: fakeDocument, setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {}, requestAnimationFrame: () => 1, cancelAnimationFrame() {} };
function load(path: string, mocks: Record<string, unknown>) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: Record<string, React.ComponentType<Record<string, unknown>>> = {};
  runInNewContext(code, { exports, require: (name: string) => name.endsWith('.css') ? {} : mocks[name] ?? require(name), ...globals });
  return exports;
}
const modal = load('../src/components/ui/Modal.tsx', { 'framer-motion': { motion, AnimatePresence: animate }, '../../hooks/useMediaQuery': { useMediaQuery: () => false }, './modalFocus': { restoreModalFocus() {} } }).Modal;
const input = load('../src/components/ui/Input.tsx', {}).Input;
const pageHeader = load('../src/components/layout/PageHeader.tsx', { 'framer-motion': { motion } }).PageHeader;
const ui = { '../ui/Modal': { Modal: modal }, '../ui/Button': { Button: button }, '../ui/Input': { Input: input } };
function text(node: ReactTestInstance | string): string { return typeof node === 'string' ? node : node.children.map(text).join(''); }
function named(tree: ReactTestRenderer, label: string) { return tree.root.findAllByType('button').find(node => text(node) === label)!; }
async function mount(component: React.ComponentType<Record<string, unknown>>, props: Record<string, unknown> = {}) { let tree!: ReactTestRenderer; await act(async () => { tree = create(createElement(component, props)); }); return tree; }
async function close(tree: ReactTestRenderer) { await act(async () => tree.unmount()); }
const date = '2026-10-07';
const occurrence = (id: string, startTime: string, endTime: string) => ({ id, virtualId: id, occurrenceDate: date, date, title: '合成同名工作安排', startTime, endTime, type: 'work', location: `合成地点 ${id}`, repeat: 'none', remind: 0, createdAt: 1, updatedAt: 1, source: { id } });

function scheduleModule(items = [occurrence('early', '06:15', '06:45'), occurrence('normal', '09:00', '10:00'), occurrence('late', '23:15', '23:45')], selectedDate = date) {
  const state = { items, loaded: true, selectedDate, setSelectedDate(value: string) { state.selectedDate = value; } };
  const edited: unknown[] = [];
  const component = load('../src/components/schedule/ScheduleContent.tsx', {
    '../../utils/date': dates, 'framer-motion': { motion },
    '../../stores/scheduleStore': { useScheduleStore: (select: (value: typeof state) => unknown) => select(state), expandRecurringForRange: (rows: typeof items, start: string, end: string) => rows.filter(row => row.date >= start && row.date <= end) },
    '../ui/Card': { Card: host('div') }, './ScheduleEditor': { ScheduleEditor: ({ item }: { item: unknown }) => { edited.push(item); return createElement('div', { 'data-open-editor': true }); } },
  }).ScheduleContent;
  return { component, state, edited };
}
function semanticDayRow(row: ReactTestInstance, source: ReturnType<typeof occurrence>) {
  const accessible = `${source.startTime}-${source.endTime} ${source.title}`;
  const leaves = row.findAll(node => typeof node.type === 'string' && node.children.every(child => typeof child === 'string')).map(text);
  // Native geometry is deliberately a synthetic pass here; hosted capture must
  // still establish every real leaf's visibility. The real oracle binds values.
  return row.type === 'button' && row.props['aria-label'] === accessible && planningDayReadingMatches({ unique: true, visible: true, ariaLabel: row.props['aria-label'], title: leaves.find(value => value === source.title), startTime: leaves.find(value => value === source.startTime), endTime: leaves.find(value => value === source.endTime), titleReading: { visible: true }, startReading: { visible: true }, endReading: { visible: true } }, source);
}

test('Actual agenda retains exact record/time identity with independently visible start/end; wrong end and wrong row are rejected', async () => {
  const { component, state, edited } = scheduleModule(); const tree = await mount(component);
  try {
    const rows = tree.root.findAllByType('button').filter(row => /^\d{2}:\d{2}-/.test(row.props['aria-label'] ?? ''));
    assert.equal(rows.length, 3);
    for (const [index, source] of state.items.entries()) {
      assert.equal(semanticDayRow(rows[index], source), true);
      assert.equal(semanticDayRow(rows[index], { ...source, endTime: '22:22' }), false);
      assert.equal(semanticDayRow(rows[(index + 1) % rows.length], source), false);
    }
    await act(async () => rows[1].props.onClick()); assert.deepEqual(edited.at(-1), state.items[1]);
  } finally { await close(tree); }
});

test('Actual schedule controls have a single selected day/week/month state and retain full week time and location', async () => {
  const { component, state } = scheduleModule(); const tree = await mount(component);
  try {
    const selected = () => tree.root.findByProps({ 'aria-label': '视图切换' }).findAllByType('button').filter(node => node.props['aria-pressed'] === true || node.props['aria-selected'] === true).map(text);
    assert.deepEqual(selected(), ['日']); await act(async () => named(tree, '周').props.onClick()); assert.deepEqual(selected(), ['周']);
    for (const source of state.items) { const row = tree.root.findAllByType('button').filter(node => text(node).includes(source.title) && text(node).includes(`${source.startTime}-${source.endTime}`)); assert.equal(row.length, 1); assert.ok(text(row[0]).includes(source.location)); }
    await act(async () => named(tree, '月').props.onClick()); assert.deepEqual(selected(), ['月']);
    assert.equal(tree.root.findAllByType('button').filter(node => node.props['aria-label'] === '10月7日，3个日程').length, 1);
  } finally { await close(tree); }
});

test('Actual month exposes Monday–Sunday columns, leading previous-month cells and exact date selection', async () => {
  const { component, state } = scheduleModule([], '2026-11-01'); const tree = await mount(component);
  try {
    await act(async () => named(tree, '月').props.onClick());
    const weekdays = tree.root.findAllByType('div').filter(node => node.children.length === 1 && typeof node.children[0] === 'string' && /^[一二三四五六日]$/.test(node.children[0])).map(text);
    assert.deepEqual(weekdays, ['一', '二', '三', '四', '五', '六', '日']);
    const cells = tree.root.findAllByType('button').filter(node => /^\d+月\d+日，\d+个日程$/.test(node.props['aria-label'] ?? ''));
    assert.equal(cells.length, 42); assert.equal(cells[0].props['aria-label'], '10月26日，0个日程'); assert.equal(cells.at(-1)!.props['aria-label'], '12月6日，0个日程');
    await act(async () => cells.find(node => node.props['aria-label'] === '11月8日，0个日程')!.props.onClick());
    assert.equal(state.selectedDate, '2026-11-08');
    assert.equal(tree.root.findByProps({ 'aria-label': '视图切换' }).findAllByType('button').filter(node => node.props['aria-pressed'] || node.props['aria-selected']).map(text).join(''), '日');
  } finally { await close(tree); }
});

const habit = { id: 'habit', name: '合成同名散步', icon: '🌱', frequency: 'weekly', sortOrder: 0, createdAt: 1, updatedAt: 2, recentCheckins: [{ date: '2026-10-06', done: true }], checkinSources: [{ date: '2026-10-06', done: true }], source: { id: 'habit', createdAt: 1, updatedAt: 2 } };
function habitModule(items = [habit]) {
  const state = { items, loaded: true, refreshError: '', setHabitDone() {}, removeHabit() {}, loadFromDB() {}, addHabit() {} };
  return load('../src/components/habit/HabitList.tsx', { ...ui, 'framer-motion': { motion, AnimatePresence: animate }, '../../stores/habitStore': { useHabitStore: (select: (value: typeof state) => unknown) => select(state) }, '../../utils/date': { ...dates, getToday: () => date }, '../../utils/habitPeriod': { getHabitPeriod }, '../../db': { generateLocalId: () => 'synthetic' }, '../../services/toastBus': { toast: {} }, './habitErrors': { habitErrorMessage }, './HabitFrequencyModal': { HabitFrequencyModal: () => null }, '../../utils/icons': { habitFrequencyLabels: { daily: '每天', weekly: '每周' } } }).HabitList;
}
test('Actual weekly habit presents Monday–Sunday attainment without marking today done, retaining visible same-name icon and seven dated controls', async () => {
  const tree = await mount(habitModule());
  try {
    assert.match(text(tree.root), /本周 2026-10-05 至 2026-10-11（周一至周日）/); assert.match(text(tree.root), /本周已完成/); assert.match(text(tree.root), /2026-10-06/); assert.match(text(tree.root), /近7天实际记录/);
    const todayControl = tree.root.findAllByType('button').find(node => node.props['aria-label'] === `完成 ${habit.name}（仅今天 ${date}）`)!;
    assert.equal(todayControl.props['aria-pressed'], false); assert.ok(text(todayControl).includes(habit.icon));
    const days = tree.root.findAllByType('button').filter(node => /^2026-\d\d-\d\d /.test(node.props['aria-label'] ?? ''));
    assert.equal(days.length, 7); assert.equal(days.filter(node => node.props['aria-pressed']).length, 1); assert.ok(days.find(node => node.props['aria-pressed'])!.props['aria-label'].startsWith('2026-10-06 '));
    await act(async () => named(tree, '新建习惯').props.onClick());
    assert.equal(tree.root.findAllByType('input').filter(node => node.props.placeholder === '例如：跑步 5 公里').length, 1);
    assert.ok(named(tree, '每周')); assert.ok(named(tree, '保存')); assert.ok(named(tree, '取消'));
  } finally { await close(tree); }
});

test('Actual frequency dialog retains daily choice after quota refusal and provides preview, scope, timestamp and same-dialog retry', async () => {
  let writes = 0, closes = 0;
  const state = { setHabitFrequency: async () => { if (++writes === 1) throw new DOMException('Synthetic quota', 'QuotaExceededError'); return { viewUpdated: true }; } };
  const component = load('../src/components/habit/HabitFrequencyModal.tsx', { ...ui, '../../stores/habitStore': { useHabitStore: (select: (value: typeof state) => unknown) => select(state) }, '../../utils/date': { getToday: () => date }, '../../utils/habitPeriod': { getHabitPeriod }, '../../services/toastBus': { toast: { success() {}, warning() {} } }, './habitErrors': { habitErrorMessage } }).HabitFrequencyModal;
  const tree = await mount(component, { habit, onClose: () => { closes++; } });
  try {
    assert.equal(text(tree.root.findByType('h3')), '调整当前频率');
    await act(async () => named(tree, '每天').props.onClick());
    const preview = tree.root.findByProps({ 'aria-label': '频率调整预览' }); assert.match(text(preview), /立即/); assert.match(text(preview), /保存前：本周已完成/); assert.match(text(preview), /保存后：今天尚未记录/);
    assert.match(text(tree.root.findByProps({ 'aria-label': '频率调整范围说明' })), /历史打卡日期保持原样.*不支持指定未来生效日期/);
    assert.ok(text(tree.root.findByProps({ 'aria-label': '上次修改时间' })).includes('北京时间'));
    await act(async () => named(tree, '保存').props.onClick());
    assert.equal(writes, 1); assert.equal(closes, 0); assert.match(text(tree.root.findByProps({ role: 'alert' })), /空间不足.*没有保存.*所选频率仍保留/);
    assert.equal(named(tree, '每天').props['aria-pressed'], true); await act(async () => named(tree, '重试保存').props.onClick()); assert.equal(writes, 2); assert.equal(closes, 1);
  } finally { await close(tree); }
});

function todoModule(items: Array<{ id: string; text: string; priority: string; dueDate?: string; done: boolean }>) {
  const state = { items, loaded: true, undoStack: [] };
  return load('../src/components/todo/TodoList.tsx', { 'framer-motion': { motion, AnimatePresence: animate }, '../../stores/todoStore': { useTodoStore: (select: (value: typeof state) => unknown) => select(state), isOverdue: (item: (typeof items)[number]) => Boolean(!item.done && item.dueDate && item.dueDate < date) }, '../../services/toastBus': { toast: {} }, '../ui/Button': { Button: button }, '../../utils/date': { ...dates, getToday: () => date } }).TodoList;
}
test('Actual Todo rows preserve date/priority/checkbox identity and distinguish later or undated work', async () => {
  const records = [{ id: 'due', text: '合成归还图书', priority: 'high', dueDate: '2026-10-12', done: false }, { id: 'no-date', text: '合成归还图书', priority: 'low', dueDate: '', done: false }];
  const opened: unknown[] = [], tree = await mount(todoModule(records), { onEdit: (item: unknown) => opened.push(item) });
  try {
    for (const row of records) {
      const root = tree.root.findByProps({ id: `todo-record-${row.id}` }), editor = root.findByType('button');
      assert.equal(editor.props['aria-label'], `编辑待办 ${row.text} ${row.dueDate || '无日期'}`);
      assert.equal(text(editor.findAllByType('p')[0]), row.text); assert.ok(text(editor.findAllByType('p')[1]).includes(row.dueDate || '无截止日期'));
      assert.equal(text(root.findByType('span')), `${row.priority === 'high' ? '高' : '低'}优先级`);
      assert.equal(root.findByType('input').props.checked, false); await act(async () => editor.props.onClick()); assert.equal(opened.at(-1), row);
    }
    assert.ok(text(tree.root).includes('稍后与未定日期(2)')); assert.ok(text(tree.root).includes('2 件待办'));
  } finally { await close(tree); }
});

const goal = { id: 'goal', title: '合成同名目标', description: '合成可见区别 A', domain: '学习', level: 'short', priority: 'medium', progress: 25, targetDate: '2026-11-01', syncScope: 'account', createdAt: 1, updatedAt: 2 };
function goalModule(items = [goal]) {
  const state = { items, loaded: true, loading: false, statuses: { goal: '已同步' }, readError: null, publishedRevision: 1 };
  const user = { id: 'synthetic-owner', nickname: '合成用户', phone: '13900000000' };
  return load('../src/pages/Goal.tsx', { 'framer-motion': { motion, AnimatePresence: animate, useReducedMotion: () => false }, 'react-router-dom': { Link: host('a') }, '../db': { generateLocalId: () => 'synthetic-goal' }, '../stores/authStore': { useAuthStore: (select: (value: { user: typeof user }) => unknown) => select({ user }) }, '../stores/goalStore': { useGoalStore: (select: (value: typeof state) => unknown) => select(state), startGoalObservation: () => () => undefined, cloneGoalSnapshot: (value: unknown) => structuredClone(value), goalLevelLabels: { short: '短期', medium: '中期', long: '长期' }, goalPriorityColors: {} }, '../components/layout/PageHeader': { PageHeader: pageHeader }, '../components/ui/Modal': { Modal: modal }, '../components/ui/Button': { Button: button }, '../components/ui/Input': { Input: input }, '../components/settings/LegacyGoalRecovery': { LegacyGoalRecovery: () => null }, '../components/goal/goalErrors': goalErrors, '../components/goal/GoalErrorAlert': { GoalErrorAlert: ({ text: value }: { text: string }) => createElement('p', { role: 'alert' }, value) }, '../services/diagnostics': { recordDiagnostic() {} } }).default;
}
test('Actual Goal visible record and editor retain complete title/description/date and classification independent of placeholder changes', async () => {
  const tree = await mount(goalModule());
  try {
    const explanation = text(tree.root.findByProps({ 'data-component': 'goal-progress-explanation' }));
    for (const required of [/手动/, /调回|调整|撤销/, /云端确认/, /本机/]) assert.match(explanation, required);
    const card = tree.root.findByProps({ 'data-component': 'goal-card' }); assert.equal(text(card.findByType('h2')), goal.title); assert.ok(text(card).includes(goal.description)); assert.ok(text(card).includes('计划日期 2026-11-01')); assert.equal(card.findByProps({ role: 'progressbar' }).props['aria-valuenow'], 25);
    await act(async () => card.findAllByType('button').find(node => node.props['aria-label'] === `编辑目标 ${goal.title}`)!.props.onClick());
    assert.equal(text(tree.root.findByType('h3')), '编辑目标'); const editor = tree.root.findByProps({ 'data-component': 'goal-editor' });
    const inputs = editor.findAllByType('input'); assert.equal(inputs.length, 3); assert.deepEqual(inputs.map(node => node.props.value), [goal.title, goal.description, goal.targetDate]);
    const descriptionInput = inputs.find(node => node.props.value === goal.description)!; assert.equal(descriptionInput.props.id, 'goal-description'); assert.equal(descriptionInput.props['aria-label'], '目标说明'); assert.equal(editor.findAllByType('label').find(node => node.props.htmlFor === descriptionInput.props.id) && text(editor.findAllByType('label').find(node => node.props.htmlFor === descriptionInput.props.id)!), '描述（可选）');
    assert.deepEqual(editor.findAllByType('select').map(node => node.props.value), ['short', '学习', 'medium']); assert.ok(named(tree, '保存修改')); assert.ok(named(tree, '取消'));
  } finally { await close(tree); }
});

test('Actual Goal enrollment shows unchecked distinct source identity, no-date meaning, destination and every upload field', async () => {
  const local = [{ ...goal, syncScope: 'local', targetDate: '' }]; const tree = await mount(goalModule(local));
  try {
    await act(async () => named(tree, '选择同步旧目标').props.onClick());
    assert.equal(text(tree.root.findByType('h3')), '选择旧目标同步到账号'); assert.equal(tree.root.findByType('input').props.checked, false);
    const copy = text(tree.root.findByProps({ role: 'dialog' }));
    for (const required of ['目的账号：合成用户（139****0000）', '标题', '描述', '类型', '领域', '优先级', '进度', '计划日期', '目标编号', '创建时间', goal.description, '未设置', '原始空值仍留在本机备份中']) assert.ok(copy.includes(required), required);
    await act(async () => tree.root.findByType('input').props.onChange({ target: { checked: true } })); assert.ok(named(tree, '确认上传 1 个目标')); assert.ok(named(tree, '暂不上传'));
  } finally { await close(tree); }
});

test('Actual retained Goal source presents complete comparison and explicit local-copy scope without implicit writes', async () => {
  const current = { ...goal, syncScope: 'local' }, source = { ...current, description: '合成旧来源区别 B', progress: 75 };
  const change = { id: 'legacy-change', source, previousSource: current, current };
  const state = { legacyChanges: [change], publishedRevision: 1, loading: false, readError: null };
  let writes = 0;
  const component = load('../src/components/settings/LegacyGoalRecovery.tsx', {
    '../../stores/goalStore': { useGoalStore: (select: (value: typeof state) => unknown) => select(state), startGoalObservation: () => () => undefined, cloneLegacyGoalChange: (value: unknown) => structuredClone(value), resolveLegacyGoalChange: async () => { writes++; return { view: 'updated', copyId: 'copy' }; }, goalLevelLabels: { short: '短期' } },
    '../../stores/authStore': { useAuthStore: (select: (value: unknown) => unknown) => select({ user: { id: 'synthetic-owner', nickname: '合成用户', phone: '13900000000' } }) },
    ...ui, '../goal/GoalErrorAlert': { GoalErrorAlert: ({ text: value }: { text: string }) => createElement('p', { role: 'alert' }, value) }, '../goal/goalErrors': goalErrors,
  }).LegacyGoalRecovery;
  const tree = await mount(component);
  try {
    const choice = tree.root.findAllByType('button').find(node => text(node).includes(source.description))!;
    assert.ok(text(choice).includes(source.domain)); assert.ok(text(choice).includes('75%')); await act(async () => choice.props.onClick());
    assert.equal(writes, 0); const dialog = tree.root.findByProps({ role: 'dialog' }), comparison = dialog.findAllByType('section'); assert.equal(comparison.length, 2);
    assert.ok(text(comparison[0]).includes('旧来源原稿')); assert.ok(text(comparison[0]).includes(source.description)); assert.ok(text(comparison[0]).includes('75%'));
    assert.ok(text(comparison[1]).includes('当前目标')); assert.ok(text(comparison[1]).includes(current.description)); assert.ok(text(comparison[1]).includes('25%'));
    for (const copy of ['当前账号：合成用户（139****0000）', '新的本机目标', '不上传', '不改云端', '保留原稿和处理记录']) assert.ok(text(dialog).includes(copy), copy);
    assert.ok(named(tree, '生成本机副本')); assert.ok(named(tree, '保留当前目标')); assert.equal(writes, 0);
  } finally { await close(tree); }
});


test('Planning day oracle requires all original identity and visible leaves, including both separate endpoints', () => {
  const source = occurrence('normal', '09:00', '10:00');
  const reading = { unique: true, visible: true, ariaLabel: '09:00-10:00 合成同名工作安排', title: source.title, startTime: '09:00', endTime: '10:00', titleReading: { visible: true }, startReading: { visible: true }, endReading: { visible: true } };
  assert.equal(planningDayReadingMatches(reading, source), true);
  for (const patch of [{ unique: false }, { visible: false }, { ariaLabel: '09:00-10:30 合成同名工作安排' }, { title: '另一个合成记录' }, { startTime: '06:15' }, { endTime: '10:30' }, { titleReading: { visible: false } }, { startReading: { visible: false } }, { endReading: { visible: false } }]) assert.equal(planningDayReadingMatches({ ...reading, ...patch }, source), false);
  assert.equal(planningDayReadingMatches(reading, occurrence('late', '23:15', '23:45')), false);
});


// A tiny readonly selector adapter over the actually mounted host tree. It has
// no layout, events or styles; its only purpose is executing the native reader's
// exact selectors against current JSX rather than a hand-authored DOM fixture.
class MountedElement {
  tagName: string;
  children: MountedElement[];
  parentElement: MountedElement | null = null;
  props: Record<string, unknown>;
  textContent: string;
  constructor(node: ReactTestRendererJSON) {
    this.tagName = node.type.toUpperCase(); this.props = node.props;
    this.children = (node.children ?? []).filter((child): child is ReactTestRendererJSON => typeof child !== 'string').map(child => new MountedElement(child));
    for (const child of this.children) child.parentElement = this;
    this.textContent = (node.children ?? []).map(child => typeof child === 'string' ? child : new MountedElement(child).textContent).join('');
  }
  get innerText() { return this.textContent; }
  getAttribute(name: string) { const value = this.props[name === 'class' ? 'className' : name]; return value === undefined || value === null ? null : String(value); }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
  querySelectorAll(selector: string): MountedElement[] {
    const options = selector.replaceAll(':is(button:not([role]),[role=button])', '$button').split(',').map(value => value.trim());
    const all: MountedElement[] = [];
    const visit = (node: MountedElement) => { for (const child of node.children) { all.push(child); visit(child); } }; visit(this);
    const simple = (node: MountedElement, token: string) => {
      if (token.startsWith('$button') && !(node.tagName === 'BUTTON' && node.getAttribute('role') === null || node.getAttribute('role') === 'button')) return false;
      const tag = token.match(/^[a-z]+/i)?.[0]; if (tag && node.tagName !== tag.toUpperCase()) return false;
      for (const name of token.matchAll(/\.([a-zA-Z0-9_-]+)/g)) if (!(node.getAttribute('class') ?? '').split(/\s+/).includes(name[1])) return false;
      for (const attr of token.matchAll(/\[([a-zA-Z0-9_-]+)(?:=(?:"([^"]*)"|([^\]]*)))?\]/g)) {
        const value = node.getAttribute(attr[1]); if (value === null || (attr[2] ?? attr[3]) !== undefined && value !== (attr[2] ?? attr[3])) return false;
      }
      return true;
    };
    const matches = (node: MountedElement, rule: string) => {
      const tokens = rule.replaceAll('>', ' > ').trim().split(/\s+/);
      let current: MountedElement | null = node;
      if (!simple(current, tokens.pop()!)) return false;
      while (tokens.length) {
        const token = tokens.pop()!; current = current.parentElement;
        if (token === '>') { if (!current || !simple(current, tokens.pop()!)) return false; }
        else { while (current && !simple(current, token)) current = current.parentElement; if (!current) return false; }
      }
      return true;
    };
    return all.filter(node => options.some(rule => matches(node, rule)));
  }
}
function mountedScheduleDescriptor(tree: ReactTestRenderer) {
  const main: ReactTestRendererJSON = { type: 'main', props: {}, children: [tree.toJSON() as ReactTestRendererJSON] };
  const body = new MountedElement({ type: 'body', props: {}, children: [main] });
  const document = { body, querySelector: body.querySelector.bind(body), querySelectorAll: body.querySelectorAll.bind(body) };
  return runInNewContext(`(${readScheduleDescriptor.toString()})()`, { document, location: { pathname: '/schedule', search: '' }, globalThis: { __ykReadNodes: { nodes: new WeakMap(), next: 1 } } });
}
test('Native schedule descriptor executes against actual mounted JSX for heading, button views and separate day endpoints', async () => {
  const { component, state } = scheduleModule(); const tree = await mount(component);
  try {
    const day = mountedScheduleDescriptor(tree);
    assert.equal(day.present, true); assert.equal(day.heading, '10月7日'); assert.equal(day.selectedTabs.join('|'), '日'); assert.equal(day.cards.length, 3);
    for (const source of state.items) {
      const rows = day.cards.filter((row: { ariaLabel: string }) => row.ariaLabel === `${source.startTime}-${source.endTime} ${source.title}`);
      assert.equal(rows.length, 1); assert.equal(rows[0].title, source.title); assert.equal(rows[0].startTime, source.startTime); assert.equal(rows[0].endTime, source.endTime); assert.equal(rows[0].time, `${source.startTime}-${source.endTime}`);
      assert.ok(rows[0].titleSelector); assert.ok(rows[0].startSelector); assert.ok(rows[0].endSelector);
    }
    await act(async () => named(tree, '月').props.onClick()); const month = mountedScheduleDescriptor(tree);
    assert.equal(month.heading, '2026年10月'); assert.equal(month.selectedTabs.join('|'), '月'); assert.equal(month.views.length, 3); assert.equal(month.cells.length, 35);
    assert.equal(month.cells.filter((cell: { ariaLabel: string }) => cell.ariaLabel === '10月7日，3个日程').length, 1);
  } finally { await close(tree); }
});
