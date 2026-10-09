import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

// Deterministic harness control regression, not native-browser acceptance.
// Geometry comes from e52041ec / run 37964389427, habits-frequency snapshot 040:
// the 360px Home habit link occupied y736.203125..780.203125 while fixed nav
// began at y735. All source/target assertions and the native click stay intact.
const source = readFileSync(process.env.YOUTRACE_HABIT_AUDIT_SOURCE ?? new URL('../scripts/audit-habit-outcomes.mjs', import.meta.url), 'utf8');
const entryAndReader = source.slice(source.indexOf('  async function enter('), source.indexOf('  // A unique visible name'));
const selector = 'main a[aria-label="习惯"]';

type Box = { x: number; y: number; width: number; height: number };
function rect(box: Box) {
  const value = { ...box, top: box.y, left: box.x, right: box.x + box.width, bottom: box.y + box.height };
  return { ...value, toJSON: () => ({ ...value }) };
}
async function run({ narrow = true, wheelWorks = true, obstructed = false, unique = true } = {}) {
  const width = narrow ? 360 : 1280, height = narrow ? 800 : 900;
  let scrollY = 0, captured = 0, clicks = 0, route = '/', wheelCalls = 0;
  const actions: Record<string, unknown>[] = [];
  const order: string[] = [];
  const parent = { parentElement: null, tagName: 'DIV', getBoundingClientRect: () => rect({ x: 0, y: -scrollY, width, height: 1583.5625 }), getAttribute: () => null };
  const target = { parentElement: parent, innerText: '习惯', closest: () => null, querySelector: () => null,
    getBoundingClientRect: () => rect({ x: narrow ? 86 : 350, y: (narrow ? 736.203125 : 510) - scrollY, width: 50, height: 44 }),
    contains: (hit: unknown): boolean => hit === target,
  };
  const nav = { getBoundingClientRect: () => rect({ x: 0, y: 735, width: 360, height: 65 }) };
  const document = {
    querySelectorAll: (query: string) => query === selector ? unique ? [target] : [target, target] : query === 'nav[aria-label="主导航"]' && narrow ? [nav] : [],
    elementFromPoint: (_x: number, y: number) => obstructed || narrow && y >= 735 ? nav : target,
  };
  const page = {
    url: () => 'http://synthetic.invalid/', viewport: () => ({ width, height }),
    $$eval: async () => false,
    evaluate: async (fn: (...args: unknown[]) => unknown, ...args: unknown[]) => fn(...args),
    mouse: {
      move: async () => { order.push('move'); },
      wheel: async ({ deltaY }: { deltaY: number }) => { wheelCalls++; order.push('wheel'); if (wheelWorks) scrollY += deltaY; },
    },
  };
  const context = {
    assert, URL, document, innerWidth: width, innerHeight: height, page,
    getComputedStyle: () => ({ visibility: 'visible', opacity: '1', overflowY: 'visible', overflowX: 'visible', pointerEvents: 'auto' }),
    home: async () => { throw new Error('Already on Home; no alternate navigation allowed'); },
    capture: async () => { captured++; order.push('capture'); },
    pointer: async (_page: unknown, query: string) => {
      assert.equal(query, selector, 'Use the same exact rendered habit entry');
      const box = target.getBoundingClientRect();
      assert.ok(target.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)), 'The exact native target remains covered');
      clicks++; order.push('click'); route = '/habit';
    },
    waitPath: async (_page: unknown, path: string) => { assert.equal(route, path); order.push('route'); },
    sleep: async () => undefined, actions, surfaceNames: new Map([[page, 'Synthetic habit entry']]),
  };
  await runInNewContext(`${entryAndReader}\nenter(page, true)`, context);
  return { clicks, captured, scrollY, wheelCalls, actions, order };
}

test('360px Home discovery uses a real wheel before clicking the exact entry hidden by fixed navigation', async () => {
  const result = await run();
  assert.equal(result.clicks, 1); assert.equal(result.captured, 1);
  assert.equal(result.wheelCalls, 1); assert.ok(result.scrollY > 0);
  assert.ok(result.order.indexOf('wheel') < result.order.indexOf('capture'));
  assert.ok(result.order.indexOf('capture') < result.order.indexOf('click'));
  assert.equal(result.actions[0].kind, 'native-wheel-read-habit'); assert.equal(result.actions[0].selector, selector);
});

test('Already exposed desktop habit entry keeps the same click and route without an unnecessary wheel', async () => {
  const result = await run({ narrow: false });
  assert.equal(result.clicks, 1); assert.equal(result.wheelCalls, 0); assert.equal(result.scrollY, 0);
});

test('Scrolling cannot turn a still-covered or ambiguous habit entry into a successful click', async () => {
  await assert.rejects(run({ wheelWorks: false }));
  await assert.rejects(run({ obstructed: true }));
  await assert.rejects(run({ narrow: false, unique: false }));
});
