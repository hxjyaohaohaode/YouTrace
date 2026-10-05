import assert from 'node:assert/strict';
import { test } from 'node:test';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Target } from 'lucide-react';
import { PageHeader } from '../src/components/layout/PageHeader';
// This Node tsx harness uses classic JSX; supply its React factory only.
Object.assign(globalThis, { React });
const props = { icon: Target, gradient: 'from-purple-500 to-purple-600', title: '目标', subtitle: '上次读取：0/2 完成 · 平均进度 38%' };
// Structural SSR coverage only; real narrow-screen readability needs CI pixels.
test('PageHeader keeps existing single-line defaults for unchanged pages', () => {
  const html = renderToStaticMarkup(createElement(PageHeader, props));
  assert.match(html, /<p class="mt-0.5 truncate /);
  assert.ok(html.includes(props.subtitle));
});
test('Goal can opt into complete wrapped statistics without changing other headers', () => {
  const html = renderToStaticMarkup(createElement(PageHeader, { ...props, wrapSubtitle: true }));
  assert.match(html, /<p class="mt-0.5 whitespace-normal break-words /);
  assert.doesNotMatch(html, /<p class="[^"]*truncate/);
  assert.ok(html.includes(props.subtitle));
});
