import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import { act } from 'react';
import * as jsx from 'react/jsx-runtime';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import ts from 'typescript';

// Actual React mount/effects/refs + actual Splash and Brand source. The host SVG
// nodes and frame clock are explicit deterministic doubles, not browser pixels.
// Independent native-browser review remains necessary for layout/paint timing.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const splashSource = readFileSync(new URL('../src/components/ui/SplashScreen.tsx', import.meta.url), 'utf8');
const brandSource = readFileSync(new URL('../src/components/ui/Brand.tsx', import.meta.url), 'utf8');
const artworkSource = readFileSync(new URL('../public/brand/youtrace-wordmark.svg', import.meta.url), 'utf8');
function compile(source: string, modules: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: Record<string, React.ComponentType<{ onComplete: () => void }>> = {};
  runInNewContext(code, { exports, require: (name: string) => { assert.ok(name in modules, `Unapproved module ${name}`); return modules[name]; }, ...globals });
  return exports;
}
const Brand = compile(brandSource, { 'react/jsx-runtime': jsx, '../../../public/brand/youtrace-wordmark.svg?raw': { __esModule: true, default: artworkSource } });
async function driver({ shown = false, reduced = false } = {}, source = splashSource) {
  const frames = new Map<number, (time: number) => void>();
  let id = 0, completed = 0, requests = 0, cancellations = 0, refAttachments = 0;
  const session = new Map<string, string>(shown ? [['youji_splash_shown', 'true']] : []);
  const circles = [...artworkSource.matchAll(/<circle\b([^>]*)\/>/g)].map(match => ({
    style: {} as Record<string, string>, getAttribute: (name: string) => match[1].match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? null,
  }));
  const labels = [...artworkSource.matchAll(/<text\b/g)].map(() => ({ style: {} as Record<string, string> }));
  assert.equal(circles.length, 4); assert.equal(labels.length, 2);
  const artwork = { style: {} as Record<string, string>, querySelectorAll: (selector: string) => selector === 'circle' ? circles : selector === 'text' ? labels : [] };
  const container = { style: {} as Record<string, string> };
  const Splash = compile(source, { react: React, 'react/jsx-runtime': jsx, './Brand': Brand }, {
    sessionStorage: { getItem: (key: string) => session.get(key), setItem: (key: string, value: string) => session.set(key, value) },
    window: { matchMedia: (query: string) => { assert.equal(query, '(prefers-reduced-motion: reduce)'); return { matches: reduced }; } },
    performance: { now: () => 0 },
    requestAnimationFrame: (callback: (time: number) => void) => { requests++; frames.set(++id, callback); return id; },
    cancelAnimationFrame: (frame: number) => { cancellations++; frames.delete(frame); },
  }).default;
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(React.createElement(React.StrictMode, {}, React.createElement(Splash, { onComplete: () => completed++ })), {
      createNodeMock(element) {
        if (element.type === 'span' && element.props.className?.includes('brand-animated')) {
          assert.equal(element.props.dangerouslySetInnerHTML.__html, artworkSource, 'Real Brand must attach exact original SVG');
          refAttachments++; return artwork;
        }
        if (element.type === 'div' && element.props.className === 'splash-screen') return container;
        return null;
      },
    });
  });
  return {
    tree, frames, labels, circles, artwork, container, session,
    completed: () => completed, requests: () => requests, cancellations: () => cancellations, refAttachments: () => refAttachments,
    async tick(time: number) { await act(async () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(frame => frame(time)); }); },
    async close() { await act(async () => tree.unmount()); },
  };
}
async function timelineContract(source = splashSource) {
  const ui = await driver({}, source);
  try {
    assert.ok(ui.refAttachments() >= 1, 'Actual React ref attached');
    assert.equal(ui.completed(), 0, 'StrictMode must not bypass first entry');
    assert.equal(ui.requests(), 2, 'StrictMode mounts, cleans up, and replays the real effect');
    assert.equal(ui.cancellations(), 1);
    assert.equal(ui.frames.size, 1);
    assert.equal(ui.session.get('youji_splash_shown'), 'true');
    await ui.tick(0);
    assert.equal(ui.labels[0].style.opacity, '0');
    assert.equal(ui.circles[0].style.opacity, '0');
    await ui.tick(100);
    assert.equal(ui.circles[0].style.opacity, '0');
    await ui.tick(400);
    assert.equal(ui.circles[0].style.opacity, '1');
    await ui.tick(499);
    assert.equal(ui.artwork.style.transform, 'scale(1) translateX(0%)');
    await ui.tick(500);
    assert.equal(ui.artwork.style.transform, 'scale(1) translateX(0%)');
    await ui.tick(700);
    assert.equal(ui.artwork.style.transform, 'scale(0.85) translateX(-5%)');
    await ui.tick(899);
    assert.equal(ui.labels[0].style.opacity, '0');
    await ui.tick(900);
    assert.equal(ui.labels[0].style.opacity, '0');
    assert.equal(ui.artwork.style.transform, 'scale(0.7) translateX(-10%)');
    await ui.tick(1100);
    assert.equal(ui.labels[0].style.opacity, '0.96875');
    await ui.tick(1200);
    assert.equal(ui.artwork.style.transform, 'scale(0.7) translateX(-10%)');
    await ui.tick(1300);
    assert.equal(ui.labels[0].style.opacity, '1');
    await ui.tick(1500);
    assert.equal(ui.artwork.style.transform, 'scale(1) translateX(0%)');
    assert.equal(ui.container.style.opacity, '1');
    await ui.tick(1650);
    assert.equal(ui.container.style.opacity, '0.5');
    await ui.tick(1799);
    assert.equal(ui.completed(), 0);
    await ui.tick(1800);
    assert.equal(ui.completed(), 1);
    assert.equal(ui.container.style.opacity, '0');
    assert.equal(ui.frames.size, 0);
  } finally { await ui.close(); }
}
async function bypassContract(options: { shown?: boolean; reduced?: boolean }, source = splashSource) {
  const ui = await driver(options, source);
  try { assert.ok(ui.completed() >= 1); assert.equal(ui.frames.size, 0); assert.equal(ui.requests(), 0); }
  finally { await ui.close(); }
}
async function cleanupContract(source = splashSource) {
  const ui = await driver({}, source);
  await ui.close(); await ui.tick(1800);
  assert.equal(ui.completed(), 0); assert.equal(ui.frames.size, 0);
}
test('real React StrictMode + original Brand refs preserve every entry phase and 1800ms completion', () => timelineContract());
test('earlier-session and reduced-motion visits bypass frames under real React effects', async () => {
  await bypassContract({ shown: true }); await bypassContract({ reduced: true });
});
test('actual React unmount cancels pending animation without calling completion', () => cleanupContract());
for (const [name, before, after] of [
  ['early completion', 'elapsed >= 1800', 'elapsed >= 1700'],
  ['late completion', 'elapsed >= 1800', 'elapsed >= 1900'],
  ['early text reveal', '(elapsed - 900) / 400', '(elapsed - 500) / 400'],
  ['wrong shrink phase', '(elapsed - 500) / 400', '(elapsed - 400) / 400'],
  ['wrong center phase', '(elapsed - 1200) / 300', '(elapsed - 1100) / 300'],
  ['wrong fade phase', '(elapsed - 1500) / 300', '(elapsed - 1400) / 300'],
  ['wrong SVG text selector', "querySelectorAll('text')", "querySelectorAll('path')"],
  ['wrong SVG circle selector', "querySelectorAll('circle')", "querySelectorAll('ellipse')"],
  ['StrictMode self-skip', '(shown && !startedInThisMount.current)', 'shown'],
] as const) test(`lifecycle gate rejects ${name}`, async () => {
  assert.ok(splashSource.includes(before));
  await assert.rejects(timelineContract(splashSource.replace(before, after)), { code: 'ERR_ASSERTION' });
});
test('lifecycle gate rejects removed session bypass, reduced-motion bypass and cleanup', async () => {
  await assert.rejects(bypassContract({ shown: true }, splashSource.replace('(shown && !startedInThisMount.current)', 'false')));
  await assert.rejects(bypassContract({ reduced: true }, splashSource.replace('|| reduced)', '|| false)')));
  await assert.rejects(cleanupContract(splashSource.replace('cancelAnimationFrame(frame)', 'undefined')));
});
