import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

// Deterministic driver regression, not native-browser acceptance. These are the
// actual 360px bounds from e52041ec / run 37964389427 planning snapshot 151:
// the Home directory link occupied y756.203125..800.203125, below nav y735.
const source = readFileSync(process.env.YOUTRACE_PLANNING_AUDIT_SOURCE ?? new URL('../scripts/audit-planning-outcomes.mjs', import.meta.url), 'utf8');
const reader = source.slice(source.indexOf('  function controlGeometry('), source.indexOf('  async function dayTarget('));
// Exercise the actual entry prefix; peer creation starts only after /more.
const entry = source.slice(source.indexOf('  async function openPeer('), source.indexOf('    const targetPromise =')) + '\n  }';
const selector = 'main a', label = '查看全部功能';

type Box = { x: number; y: number; width: number; height: number };
function rect(box: Box) {
  const value = { ...box, top: box.y, left: box.x, right: box.x + box.width, bottom: box.y + box.height };
  return { ...value, toJSON: () => ({ ...value }) };
}
async function run({ narrow = true, wheelWorks = true, obstructed = false, unique = true } = {}) {
  const width = narrow ? 360 : 1280, height = narrow ? 800 : 900;
  let scrollY = 0, clicks = 0, route = '/schedule', wheelCalls = 0;
  const actions: Record<string, unknown>[] = [], order: string[] = [];
  const parent = { parentElement: null, tagName: 'DIV', getBoundingClientRect: () => rect({ x: 0, y: -scrollY, width, height: 1672.5625 }), getAttribute: () => null };
  const target = { parentElement: parent, textContent: label, innerText: label, closest: () => null,
    getBoundingClientRect: () => rect({ x: narrow ? 20 : 350, y: (narrow ? 756.203125 : 510) - scrollY, width: 106, height: 44 }),
    contains: (hit: unknown): boolean => hit === target,
  };
  const unrelated = { ...target, textContent: '看日程', innerText: '看日程' };
  const nav = { getBoundingClientRect: () => rect({ x: 0, y: 735, width: 360, height: 65 }) };
  const document = {
    querySelectorAll: (query: string) => query === selector ? unique ? [unrelated, target] : [target, target] : query === 'nav[aria-label="主导航"]' && narrow ? [nav] : [],
    elementFromPoint: (_x: number, y: number) => obstructed || narrow && y >= 735 ? nav : target,
  };
  const page = {
    viewport: () => ({ width, height }), $$eval: async () => false,
    evaluate: async (fn: (...args: unknown[]) => unknown, ...args: unknown[]) => fn(...args),
    mouse: {
      move: async () => { order.push('move'); },
      wheel: async ({ deltaY }: { deltaY: number }) => { wheelCalls++; order.push('wheel'); if (wheelWorks) scrollY += deltaY; },
    },
  };
  const context = {
    assert, document, innerWidth: width, innerHeight: height, page,
    getComputedStyle: () => ({ overflowY: 'visible', overflowX: 'visible' }),
    home: async () => { route = '/'; order.push('home'); },
    pointer: async (_page: unknown, query: string, text: string) => {
      assert.equal(query, selector); assert.equal(text, label, 'Keep the exact rendered directory entry');
      const box = target.getBoundingClientRect();
      assert.ok(target.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)), 'The native click target remains covered');
      clicks++; order.push('click'); route = '/more';
    },
    waitPath: async (_page: unknown, path: string) => { assert.equal(route, path); order.push('route'); },
    sleep: async () => undefined, actions, surfaceNames: new Map([[page, 'Synthetic planning entry']]),
  };
  await runInNewContext(`${reader}\n${entry}\nopenPeer(page, 'Synthetic peer')`, context);
  return { clicks, scrollY, wheelCalls, actions, order };
}

test('360px planning peer discovery wheels the exact directory link above the fixed navigation before clicking', async () => {
  const result = await run();
  assert.equal(result.clicks, 1); assert.equal(result.wheelCalls, 1); assert.ok(result.scrollY > 0);
  assert.ok(result.order.indexOf('wheel') < result.order.indexOf('click'));
  assert.deepEqual(result.order.slice(-2), ['click', 'route']);
  assert.equal(result.actions[0].kind, 'native-wheel-read-schedule'); assert.equal(result.actions[0].selector, selector);
});

test('Already exposed desktop planning entry keeps the exact click and route without scrolling', async () => {
  const result = await run({ narrow: false });
  assert.equal(result.clicks, 1); assert.equal(result.wheelCalls, 0); assert.equal(result.scrollY, 0);
});

test('Failed scrolling, continuing obstruction, and duplicate directory links stay blocked', async () => {
  await assert.rejects(run({ wheelWorks: false }));
  await assert.rejects(run({ obstructed: true }));
  await assert.rejects(run({ narrow: false, unique: false }));
});
