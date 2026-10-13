import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInThisContext } from 'node:vm';
import { after, beforeEach, test } from 'node:test';
import * as React from 'react';
import { act } from 'react';
import { create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer';
import ts from 'typescript';
const memory = () => { const map = new Map<string, string>(); return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => map.set(key, value), removeItem: (key: string) => map.delete(key), clear: () => map.clear() }; };
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, localStorage: memory(), sessionStorage: memory(), window: Object.assign(new EventTarget(), { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), location: { replace() {} } }), document: Object.assign(new EventTarget(), { body: { style: { overflow: '' } }, activeElement: null, documentElement: { setAttribute() {} } }) });
const storage = await import('../src/db/index.ts'), api = await import('../src/services/apiClient.ts'), sync = await import('../src/services/syncEngine.ts');
const capture = await import('../src/services/quickNoteIntegration.ts'), catalog = await import('../src/services/captureDraftCatalog.ts'), parser = await import('../src/services/parser.ts');
const localActor = await import('../src/services/localActor.ts');
const provenance = await import('../src/services/captureInputProvenance.ts');
const inputMemory = await import('../src/services/captureInputMemory.ts');
const handoff = await import('../src/components/capture/useCaptureContinuationHandoff.ts');
const presentation = await import('../src/services/capturePresentation.ts'), pending = await import('../src/services/pendingEditorMemory.ts'), receiptView = await import('../src/services/captureReceiptView.ts');
const auth = await import('../src/stores/authStore.ts'), habits = await import('../src/stores/habitStore.ts'), icons = await import('../src/utils/icons.ts');
const require = createRequire(import.meta.url);
const dexie = await import('dexie');
const nativeTransactions: Array<{ name: string; mode: string }> = [];
const nativeTransaction = IDBDatabase.prototype.transaction;
IDBDatabase.prototype.transaction = function (...args: Parameters<IDBDatabase['transaction']>) { nativeTransactions.push({ name: this.name, mode: args[1] ?? 'readonly' }); return nativeTransaction.apply(this, args); };
const owner = 'synthetic-continuation-handoff';
const user = { id: owner, phone: 'SYNTHETIC', nickname: '合成目录账号', avatar: '', identity: 'adult', city: '', coachStyle: '', quietStart: '', quietEnd: '', pushLimit: 1 };
const basis = { capturedAt: 1791028800000, timeZone: 'Asia/Shanghai', date: '2026-10-03' };
const text = (node: ReactTestInstance | string): string => typeof node === 'string' ? node : node.props.hidden ? '' : node.children.map(text).join('');
const visible = (node: ReactTestInstance): boolean => !node.props.hidden && (!node.parent || visible(node.parent));
const field = (tree: ReactTestRenderer, label: string) => { const all = tree.root.findAllByProps({ 'aria-label': label }).filter(visible); assert.equal(all.length, 1, `visible field ${label}`); return all[0]; };
const button = (tree: ReactTestRenderer, label: string) => { const found = tree.root.findAllByType('button').filter(node => visible(node) && text(node) === label); assert.equal(found.length, 1, `one visible handler: ${label}`); return found[0]; };
const host = (tag: string) => ({ children, ...props }: React.HTMLAttributes<HTMLElement>) => React.createElement(tag, props, children);
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
async function settle(test: () => boolean, diagnostic: () => string = () => '') { const deadline = performance.now()+5000; while(performance.now()<deadline) { if (test()) return; await act(async () => { await tick(); }); } assert.ok(test(), `5s component/IDB deadline: ${diagnostic()}`); }
async function facts() { return storage.db.transaction('r', storage.db.tables, async () => Object.fromEntries(await Promise.all(storage.db.tables.map(async table => [table.name, { keys: await table.toCollection().primaryKeys(), rows: await table.toArray() }])))); }
async function seed(id: string, raw = `  合成${id}原文\n午饭15元；明天交报告  `) {
  const input = await capture.forkCaptureInput(); await capture.saveCaptureInput(input, raw, basis);
  const draft = { ...await capture.createCaptureDraft(raw, input, basis), id }; await capture.saveCaptureDraft(draft, true); return draft;
}
beforeEach(async () => { inputMemory.releaseCaptureInputMemory(inputMemory.retainCaptureInputMemory(owner, '', basis)); sync.pauseSync(); api.clearSession(); localStorage.clear(); sessionStorage.clear(); await storage.bindAccountDatabase(owner); api.setSessionActive(owner); auth.useAuthStore.setState({ user, isAuthenticated: true }); await storage.clearAllData({ allowPending: true }); sync.pauseSync(); globalThis.fetch = async () => { throw new Error('SYNTHETIC_OFFLINE'); }; });
after(() => { sync.pauseSync(); storage.db.close(); IDBDatabase.prototype.transaction = nativeTransaction; });
// Actual React pages, Catalog, Modal, Button, Checkbox and services. Router,
// animation and DOM-shaped focus targets are substitutes. Native default Tab/
// Enter, paint, scroll and browser unmount-focus behavior are not claimed.
function setup(page: 'QuickNote' | 'QuickNoteResult', overrides: Record<string, unknown> = {}) {
  const navigations: unknown[][] = [], cache = new Map<string, Record<string, React.ComponentType>>();
  const modules: Record<string, unknown> = {
    'dexie': dexie,
    'react-router-dom': { useLocation: () => ({ key: 'synthetic', search: '', state: null }), useNavigate: () => (...args: unknown[]) => navigations.push(args), Link: host('a') },
    'framer-motion': { motion: new Proxy({}, { get: (_target, key) => String(key) }), useReducedMotion: () => true, AnimatePresence: React.Fragment },
    'lucide-react': new Proxy({}, { get: () => host('svg') }),
    '../components/ui/Button': { Button: host('button') }, '../ui/Button': { Button: host('button') },
    '../components/ui/Checkbox': { Checkbox: ({ label, ...props }: { label?: string }) => React.createElement('input', { type: 'checkbox', 'aria-label': label, ...props }) },
    'unused/Modal': { Modal: ({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer: React.ReactNode }) => open ? React.createElement('section', { role: 'dialog', 'aria-label': title }, React.createElement('button', { onClick: onClose }, '宿主Esc关闭'), children, footer) : null },
    '../services/captureDraftCatalog': catalog, '../services/quickNoteIntegration': capture, '../services/parser': parser, '../services/capturePresentation': presentation,
    '../components/capture/useCaptureContinuationHandoff': handoff, '../services/captureInputMemory': inputMemory, '../services/localActor': localActor, '../services/captureInputProvenance': provenance, '../services/pendingEditorMemory': pending, '../services/captureReceiptView': receiptView, '../services/apiClient': api,
    '../services/diagnostics': { recordDiagnostic() {} }, '../db': storage, '../utils/icons': icons,
    '../stores/useHabitStore': habits, '../stores/habitStore': habits, '../stores/authStore': auth,
    '../../services/captureDraftCatalog': catalog, '../../services/localActor': localActor, '../../stores/authStore': auth, '../../services/apiClient': api,
    ...overrides,
  };
  function compile(path: string): Record<string, React.ComponentType> {
    if (cache.has(path)) return cache.get(path)!;
    const exports: Record<string, React.ComponentType> = {}; cache.set(path, exports);
    const source = readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2023 } }).outputText;
    // Same JS realm as the actual services: cross-realm VM object literals
    // deliberately fail the service's plain-record check and do not model the app.
    const bindings = { exports, require: (name: string) => name === '../ui/Modal' ? compile('components/ui/Modal.tsx') : name === '../ui/Button' || name === '../components/ui/Button' ? compile('components/ui/Button.tsx') : name === '../components/ui/Checkbox' ? compile('components/ui/Checkbox.tsx') : name === './modalFocus' ? require('../src/components/ui/modalFocus.ts') : name === '../../hooks/useMediaQuery' ? { useMediaQuery: () => false } : name === './QuickNoteResult' ? compile('pages/QuickNoteResult.tsx') : name === '../components/capture/CaptureDraftBrowser' ? compile('components/capture/CaptureDraftBrowser.tsx') : modules[name] ?? require(name), window, document, localStorage, sessionStorage, structuredClone, setTimeout, clearTimeout, queueMicrotask, URLSearchParams, Object, Reflect, Number, JSON };
    runInThisContext(`(function(${Object.keys(bindings).join(',')}) {${code}\n})`)(...Object.values(bindings));
    return exports;
  }
  return { Modal: compile('components/ui/Modal.tsx').Modal, Component: compile(`pages/${page}.tsx`).default, Review: compile(`pages/${page}.tsx`).CaptureReview as React.ComponentType<{ original: capture.CaptureDraft; continuation: { grant: catalog.CaptureContinuation; onClose: () => void } }>, navigations };
}
async function mount(s: ReturnType<typeof setup>) { let tree!: ReactTestRenderer; const dom = domSurface(() => tree); surfaces.set(s, dom); await act(async () => { tree = create(React.createElement(s.Component), { createNodeMock: dom.nodeMock }); }); await settle(() => !text(tree.root).includes('正在恢复本机确认稿') && !text(tree.root).includes('正在保留草稿') && !text(tree.root).includes('正在连接本机草稿')); return tree; }

async function openOriginal(tree: ReactTestRenderer, id: string) {
  await act(async () => button(tree,'查看本机未提交稿').props.onClick()); await settle(() => text(tree.root).includes(`原编号：${id}`));
  await act(async () => tree.root.findByProps({'aria-label':`查看原稿 ${id}`}).props.onClick()); await settle(() => tree.root.findAllByProps({'aria-label':'只读完整原文'}).length===1);
}

// A focused removed DOM element leaves document.activeElement at body in the
// native platform; here that step is explicit and limited to a host model.
const surfaces = new WeakMap<ReturnType<typeof setup>, ReturnType<typeof domSurface>>();
function domSurface(getTree: () => ReactTestRenderer) {
  const doc = document as unknown as EventTarget & { activeElement: unknown; body: {style: {overflow: string}}; documentElement: unknown };
  const cache = new WeakMap<ReactTestInstance, ReturnType<typeof make>>();
  const all = () => { try { return getTree().root.findAll(n => typeof n.type === 'string'); } catch { return []; } };
  function make(resolve: () => ReactTestInstance | undefined) {
    const node = {
      ownerDocument: doc,
      get target() { return resolve(); },
      get isConnected() { const target=resolve(); return Boolean(target && all().includes(target)); },
      matches: () => Boolean(resolve()?.props.disabled || resolve()?.props.hidden),
      getClientRects: () => {const target=resolve();return target && visible(target) ? [{}] : [];},
      focus() { doc.activeElement=node; },
      contains(other: unknown) { const target=resolve(); if (!target) return false; return target.findAll(n=>typeof n.type==='string').some(n=>mapped(n)===other); },
      querySelector(selector:string) { return node.querySelectorAll(selector)[0] ?? null; },
      querySelectorAll(selector:string) {
        const target=resolve(); if (!target) return [];
        const candidates=target.findAll(n=>typeof n.type==='string'&&visible(n));
        const filtered=candidates.filter(n=>selector==='[data-capture-catalog-open]' ? n.props['data-capture-catalog-open']!==undefined : selector==='input:not([type=hidden]), textarea, select' ? ['input','textarea','select'].includes(String(n.type)) && n.props.type!=='hidden' : !n.props.disabled && (['button','textarea','select'].includes(String(n.type)) || n.type==='input'&&n.props.type!=='hidden' || n.type==='a'&&n.props.href || n.props.tabIndex!==undefined&&n.props.tabIndex!==-1));
        return filtered.map(mapped);
      },
    };
    return node;
  }
  function mapped(target: ReactTestInstance): ReturnType<typeof make> { let node=cache.get(target);if(!node){node=make(()=>all().includes(target)?target:undefined);cache.set(target,node);}return node; }
  const nodeMock=(element:React.ReactElement<Record<string,unknown>>) => make(()=>element.props.role==='dialog'?all().find(n=>n.props.role==='dialog'&&n.props['aria-labelledby']===element.props['aria-labelledby']):element.props.id?all().find(n=>n.props.id===element.props.id):all().find(n=>n.type==='div'&&n.props.hidden!==undefined));
  const key=(key:string,shiftKey=false)=>{const e=new Event('keydown',{cancelable:true});Object.assign(e,{key,shiftKey});doc.dispatchEvent(e);return e;};
  return { doc, mapped, nodeMock, key, all };
}
for(const page of ['QuickNote','QuickNoteResult']as const)test(`actual ${page} detail transition removes its focused entry; original Modal must recapture forward Tab (host DOM model)`,async()=>{
  const old=await seed('O','  原稿 O 完整原文  ');await seed('D','  当前 D 原文  ');const s=setup(page),tree=await mount(s),dom=surfaces.get(s)!;
  try{
    const before=await facts(),p=[sessionStorage.getItem(`youtrace:input:${owner}`),sessionStorage.getItem(capture.captureSessionKey())];
    const opener=dom.mapped(button(tree,'查看本机未提交稿'));opener.focus();
    await act(async()=>button(tree,'查看本机未提交稿').props.onClick());await settle(()=>text(tree.root).includes(`原编号：${old.id}`));
    const control=tree.root.findAllByType('button').find(n=>n.props['aria-label']===`查看原稿 ${old.id}`)!;assert.equal(control.props.type,'button');const removed=dom.mapped(control);removed.focus();
    await act(async()=>control.props.onClick());await settle(()=>tree.root.findAllByProps({'aria-label':'只读完整原文'}).length===1);
    assert.equal(removed.isConnected,false,'real React detail transition removed the focused original control');
    dom.doc.activeElement=dom.doc.body;
    const e=dom.key('Tab');assert.equal(e.defaultPrevented,true,'forward Tab after removed control must remain within the open Modal');
    assert.notEqual(dom.doc.activeElement,dom.doc.body);assert.deepEqual(await facts(),before);assert.deepEqual([sessionStorage.getItem(`youtrace:input:${owner}`),sessionStorage.getItem(capture.captureSessionKey())],p);
    await act(async()=>{dom.key('Escape');});assert.equal(tree.root.findAllByProps({role:'dialog'}).length,0);assert.equal(dom.doc.activeElement,opener);assert.deepEqual(await facts(),before);
  }finally{await act(async()=>tree.unmount());}
});

for(const page of ['QuickNote','QuickNoteResult']as const)test(`actual ${page} continuation heading and safe return focus the resident original entry (DOM targets only)`,async()=>{
  await seed('O','  原稿 O 完整原文  ');await seed('D','  当前 D 原文  ');const s=setup(page),tree=await mount(s),dom=surfaces.get(s)!;
  try{
    const before=await facts(),p=[sessionStorage.getItem(`youtrace:input:${owner}`),sessionStorage.getItem(capture.captureSessionKey())];
    const opener=dom.mapped(button(tree,'查看本机未提交稿'));opener.focus();await openOriginal(tree,'O');
    await act(async()=>button(tree,'继续核对此稿').props.onClick());await settle(()=>text(tree.root).includes('继续核对原稿 O'));
    assert.equal((dom.doc.activeElement as {target?:ReactTestInstance})?.target?.props.id,'continuation-review-title');
    assert.equal(tree.root.findAllByProps({role:'dialog'}).length,0,'catalog Modal closed before isolated page');
    await act(async()=>{dom.key('Escape');});assert.match(text(tree.root),/继续核对原稿 O/,'no new global Esc behavior on isolated page');
    await act(async()=>button(tree,'返回原编辑').props.onClick());await settle(()=>!text(tree.root).includes('继续核对原稿 O'));
    assert.equal(dom.doc.activeElement,opener);assert.deepEqual(await facts(),before);assert.deepEqual([sessionStorage.getItem(`youtrace:input:${owner}`),sessionStorage.getItem(capture.captureSessionKey())],p);
  }finally{await act(async()=>tree.unmount());}
});

test('actual isolated in-flight Save rejects header/footer return and retained callbacks; no Escape side-effect or second commit',async()=>{
  const old=await seed('O');await seed('D');let release!:()=>void,entered=false,calls=0;const gate=new Promise<void>(r=>release=r);
  const s=setup('QuickNoteResult',{'../services/quickNoteIntegration':{...capture,applyCaptureContinuation:async(...args:Parameters<typeof capture.applyCaptureContinuation>)=>{entered=true;calls++;await gate;return capture.applyCaptureContinuation(...args);}}}),tree=await mount(s),dom=surfaces.get(s)!;
  try{
    await openOriginal(tree,'O');await act(async()=>button(tree,'继续核对此稿').props.onClick());await settle(()=>text(tree.root).includes('继续核对原稿 O'));
    const save=button(tree,'确认保存所选记录').props.onClick,back=button(tree,'返回原编辑').props.onClick,edit=field(tree,'第1笔金额（人民币元）').props.onChange;
    const before=await facts(),p=[sessionStorage.getItem(`youtrace:input:${owner}`),sessionStorage.getItem(capture.captureSessionKey())];
    await act(async()=>save());await settle(()=>entered);assert.equal(button(tree,'返回原编辑').props.disabled,true);assert.equal(button(tree,'正在保存…').props.disabled,true);
    await act(async()=>{dom.key('Escape');back();save();edit({target:{value:'999'}});tree.root.findAllByType('button').find(n=>visible(n)&&n.props['aria-label']==='返回')!.props.onClick();});
    assert.equal(calls,1);assert.match(text(tree.root),/继续核对原稿 O/);assert.equal(field(tree,'第1笔金额（人民币元）').props.value,'15');assert.deepEqual(await facts(),before);assert.deepEqual([sessionStorage.getItem(`youtrace:input:${owner}`),sessionStorage.getItem(capture.captureSessionKey())],p);
    release();await settle(()=>text(tree.root).includes('这次记录已保存在本机'));assert.equal((await storage.db.quickNotes.get(old.id))?.expenses[0].amount,1500);assert.equal(calls,1);
  }finally{release();await act(async()=>tree.unmount());}
});

test('actual stacked Modals keep top-level keyboard ownership, internal and unrelated keys, cleanup and natural return (DOM targets)',async()=>{
  const s=setup('QuickNote'),Modal=s.Modal as React.ComponentType<{open:boolean;title?:string;onClose:()=>void;children?:React.ReactNode;footer?:React.ReactNode}>;
  let tree!:ReactTestRenderer,show!:(value:boolean)=>void,innerCloses=0,outerCloses=0;const dom=domSurface(()=>tree);
  function Example(){const[inner,setInner]=React.useState(false);show=setInner;return React.createElement(Modal,{open:true,title:'outer',onClose:()=>{outerCloses++;},footer:React.createElement('button',{},'outer-last')},React.createElement('input',{'aria-label':'outer-field'}),inner&&React.createElement(Modal,{open:true,title:'inner',onClose:()=>{innerCloses++;setInner(false);},footer:React.createElement('button',{},'inner-last')},React.createElement('input',{'aria-label':'inner-field'})));}
  try{
    await act(async()=>{tree=create(React.createElement(Example),{createNodeMock:dom.nodeMock});});const original=dom.mapped(field(tree,'outer-field'));assert.equal(dom.doc.activeElement,original);
    await act(async()=>show(true));const inner=dom.mapped(field(tree,'inner-field'));assert.equal(dom.doc.activeElement,inner);
    assert.equal(dom.key('ArrowDown').defaultPrevented,false);assert.equal(dom.doc.activeElement,inner);assert.equal(dom.key('Tab').defaultPrevented,false,'interior uses browser default');
    dom.doc.activeElement=dom.doc.body;assert.equal(dom.key('Tab').defaultPrevented,true);const dialogs=tree.root.findAllByProps({role:'dialog'}),innerDialog=dialogs.at(-1)!;const first=dom.mapped(innerDialog.findAllByType('button')[0]);assert.equal(dom.doc.activeElement,first);
    assert.equal(dom.key('Tab',true).defaultPrevented,true);assert.equal(dom.doc.activeElement,dom.mapped(button(tree,'inner-last')));
    assert.equal(dom.key('Tab').defaultPrevented,true);assert.equal(dom.doc.activeElement,first);
    await act(async()=>{dom.key('Escape');});assert.equal(innerCloses,1);assert.equal(outerCloses,0);assert.equal(dom.doc.activeElement,original);assert.equal(dom.doc.body.style.overflow,'hidden');
    await act(async()=>tree.unmount());assert.equal(dom.doc.body.style.overflow,'');dom.key('Escape');assert.equal(outerCloses,0,'all keyboard listeners removed');
  }finally{if(tree)await act(async()=>tree.unmount());}
});

test('actual Modal with no focusable controls prevents both Tab directions and leaves non-Tab keys unchanged',async()=>{
  const s=setup('QuickNote'),Modal=s.Modal as React.ComponentType<{open:boolean;onClose:()=>void;children?:React.ReactNode}>;let tree!:ReactTestRenderer,closes=0;const dom=domSurface(()=>tree);
  try{await act(async()=>{tree=create(React.createElement(Modal,{open:true,onClose:()=>{closes++;}},React.createElement('p',{},'readonly')),{createNodeMock:dom.nodeMock});});const panel=dom.doc.activeElement;assert.equal(dom.key('Tab').defaultPrevented,true);assert.equal(dom.key('Tab',true).defaultPrevented,true);assert.equal(dom.doc.activeElement,panel);assert.equal(dom.key('Enter').defaultPrevented,false);assert.equal(closes,0);await act(async()=>{dom.key('Escape');});assert.equal(closes,1);}finally{await act(async()=>tree.unmount());}
});
