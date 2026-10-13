import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
test('actual Modal forward Tab recaptures focus lost to body after current focused detail control unmounts (DOM-shaped source execution)', async () => {
  const ts = await import('typescript');
  const source = await readFile(new URL('../src/components/ui/Modal.tsx', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const { restoreModalFocus } = await import('../src/components/ui/modalFocus.ts');
  for (const hasCheckbox of [true, false]) {
    let closes = 0, ref = 0; const effects: Array<() => (() => void) | void> = [], listeners = new Map<string, (event: KeyboardEvent) => void>();
    const doc = { activeElement: null as unknown, body: { style: { overflow: 'scroll' } }, documentElement: {}, addEventListener: (name: string, listener: (event: KeyboardEvent) => void) => listeners.set(name, listener), removeEventListener: (name: string) => listeners.delete(name) };
    const node = (name: string) => ({ name, ownerDocument: doc, isConnected: true, matches: () => false, getClientRects: () => [{}], focus() { doc.activeElement = this; } });
    const opener = node('opener'), close = node('close'), checkbox = node('checkbox'), cancel = node('cancel');
    const controls = hasCheckbox ? [close, checkbox, cancel] : [close, cancel];
    const panel = { ...node('panel'), contains: (value: unknown) => controls.includes(value as typeof close), querySelector: (selector: string) => selector.startsWith('input') ? hasCheckbox ? checkbox : null : close, querySelectorAll: () => controls };
    doc.activeElement = opener;
    const exported: { Modal?: (props: { open: boolean; onClose: () => void }) => unknown } = {};
    const jsx = (_type: unknown, props: unknown) => props;
    const mocks: Record<string, unknown> = {
      react: { useEffect: (effect: () => (() => void) | void) => effects.push(effect), useId: () => 'synthetic-title', useRef: (value: unknown) => ({ current: ++ref === 1 ? panel : value }) },
      'react/jsx-runtime': { jsx, jsxs: jsx }, 'framer-motion': { motion: { div: 'div' }, AnimatePresence: 'fragment' }, 'lucide-react': { X: 'x' },
      '../../hooks/useMediaQuery': { useMediaQuery: () => true }, './modalFocus': { restoreModalFocus },
    };
    runInNewContext(code, { exports: exported, require: (name: string) => { assert.ok(name in mocks, name); return mocks[name]; }, document: doc });
    exported.Modal!({ open: true, onClose: () => { closes++; } });
    const cleanup = effects.map(effect => effect()).filter((fn): fn is () => void => typeof fn === 'function').at(-1)!;
    assert.equal(doc.activeElement, hasCheckbox ? checkbox : close); assert.equal(doc.body.style.overflow, 'hidden');
    const dispatch = (key: string, shiftKey = false) => { let prevented = false, stopped = false; listeners.get('keydown')!({ key, shiftKey, preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } } as KeyboardEvent); return { prevented, stopped }; };
    doc.activeElement = cancel; assert.equal(dispatch('Tab').prevented, true); assert.equal(doc.activeElement, close);
    assert.equal(dispatch('Tab', true).prevented, true); assert.equal(doc.activeElement, cancel);
    doc.activeElement = hasCheckbox ? checkbox : close; assert.equal(dispatch('Tab').prevented, false, 'Interior Tab remains browser default');
    doc.activeElement = doc.body; assert.equal(dispatch('Tab').prevented, true, 'Forward Tab must not escape the still-open Modal when a focused child disappeared'); assert.equal(doc.activeElement, close);
    assert.deepEqual(dispatch('Escape'), { prevented: false, stopped: true }); assert.equal(closes, 1);
    cleanup(); assert.equal(doc.activeElement, opener); assert.equal(doc.body.style.overflow, 'scroll'); assert.equal(listeners.size, 0);
  }
});
