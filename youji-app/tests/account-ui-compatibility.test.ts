import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import * as React from 'react';
import { act, createElement } from 'react';
import { create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import ts from 'typescript';
import * as dates from '../src/utils/date';
import * as navigation from '../src/lib/navigation';
import * as overview from '../src/lib/homeOverview';
import { expenseSummaryChecks } from '../scripts/audit-expense-summary.mjs';

// Actual page/component JSX and React hooks. Boundary doubles are synthetic and
// in-process only; these checks do not establish browser paint/hit geometry,
// native keyboard behavior, HTTP/IndexedDB outcomes or hosted-audit completion.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const require = createRequire(import.meta.url);
const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const host = (tag: string) => ({ children, ...props }: React.HTMLAttributes<HTMLElement>) => createElement(tag, props, children);
const hosts = new Map<string, ReturnType<typeof host>>();
const motion = new Proxy({}, { get: (_target, tag: string) => { if (!hosts.has(tag)) hosts.set(tag, host(tag)); return hosts.get(tag); } });
const Presence = ({ children }: { children: React.ReactNode }) => createElement(React.Fragment, {}, children);
const router = {
  Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) => createElement('a', { ...props, href: to }, children),
  useLocation: () => ({ pathname: '/', search: '', state: null, key: 'synthetic' }),
  useNavigate: () => () => undefined,
};
const domWindow = Object.assign(new EventTarget(), { setInterval: () => 1, clearInterval() {}, location: { pathname: '/' } });
const domDocument = Object.assign(new EventTarget(), { body: { style: { overflow: '' } }, activeElement: null });
function component(path: string, mocks: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const code = ts.transpileModule(source(path).replaceAll('import.meta.env.DEV', 'false'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: Record<string, React.ComponentType<Record<string, unknown>>> = {};
  runInNewContext(code, {
    exports, require: (name: string) => name.endsWith('.css') ? {} : mocks[name] ?? require(name),
    structuredClone, console, Error, URLSearchParams, window: domWindow, document: domDocument,
    requestAnimationFrame: () => 1, cancelAnimationFrame() {}, setTimeout, clearTimeout,
    __BUILD_REVISION__: 'synthetic-local-test', ...globals,
  });
  return exports;
}
function text(node: ReactTestInstance | string): string { return typeof node === 'string' ? node : node.children.map(text).join(''); }
function button(tree: ReactTestRenderer, label: string) { const nodes = tree.root.findAllByType('button').filter(node => text(node) === label); assert.equal(nodes.length, 1, `Unique button: ${label}`); return nodes[0]; }
function dialogs(tree: ReactTestRenderer) { return tree.root.findAll(node => typeof node.type === 'string' && node.props.role === 'dialog'); }
const auth = { user: { id: 'synthetic-owner', nickname: 'Synthetic account', phone: '13900008701' }, isAuthenticated: true };
const authHook = (select: (state: typeof auth) => unknown) => select(auth);
const Button = host('button');
const Modal = component('../src/components/ui/Modal.tsx', {
  'framer-motion': { motion, AnimatePresence: Presence },
  '../../hooks/useMediaQuery': { useMediaQuery: () => false },
  './modalFocus': { restoreModalFocus() {} },
}).Modal;

test('Mounted preference comparison freezes all displayed fields/account and rejects an obsolete choice', async () => {
  const local = { coachStyle: 'gentle', coachPushEnabled: false, coachPushFrequency: 0, quietHours: { enabled: true, start: '23:00', end: '07:00' }, eveningReviewEnabled: false, eveningReviewTime: '21:00' };
  const remote = { ...local, coachStyle: 'strict', coachPushFrequency: 2 };
  let current = { state: 'conflict', conflict: { id: 'old-comparison', local, remote }, error: '' };
  const choices: unknown[] = [];
  const store = Object.assign((select: (state: { preferenceSync: typeof current }) => unknown) => select({ preferenceSync: current }), {
    getState: () => ({ syncPreferences: async () => undefined, resolvePreferenceConflict: async (choice: string, id: string) => { choices.push([choice, id]); if (id !== current.conflict.id) throw new Error('版本已有变化，请重新核对'); } }),
  });
  const Panel = component('../src/components/settings/PreferenceSyncPanel.tsx', {
    '../../stores/settingsStore': { useSettingsStore: store }, '../../stores/authStore': { useAuthStore: authHook }, '../ui/Button': { Button }, '../ui/Modal': { Modal },
  }).PreferenceSyncPanel;
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(createElement(Panel)); });
  try {
    await act(async () => button(tree, '比较偏好版本').props.onClick());
    assert.equal(dialogs(tree).length, 1);
    assert.equal(tree.root.findAllByType('dl').length, 2);
    assert.equal(text(tree.root.findAllByType('h3')[0]), '比较账号偏好');
    assert.match(text(tree.root), /Synthetic account（139\*\*\*\*8701）/);
    assert.match(text(tree.root.findAllByType('dl')[0]), /教练风格：温柔型.*每设备每日最多 0 条.*23:00 至 07:00.*关闭 · 21:00/);
    const originalText = tree.root.findAllByType('dl').map(text);
    current = { ...current, conflict: { id: 'new-comparison', local, remote: { ...remote, coachPushFrequency: 3 } } };
    await act(async () => tree.update(createElement(Panel)));
    assert.deepEqual(tree.root.findAllByType('dl').map(text), originalText, 'The open comparison keeps its originally displayed snapshot');
    await act(async () => button(tree, '保留本机选择并同步').props.onClick());
    assert.deepEqual(choices, [['local', 'old-comparison']]);
    assert.match(text(dialogs(tree)[0]), /版本已有变化，请重新核对/);
    await act(async () => tree.root.findByProps({ 'aria-label': '关闭' }).props.onClick());
    assert.equal(choices.length, 1, 'Close is not another choice');
    await act(async () => button(tree, '比较偏好版本').props.onClick());
    assert.match(text(tree.root.findAllByType('dl')[1]), /每设备每日最多 3 条/);
    await act(async () => button(tree, '使用云端偏好').props.onClick());
    assert.deepEqual(choices, [['local', 'old-comparison'], ['server', 'new-comparison']]);
    assert.equal(dialogs(tree).length, 0);
  } finally { await act(async () => tree.unmount()); }
});

test('Mounted historical preference ACK label is also the exact label read by native audits and all browser recovery checks', async () => {
  const Panel = component('../src/components/settings/PreferenceSyncPanel.tsx', {
    '../../stores/settingsStore': { useSettingsStore: (select: (state: unknown) => unknown) => select({ preferenceSync: { state: 'synced' } }) },
    '../../stores/authStore': { useAuthStore: authHook }, '../ui/Button': { Button }, '../ui/Modal': { Modal },
  }).PreferenceSyncPanel;
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(createElement(Panel)); });
  try {
    const label = text(tree.root.findByProps({ role: 'status' }));
    assert.equal(label, '上次核对时，账号偏好已同步', 'An old successful read must not be presented as an unqualified live claim');
    for (const script of ['audit-preference-outcomes.mjs', 'audit-reminder-entry.mjs']) assert.ok(source(`../scripts/${script}`).includes(`'${label}'`), `${script}: exact native status locator must match the actual mounted status`);
    const recovery = ts.createSourceFile('e2e-recovery.mjs', source('../scripts/e2e-recovery.mjs'), ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
    const statusReads: ts.CallExpression[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'expectText') {
        const selector = node.arguments[3];
        if (selector && ts.isStringLiteral(selector) && selector.text === '[aria-label="账号偏好同步"] p') statusReads.push(node);
      }
      ts.forEachChild(node, visit);
    };
    visit(recovery);
    assert.equal(statusReads.length, 4, 'Keep every original-device, second-device and conflict-resolution status assertion');
    for (const read of statusReads) {
      const expected = read.arguments[1];
      assert.ok(ts.isStringLiteral(expected));
      assert.equal(expected.text, label, 'Every browser recovery status read must exactly match the mounted historical ACK label');
      assert.equal(read.arguments[2].kind, ts.SyntaxKind.TrueKeyword, 'The browser must require the success status to be present');
    }
  } finally { await act(async () => tree.unmount()); }
});

const Greeting = component('../src/components/home/Greeting.tsx', { 'react-router-dom': router }).Greeting;
test('Mounted unread reminder entry retains its exact name and native audit selector accepts its real element', async () => {
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(createElement(Greeting, { greeting: '你好', date: '2026-10-08', unreadCount: 1 })); });
  try {
    const entry = tree.root.findAllByType('a').filter(node => node.props['aria-label'] === '教练洞察，1条未读');
    assert.equal(entry.length, 1); assert.equal(entry[0].props.href, '/insights');
    const script = source('../scripts/audit-reminder-entry.mjs');
    const bellSelector = script.match(/const BELL = '([^']+)';/)?.[1];
    assert.ok(bellSelector); assert.match(bellSelector, /(?:\ba\b|:is\([^)]*\ba\b)/, 'The native reminder locator must accept the actual anchor without changing its exact unread name');
    await act(async () => tree.update(createElement(Greeting, { greeting: '你好', date: '2026-10-08', unreadCount: 0 })));
    assert.equal(tree.root.findAllByType('a').filter(node => node.props['aria-label'] === '教练洞察').length, 1);
  } finally { await act(async () => tree.unmount()); }
});

function homeFixture({ habit = false, expense = false } = {}) {
  const today = dates.getToday(), yesterday = dates.getDateDaysAgo(1);
  const completedDate = dates.getNaturalWeekDates(today)[0] === today ? today : yesterday;
  const habits = habit ? [{ id: 'synthetic-weekly', name: 'Synthetic weekly', frequency: 'weekly', recentCheckins: [{ date: completedDate, done: true }], createdAt: Date.parse(`${yesterday}T00:00:00Z`) }] : [];
  const expenses = expense ? [{ id: 'synthetic-expense', date: yesterday, name: 'Synthetic source', amount: 5025, category: 'food', isIncome: false }] : [];
  const states = {
    expense: { items: expenses, budgetStatus: 'unset', monthBudget: 0 }, habit: { items: habits }, diary: { items: [] }, todo: { items: [] }, schedule: { items: [] }, quickNote: { records: [] }, goal: { items: [] },
  };
  const storeMocks = Object.fromEntries(Object.entries(states).map(([key, state]) => [`../stores/${key}Store`, { [`use${key[0].toUpperCase() + key.slice(1)}Store`]: (select: (value: typeof state) => unknown) => select(state), ...(key === 'schedule' ? { expandRecurringForRange: () => [] } : {}) }]));
  const childStores = Object.fromEntries(Object.entries(storeMocks).map(([key, value]) => [`../${key}`, value]));
  const brief = { greeting: '你好', source: 'server', generatedAt: Date.now(), reviewDate: yesterday, yesterdayReview: { spent: expense ? 50.25 : 0, expenseCount: expense ? 1 : 0, spentDiff: null, habits: { done: habit ? 1 : 0 }, moodScore: null }, weeklyInsights: [], todayActions: [] };
  const coach = { dailyBrief: brief, insights: [], pushes: [], getUnreadPushCount: () => 0, generateDailyBrief: async () => undefined, addInsight: async () => undefined, addPush: async () => undefined };
  const coachHook = Object.assign((select: (state: typeof coach) => unknown) => select(coach), { getState: () => coach });
  const navigations: string[] = [];
  const common = { 'react-router-dom': { ...router, useNavigate: () => (path: string) => navigations.push(path) }, 'framer-motion': { motion, AnimatePresence: Presence }, '../../utils/date': dates, '../../stores/authStore': { useAuthStore: authHook }, '../../lib/navigation': navigation };
  const BriefCard = component('../src/components/home/BriefCard.tsx', { ...common, '../../stores/coachStore': { useCoachStore: coachHook }, '../../utils/actionPaths': { resolveActionPath: () => '/coach', resolvePushPath: () => '/insights' }, '../../services/toastBus': { toast: {} }, '../ui/Card': { Card: host('div') } }).BriefCard;
  const WeeklyReviewCard = component('../src/components/home/WeeklyReviewCard.tsx', { ...common, '../../services/lifeIntelligence': { generateWeeklyReview: async () => null, computeWeeklyStats: async () => ({ daysActive: 1, expenseFrom: dates.getDateDaysAgo(6), expenseThrough: today, expenseTotalFen: expense ? 5025 : 0, expenseCount: expense ? 1 : 0, weekOverWeekPct: null, habitRecordCount: habit ? 1 : 0, diaryEntryCount: 0 }) } }).WeeklyReviewCard;
  const QuickActions = component('../src/components/home/QuickActions.tsx', common).QuickActions;
  const OverviewCard = component('../src/components/home/OverviewCard.tsx', { ...common, ...childStores, '../../lib/homeOverview': overview }).OverviewCard;
  const Home = component('../src/pages/Home.tsx', {
    ...storeMocks, 'react-router-dom': router, '../db': { db: {} }, '../stores/authStore': { useAuthStore: authHook }, '../stores/coachStore': { useCoachStore: coachHook }, '../stores/settingsStore': { useSettingsStore: { getState: () => ({ coachPushEnabled: false }) } },
    '../services/apiClient': { isLoggedIn: () => false }, '../services/syncEngine': { flush: async () => undefined }, '../services/diagnostics': { recordDiagnostic() {} }, '../services/recordObservations': { readRecordObservations: async () => null }, '../services/lifeIntelligence': { generateRealInsights: async () => [] }, '../services/coachEngine': {}, '../services/pushControl': {}, '../utils/date': dates, '../services/timelineEntries': { timelineEntries: () => [] },
    '../components/home/Greeting': { Greeting }, '../components/home/QuickActions': { QuickActions }, '../components/home/BriefCard': { BriefCard }, '../components/home/WeeklyReviewCard': { WeeklyReviewCard }, '../components/home/OverviewCard': { OverviewCard },
  }).default;
  return { Home, OverviewCard, brief, expenses, today, navigations };
}

test('Mounted Home current review remains discoverable by the exact financial audit summary', async () => {
  const { Home } = homeFixture({ expense: true }); let tree!: ReactTestRenderer;
  await act(async () => { tree = create(createElement(Home)); });
  try {
    const summaries = tree.root.findAllByType('summary').map(text);
    assert.ok(summaries.includes('查看今日回顾与建议'), 'Native financial and habit recap entry must resolve to the actual visible summary');
  } finally { await act(async () => tree.unmount()); }
});

test('Mounted actual Home brief and weekly card retain exact cents, dates, count and separate provenance', async () => {
  const { Home, brief, expenses, today } = homeFixture({ expense: true }); let tree!: ReactTestRenderer;
  await act(async () => { tree = create(createElement(Home)); });
  try {
    const review = tree.root.findAllByType('details').find(node => node.findAllByType('span').some(span => text(span) === '记录简报'))!;
    assert.ok(review);
    const paragraphs = review.findAllByType('p').map(text);
    const date = paragraphs.find(value => value.includes('记录回顾'))!;
    const amount = paragraphs.find(value => value.startsWith('已记录支出'))!;
    const expected = expenseSummaryChecks.expectedSummary(expenses, today, 'yesterday');
    assert.ok(Object.entries(expenseSummaryChecks.summaryReading(`${date}\n${amount}`, expected, { period: false })).filter(([key]) => key !== 'expected').every(([, value]) => value));
    assert.ok(expenseSummaryChecks.briefMatches(brief, expected, amount).uiAmountMatchesActualApi);
    assert.ok(paragraphs.some(value => value.startsWith('云端已同步记录')));
    const weekly = tree.root.findAll(node => typeof node.type === 'string' && node.props['aria-label'] === '查看近7天回顾和时间线')[0];
    const rows = weekly.findAllByType('p');
    const amountLabel = rows.find(node => text(node) === '消费')!;
    const amountText = amountLabel.parent!.findAllByType('p').map(text).join('\n');
    const fields = [text(weekly.findByType('h3')), text(rows[0]), amountText, text(rows[1])].join('\n');
    const scoped = expenseSummaryChecks.summaryReading(fields, expenseSummaryChecks.expectedSummary(expenses, today, 'seven'));
    assert.ok(Object.entries(scoped).filter(([key]) => key !== 'expected').every(([, passed]) => passed));
    assert.equal(text(rows[1]), '本机记录');
  } finally { await act(async () => tree.unmount()); }
});

test('Mounted empty Home keeps the real labelled heading and exact first-record action read by the reminder journey', async () => {
  const { Home } = homeFixture(); let tree!: ReactTestRenderer;
  await act(async () => { tree = create(createElement(Home)); });
  try {
    assert.equal(tree.root.findAllByType('a').filter(node => node.props.href === '/quick-note' && text(node) === '写下第一条速记').length, 1);
    const sections = tree.root.findAllByType('section').filter(node => node.props['aria-labelledby'] === 'home-capture-title');
    assert.equal(sections.length, 1);
    assert.equal(text(sections[0].findByProps({ id: 'home-capture-title' })), '记一句');
    assert.equal(sections[0].findAllByType('a').filter(node => node.props.href === '/quick-note' && text(node) === '写下第一条速记').length, 1);
    const script = source('../scripts/audit-reminder-entry.mjs');
    assert.ok(script.includes('section[aria-labelledby="home-capture-title"] h2'));
    assert.ok(script.includes('section[aria-labelledby="home-capture-title"] a[href="/quick-note"]'));
  } finally { await act(async () => tree.unmount()); }
});

test('Mounted Home preserves current weekly-habit facts and their real action, beyond raw historical record count', async () => {
  const { Home, OverviewCard, navigations } = homeFixture({ habit: true }); let tree!: ReactTestRenderer;
  let standalone!: ReactTestRenderer;
  await act(async () => { tree = create(createElement(Home)); });
  await act(async () => { standalone = create(createElement(OverviewCard)); });
  try {
    assert.equal(tree.root.findAllByType('a').filter(node => node.props.href === '/habit').length, 1, 'General habit shortcut remains available');
    const cards = tree.root.findAllByType('button').filter(node => /本周习惯|习惯打卡|今日习惯/.test(text(node)));
    assert.equal(cards.length, 1, 'A source-backed current habit overview cannot be replaced by the unrelated raw record count');
    assert.match(text(cards[0]), /本周习惯/); assert.match(text(cards[0]), /1\/1/); assert.match(text(cards[0]), /本周已全部打卡/);
    const independent = standalone.root.findAllByType('button').filter(node => /本周习惯/.test(text(node)));
    assert.equal(independent.length, 1); assert.equal(text(independent[0]), text(cards[0]), 'Home composes the real Overview component with the same source-backed current-period result');
    await act(async () => cards[0].props.onClick()); assert.deepEqual(navigations, ['/habit']);
    await act(async () => independent[0].props.onClick()); assert.deepEqual(navigations, ['/habit', '/habit']);
  } finally { await act(async () => { tree.unmount(); standalone.unmount(); }); }
});

test('Mounted Login preserves each native setup control and exact requested full-path return', async () => {
  const calls: unknown[] = [], replacements: string[] = [];
  const state = { isAuthenticated: false, sendCode: async (phone: string) => { calls.push(['code', phone]); return { challengeId: 'synthetic-challenge', devCode: '123456' }; }, verify: async (...args: unknown[]) => { calls.push(['verify', ...args]); return { needRegister: true, registrationTicket: 'synthetic-ticket' }; }, register: async (...args: unknown[]) => { calls.push(['register', ...args]); } };
  const Login = component('../src/pages/Login.tsx', { 'react-router-dom': { ...router, useLocation: () => ({ search: '', state: { from: '/todo?view=all' } }) }, 'framer-motion': { motion, AnimatePresence: Presence }, '../components/ui/Brand': { Brand: () => null }, '../stores/authStore': { useAuthStore: (select: (value: typeof state) => unknown) => select(state) } }, { sessionStorage: { getItem: () => null, removeItem() {} }, window: { location: { replace: (path: string) => replacements.push(path) } }, setTimeout: () => 1, clearTimeout() {} }).default;
  let tree!: ReactTestRenderer; await act(async () => { tree = create(createElement(Login)); });
  try {
    assert.equal(text(tree.root.findByType('h2')), '登录 / 注册');
    await act(async () => tree.root.findByProps({ id: 'login-phone' }).props.onChange({ target: { value: '13900008701' } }));
    await act(async () => button(tree, '获取验证码').props.onClick());
    await act(async () => tree.root.findByProps({ id: 'login-code' }).props.onChange({ target: { value: '123456' } }));
    await act(async () => button(tree, '验证').props.onClick());
    assert.equal(tree.root.findByProps({ id: 'login-nickname' }).props.maxLength, 20);
    await act(async () => tree.root.findByProps({ id: 'login-nickname' }).props.onChange({ target: { value: 'Synthetic account' } }));
    await act(async () => button(tree, '开始使用').props.onClick());
    assert.deepEqual(replacements, ['/todo?view=all']);
    assert.deepEqual(calls, [['code', '13900008701'], ['verify', '13900008701', '123456', 'synthetic-challenge'], ['register', '13900008701', 'Synthetic account', 'synthetic-ticket']]);
  } finally { await act(async () => tree.unmount()); }
});

test('Mounted common desktop/mobile navigation retains the exact account, coach and Todo destinations', async () => {
  const navigations: unknown[] = [];
  const navigationRouter = { ...router, useNavigate: () => (...args: unknown[]) => navigations.push(structuredClone(args)) };
  const shared = { 'react-router-dom': navigationRouter, 'framer-motion': { motion }, '../../stores/authStore': { useAuthStore: authHook }, '../../lib/navigation': navigation, '../ui/Brand': { Brand: () => null } };
  const Desktop = component('../src/components/layout/DesktopSidebar.tsx', shared).DesktopSidebar;
  const Bottom = component('../src/components/layout/BottomNav.tsx', shared).BottomNav;
  for (const [Component, mobile] of [[Desktop, false], [Bottom, true]] as const) {
    let tree!: ReactTestRenderer; await act(async () => { tree = create(createElement(Component)); });
    try {
      assert.equal(tree.root.findAllByType('nav').filter(node => node.props['aria-label'] === '主导航').length, 1);
      if (mobile) {
        const more = tree.root.findAllByType('button').find(node => node.props['aria-label'] === '全部功能')!;
        await act(async () => more.props.onClick());
        assert.equal((navigations.at(-1) as unknown[])[0], '/more');
      } else {
        for (const [label, destination] of [['首页', '/'], ['待办', '/todo'], ['设置', '/settings'], ['AI 教练', '/coach'], ['教练洞察', '/insights'], ['花销', '/expense']]) {
          await act(async () => button(tree, label).props.onClick());
          assert.equal((navigations.at(-1) as unknown[])[0], destination);
        }
      }
    } finally { await act(async () => tree.unmount()); }
  }
  const More = component('../src/pages/More.tsx', { 'react-router-dom': navigationRouter, '../stores/authStore': { useAuthStore: authHook }, '../lib/navigation': navigation, '../components/ui/Button': { Button } }, { sessionStorage: { getItem: () => null, setItem() {} } }).default;
  let tree!: ReactTestRenderer; await act(async () => { tree = create(createElement(More)); });
  try {
    const nav = tree.root.findAllByType('nav').find(node => node.props['aria-label'] === '全部功能')!;
    for (const path of ['/todo', '/settings', '/coach', '/insights', '/expense']) assert.equal(nav.findAllByType('a').filter(node => node.props.href === path).length, 1);
  } finally { await act(async () => tree.unmount()); }
});

test('Mounted actual readiness shell keeps signed-out entry, readable failed-load Retry and late successful view', async () => {
  const state = { authChecked: true, isAuthenticated: false, identityUnavailable: false, loadUser: async () => undefined };
  let readiness = { ready: false, failed: false }, reloads = 0;
  const Splash = ({ onComplete }: { onComplete: () => void }) => { React.useEffect(onComplete, [onComplete]); return null; };
  const App = component('../src/App.tsx', {
    'react-router-dom': { BrowserRouter: Presence, useLocation: () => ({ pathname: '/todo' }), useNavigate: () => () => undefined },
    'framer-motion': { MotionConfig: Presence }, './routes': { AppRoutes: () => createElement('main', { 'data-routes': true }, 'Synthetic routed contents') },
    './hooks/useAppInit': { useAppInit: () => readiness }, './stores/authStore': { useAuthStore: (select: (value: typeof state) => unknown) => select(state), useUnauthedRedirect() {} },
    './components/ui/SplashScreen': { __esModule: true, default: Splash }, './components/ui/Toast': { ToastHost: () => null }, './components/ui/ErrorBoundary': { ErrorBoundary: Presence }, './components/layout/RuntimeObserver': { RuntimeObserver: () => null },
    './db': { DATABASE_UPGRADE_BLOCKED_EVENT: 'synthetic-db-status', isDatabaseUpgradeBlocked: () => false, getDatabaseRecoveryError: () => null },
  }, { window: Object.assign(new EventTarget(), { location: { reload: () => { reloads++; } } }) }).default;
  let tree!: ReactTestRenderer; await act(async () => { tree = create(createElement(App)); });
  try {
    assert.equal(tree.root.findAllByProps({ 'data-routes': true }).length, 1, 'Confirmed signed-out state reaches routes without requiring authenticated stores');
    state.isAuthenticated = true; readiness = { ready: false, failed: true };
    await act(async () => tree.update(createElement(App)));
    assert.equal(tree.root.findAllByProps({ 'data-routes': true }).length, 0);
    assert.ok(tree.root.findAllByType('p').some(node => text(node) === '加载遇到问题'));
    await act(async () => button(tree, '重试').props.onClick()); assert.equal(reloads, 1);
    readiness = { ready: true, failed: true };
    await act(async () => tree.update(createElement(App)));
    assert.equal(tree.root.findAllByProps({ 'data-routes': true }).length, 1, 'Earlier success is not retracted by overlapping failure');
    assert.equal(tree.root.findAllByType('p').filter(node => text(node) === '加载遇到问题').length, 0);
  } finally { await act(async () => tree.unmount()); }
});

test('Mounted actual Insights exposes the complete same-ID reminder and its two distinct actions', async () => {
  const navigations: string[] = [], effects: unknown[] = [];
  const push = { id: 'synthetic-evening', type: 'evening_review', title: '今天还有什么想记录的吗？', body: '一天快结束了，回顾一下今天发生的事，用一句话记录下来吧。', read: false, acted: false, origin: 'local', createdAt: Date.now(), actions: [{ label: '去记录', type: 'chat' }, { label: '今天够了', type: 'dismiss' }] };
  const store = { pushes: [push], insights: [], markPushRead: async (id: string) => { effects.push(['read', id]); }, markPushActed: async (id: string) => { effects.push(['act', id]); }, dismissPush: async (id: string) => { effects.push(['dismiss', id]); } };
  const useCoachStore = (select: (value: typeof store) => unknown) => select(store);
  const common = { 'react-router-dom': { useNavigate: () => (path: string) => navigations.push(path) }, 'framer-motion': { motion, AnimatePresence: Presence } };
  const PushList = component('../src/components/home/BriefCard.tsx', { ...common, '../../stores/coachStore': { useCoachStore }, '../../utils/actionPaths': { resolveActionPath: () => '/coach', resolvePushPath: () => '/quick-note' }, '../../services/toastBus': { toast: {} }, '../../utils/date': dates, '../ui/Card': { Card: host('div') } }).PushList;
  const Insights = component('../src/pages/CoachInsights.tsx', { ...common, '../components/home/BriefCard': { PushList }, '../components/coach/CurrentRecordObservations': { CurrentRecordObservations: () => createElement('section', { 'data-component': 'current-record-observations' }) }, '../stores/coachStore': { useCoachStore }, '../services/toastBus': { toast: {} }, '../utils/actionPaths': { resolveActionPath: () => '/coach', dataSourceLabels: {} }, '../utils/date': dates }).default;
  let tree!: ReactTestRenderer; await act(async () => { tree = create(createElement(Insights)); });
  try {
    assert.equal(tree.root.findAllByType('p').filter(node => text(node) === push.title).length, 1);
    assert.equal(tree.root.findAllByType('p').filter(node => text(node) === push.body).length, 1);
    assert.equal(button(tree, '去记录').props.disabled, false); assert.equal(button(tree, '今天够了').props.disabled, false);
    await act(async () => button(tree, '去记录').props.onClick());
    assert.deepEqual(navigations, ['/quick-note']); assert.deepEqual(effects, [['act', push.id]]);
    await act(async () => button(tree, '今天够了').props.onClick());
    assert.deepEqual(navigations, ['/quick-note']); assert.deepEqual(effects, [['act', push.id], ['dismiss', push.id]]);
  } finally { await act(async () => tree.unmount()); }
});
