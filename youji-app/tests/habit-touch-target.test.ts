import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Narrow habit dates wrap in chronological grid order and retain 44px targets without shrinking text', () => {
  const css = readFileSync(new URL('../src/components/schedule/planning.css', import.meta.url), 'utf8');
  const card = readFileSync(new URL('../src/components/habit/HabitList.tsx', import.meta.url), 'utf8');
  assert.match(css, /\.habit-seven-days button\s*\{\s*min-width:\s*44px;\s*min-height:\s*56px;/);
  assert.match(css, /@media\s*\(max-width:\s*420px\)\s*\{\s*\.habit-seven-days\s*\{\s*grid-template-columns:\s*repeat\(4,\s*minmax\(44px,\s*1fr\)\);\s*gap:\s*8px;/);
  assert.doesNotMatch(css, /\.habit-seven-days[^}]*\b(?:order|direction|grid-auto-flow|font-size)\s*:/);
  assert.match(card, /days\.map\(date =>/);
  assert.match(card, /onClick=\{\(\) => onToggleDate\(date, !done\)\}/);
  assert.match(card, /aria-pressed=\{done\}/);
});
