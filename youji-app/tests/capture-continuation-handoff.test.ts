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
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, localStorage: memory(), sessionStorage: memory(), window: Object.assign(new EventTarget(), { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), location: { replace() {} } }), document: { documentElement: { setAttribute() {} } } });
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
// Production React components and services; router, animation and Modal host are
// declared substitutes. No browser layout, native focus, clipboard or paint claim.
function setup(page: 'QuickNote' | 'QuickNoteResult', overrides: Record<string, unknown> = {}) {
  const navigations: unknown[][] = [], cache = new Map<string, Record<string, React.ComponentType>>();
  const modules: Record<string, unknown> = {
    'dexie': dexie,
    'react-router-dom': { useLocation: () => ({ key: 'synthetic', search: '', state: null }), useNavigate: () => (...args: unknown[]) => navigations.push(args), Link: host('a') },
    'framer-motion': { motion: new Proxy({}, { get: (_target, key) => String(key) }), useReducedMotion: () => true },
    'lucide-react': new Proxy({}, { get: () => host('svg') }),
    '../components/ui/Button': { Button: host('button') }, '../ui/Button': { Button: host('button') },
    '../components/ui/Checkbox': { Checkbox: ({ label, ...props }: { label?: string }) => React.createElement('input', { type: 'checkbox', 'aria-label': label, ...props }) },
    '../ui/Modal': { Modal: ({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer: React.ReactNode }) => open ? React.createElement('section', { role: 'dialog', 'aria-label': title }, React.createElement('button', { onClick: onClose }, '宿主Esc关闭'), children, footer) : null },
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
    const bindings = { exports, require: (name: string) => name === './QuickNoteResult' ? compile('pages/QuickNoteResult.tsx') : name === '../components/capture/CaptureDraftBrowser' ? compile('components/capture/CaptureDraftBrowser.tsx') : modules[name] ?? require(name), window, document, localStorage, sessionStorage, structuredClone, setTimeout, clearTimeout, queueMicrotask, URLSearchParams, Object, Reflect, Number, JSON };
    runInThisContext(`(function(${Object.keys(bindings).join(',')}) {${code}\n})`)(...Object.values(bindings));
    return exports;
  }
  return { Component: compile(`pages/${page}.tsx`).default, Review: compile(`pages/${page}.tsx`).CaptureReview as React.ComponentType<{ original: capture.CaptureDraft; continuation: { grant: catalog.CaptureContinuation; onClose: () => void } }>, navigations };
}
async function mount(s: ReturnType<typeof setup>) { let tree!: ReactTestRenderer; await act(async () => { tree = create(React.createElement(s.Component)); }); await settle(() => !text(tree.root).includes('正在恢复本机确认稿') && !text(tree.root).includes('正在保留草稿') && !text(tree.root).includes('正在连接本机草稿')); return tree; }

async function openOriginal(tree: ReactTestRenderer, id: string) {
  await act(async () => button(tree,'查看本机未提交稿').props.onClick()); await settle(() => text(tree.root).includes(`原编号：${id}`));
  await act(async () => tree.root.findByProps({'aria-label':`查看原稿 ${id}`}).props.onClick()); await settle(() => tree.root.findAllByProps({'aria-label':'只读完整原文'}).length===1);
}
for(const page of ['QuickNote','QuickNoteResult'] as const)test(`actual ${page} explicitly continues O with original controls and returns without writes or D replacement`,async()=>{
  const old=await seed('O','  原稿O完整原文  ');await seed('D','  当前编辑D完整原文  ');const s=setup(page),tree=await mount(s);
  try{const before=await facts(),p=[sessionStorage.getItem(`youtrace:input:${owner}`),sessionStorage.getItem(capture.captureSessionKey())];await openOriginal(tree,old.id);await act(async()=>button(tree,'继续核对此稿').props.onClick());await settle(()=>text(tree.root).includes('继续核对原稿 O'));assert.match(text(tree.root),/原稿O完整原文/);await act(async()=>button(tree,'返回原编辑').props.onClick());await settle(()=>tree.root.findAllByProps({'aria-label':'只读完整原文'}).length===0);assert.deepEqual(await facts(),before);assert.deepEqual([sessionStorage.getItem(`youtrace:input:${owner}`),sessionStorage.getItem(capture.captureSessionKey())],p);assert.deepEqual(s.navigations,[]);}
  finally{await act(async()=>tree.unmount());}
});

const pointers = () => [sessionStorage.getItem(`youtrace:input:${owner}`),sessionStorage.getItem(capture.captureSessionKey())];
async function shared() { const input=await capture.forkCaptureInput(),raw='  共用输入原文\n午饭15元；明天交材料  ';await capture.saveCaptureInput(input,raw,basis);const old={...await capture.createCaptureDraft(raw,input,basis),id:'O',diary:null};await capture.saveCaptureDraft(old,true);const date={...basis,date:'2026-10-04'};await capture.saveCaptureInput(input,raw,date);const other={...await capture.createCaptureDraft(raw,input,date),id:'D',diary:null};await capture.saveCaptureDraft(other,true);sessionStorage.setItem(capture.captureSessionKey(),other.id);return {input,old,other};}
async function continueO(tree:ReactTestRenderer) {await openOriginal(tree,'O');await act(async()=>button(tree,'继续核对此稿').props.onClick());await settle(()=>text(tree.root).includes('继续核对原稿 O'),()=>text(tree.root));}
const fields=(tree:ReactTestRenderer)=>tree.root.findAll(n=>visible(n)&&['input','textarea','select'].includes(String(n.type))).map(n=>({type:n.type,label:n.props['aria-label'],value:n.props.value,checked:n.props.checked}));
for(const page of ['QuickNote','QuickNoteResult'] as const)test(`actual ${page} O correction and business commit returns to resident D with same-ID proof and shared raw intact`,async()=>{
 const {old,other,input}=await shared(),s=setup(page),tree=await mount(s);const before=await facts(),p=pointers(),parentFields=fields(tree);
 try{await continueO(tree);await act(async()=>field(tree,'第1笔金额（人民币元）').props.onChange({target:{value:'16.25'}}));await settle(()=>text(tree.root).includes('确认稿已保留在本机')&&!text(tree.root).includes('正在保留修改'));const corrected=(await storage.db.settings.get('capture-review:O'))?.value;assert.equal(corrected.id,old.id);assert.equal(corrected.expenses[0].amount,1625);assert.deepEqual((await storage.db.settings.get('capture-review:D'))?.value,other);assert.deepEqual((await facts()).outbox,before.outbox);assert.deepEqual(pointers(),p);
 await act(async()=>button(tree,'确认保存所选记录').props.onClick());await settle(()=>text(tree.root).includes('这次记录已保存在本机'),()=>text(tree.root));const receipt=await capture.loadCaptureReceipt(old.id);assert.equal(receipt?.input,old.input);assert.equal((await storage.db.quickNotes.get(old.id))?.expenses[0].amount,1625);assert.equal(await storage.db.settings.get('capture-review:O'),undefined);assert.deepEqual((await storage.db.settings.get('capture-review:D'))?.value,other);assert.deepEqual(await storage.db.settings.get(input.key),before.settings.rows.find(r=>r.key===input.key));assert.deepEqual(await storage.db.settings.get(input.key+':context'),before.settings.rows.find(r=>r.key===input.key+':context'));assert.equal(tree.root.findAllByType('button').filter(n=>visible(n)&&text(n)==='再记一条').length,0);
 const committed=await facts();await act(async()=>button(tree,'返回原编辑').props.onClick());await settle(()=>!text(tree.root).includes('这次记录已保存在本机'));assert.deepEqual(fields(tree),parentFields);assert.deepEqual(await facts(),committed);assert.deepEqual(pointers(),p);assert.deepEqual(s.navigations,[]);
 }finally{await act(async()=>tree.unmount());}
});
test('resident current D cannot open a second editable instance of its own ID',async()=>{await shared();const tree=await mount(setup('QuickNoteResult')),before=await facts(),p=pointers();try{await openOriginal(tree,'D');await act(async()=>button(tree,'继续核对此稿').props.onClick());await settle(()=>text(tree.root).includes('这一份正在原页核对'));assert.doesNotMatch(text(tree.root),/继续核对原稿 D/);assert.deepEqual(await facts(),before);assert.deepEqual(pointers(),p);}finally{await act(async()=>tree.unmount());}});
test('refused same-ID Continue clears the unsubscribed detail and requires an explicit fresh selection',async()=>{
 await shared();const tree=await mount(setup('QuickNoteResult'));const before=await facts(),p=pointers();
 try{
  await openOriginal(tree,'D');await act(async()=>button(tree,'继续核对此稿').props.onClick());
  await settle(()=>text(tree.root).includes('这一份正在原页核对'));
  assert.equal(tree.root.findAllByProps({'aria-label':'只读完整原文'}).length,0);
  assert.equal(tree.root.findAllByProps({'aria-label':'已核验原稿只读详情'}).length,0);
  assert.deepEqual(await facts(),before);assert.deepEqual(pointers(),p);
  const row=await storage.db.settings.get('capture-review:D');assert.ok(row);
  const revised={...row,value:{...row.value,input:'  D外部更新后的完整原文\n原空白保留  '}};
  await act(async()=>{await storage.db.settings.put(revised);});
  const afterExternal=await facts(),offset=nativeTransactions.length;
  assert.equal(tree.root.findAllByProps({'aria-label':'只读完整原文'}).length,0);
  await act(async()=>button(tree,'重新读取目录').props.onClick());
  await settle(()=>text(tree.root).includes('D外部更新后的完整原文'));
  await act(async()=>tree.root.findByProps({'aria-label':'查看原稿 D'}).props.onClick());
  await settle(()=>tree.root.findAllByProps({'aria-label':'只读完整原文'}).length===1);
  assert.equal(text(field(tree,'只读完整原文')),revised.value.input);
  assert.deepEqual(await facts(),afterExternal);assert.deepEqual(pointers(),p);
  assert.ok(nativeTransactions.slice(offset).every(tx=>tx.mode==='readonly'));
 }finally{await act(async()=>tree.unmount());}
});
for(const change of ['generation','epoch'] as const)test(`hidden parent ${change} cannot be revealed by returning from child`,async()=>{await shared();const s=setup('QuickNoteResult'),tree=await mount(s);try{await continueO(tree);const before=await facts();await act(async()=>{if(change==='generation'){api.setSessionActive(owner);auth.useAuthStore.setState({user:{...user}});}else await storage.db.settings.put({key:storage.LOCAL_DATA_EPOCH_KEY,value:'synthetic-new-hidden-epoch'});});await settle(()=>text(tree.root).includes('需要重新核对账号'));if(change==='epoch'){const back=tree.root.findAllByType('button').filter(n=>visible(n)&&n.props['aria-label']==='返回');assert.equal(back.length,1);await act(async()=>back[0].props.onClick());}await settle(()=>text(tree.root).includes('原编辑保留但不再展示'),()=>text(tree.root));assert.equal(fields(tree).length,0);assert.doesNotMatch(text(tree.root),/共用输入原文|继续核对原稿/);if(change==='epoch')before.settings.rows=before.settings.rows.map(r=>r.key===storage.LOCAL_DATA_EPOCH_KEY?{...r,value:'synthetic-new-hidden-epoch'}:r);assert.deepEqual(await facts(),before);assert.deepEqual(s.navigations,[]);}finally{await act(async()=>tree.unmount());}});

function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return {promise,resolve};}
for(const page of ['QuickNote','QuickNoteResult'] as const)for(const outcome of ['held','failed'] as const)test(`actual ${page} ${outcome} parent edit refuses Continue without another save or pointer change`,async()=>{
 await shared();const gate=deferred();let armed=false,entered=false,calls=0;
 const integration={...capture,saveCaptureInput:async(...args:Parameters<typeof capture.saveCaptureInput>)=>{if(page==='QuickNote'&&armed){calls++;entered=true;if(outcome==='failed')throw new Error('synthetic parent failure');await gate.promise;}return capture.saveCaptureInput(...args);},saveCaptureDraft:async(...args:Parameters<typeof capture.saveCaptureDraft>)=>{if(page==='QuickNoteResult'&&armed){calls++;entered=true;if(outcome==='failed')throw new Error('synthetic parent failure');await gate.promise;}return capture.saveCaptureDraft(...args);}};
 const s=setup(page,{'../services/quickNoteIntegration':integration}),tree=await mount(s);try{armed=true;await act(async()=>field(tree,page==='QuickNote'?'速记内容':'第1笔金额（人民币元）').props.onChange({target:{value:page==='QuickNote'?'父页新原文，不能被交接覆盖':'18.50'}}));await settle(()=>entered);if(outcome==='failed')await settle(()=>text(tree.root).includes('尚未落盘')||text(tree.root).includes('还没写入'));const before=await facts(),p=pointers();await openOriginal(tree,'O');await act(async()=>button(tree,'继续核对此稿').props.onClick());await settle(()=>text(tree.root).includes('当前编辑尚未稳定保留'));assert.equal(tree.root.findAllByProps({'aria-label':'只读完整原文'}).length,0);assert.doesNotMatch(text(tree.root),/继续核对原稿 O/);assert.equal(calls,1);assert.deepEqual(await facts(),before);assert.deepEqual(pointers(),p);gate.resolve();if(outcome==='held')await settle(()=>text(tree.root).includes(page==='QuickNote'?'原文已保留在本机':'确认稿已保留在本机'));assert.equal(calls,1);assert.deepEqual((await storage.db.settings.get('capture-review:O'))?.value,before.settings.rows.find(r=>r.key==='capture-review:O')?.value);}finally{gate.resolve();await act(async()=>tree.unmount());}
});
for(const action of ['close','parent-change'] as const)test(`actual pending readonly preparation ${action} invalidates late grant and keeps original O`,async()=>{
 await shared();const s=setup('QuickNote'),tree=await mount(s),transaction=storage.db.transaction,gate=deferred();let entered=false,hold=false;
 try{await openOriginal(tree,'O');const change=field(tree,'速记内容').props.onChange;const before=await facts(),p=pointers();storage.db.transaction=function(...args:unknown[]){const work=Reflect.apply(transaction,this,args);if(hold&&args[0]==='r'&&Array.isArray(args[1])&&args[1].length===2){hold=false;entered=true;return work.then(async(value:unknown)=>{await gate.promise;return value;});}return work;}as typeof transaction;hold=true;
 await act(async()=>button(tree,'继续核对此稿').props.onClick());await settle(()=>entered,()=>text(tree.root));
 if(action==='close')await act(async()=>button(tree,'关闭查看').props.onClick());else await act(async()=>change({target:{value:'准备期间合法新输入，必须保留'}}));
 storage.db.transaction=transaction;gate.resolve();await act(async()=>{await tick();await tick();});await settle(()=>!text(tree.root).includes('正在核验这一份原稿'));
 assert.doesNotMatch(text(tree.root),/继续核对原稿 O/);assert.deepEqual((await storage.db.settings.get('capture-review:O'))?.value,before.settings.rows.find(r=>r.key==='capture-review:O')?.value);assert.deepEqual(pointers(),p);assert.deepEqual(s.navigations,[]);if(action==='close')assert.deepEqual(await facts(),before);else assert.equal(field(tree,'速记内容').props.value,'准备期间合法新输入，必须保留');
 }finally{storage.db.transaction=transaction;gate.resolve();await act(async()=>tree.unmount());}
});
test('actual business in-flight close, duplicate Save and retained field callback cannot replace operation or parent',async()=>{
 const {old}=await shared(),gate=deferred();let entered=false,calls=0;const s=setup('QuickNoteResult',{'../services/quickNoteIntegration':{...capture,applyCaptureContinuation:async(...args:Parameters<typeof capture.applyCaptureContinuation>)=>{calls++;entered=true;await gate.promise;return capture.applyCaptureContinuation(...args);}}}),tree=await mount(s);
 try{await continueO(tree);const save=button(tree,'确认保存所选记录').props.onClick,close=button(tree,'返回原编辑').props.onClick,change=field(tree,'第1笔金额（人民币元）').props.onChange;const before=await facts(),p=pointers();await act(async()=>save());await settle(()=>entered);await act(async()=>{close();save();change({target:{value:'999.00'}});});assert.equal(calls,1);assert.match(text(tree.root),/继续核对原稿 O/);assert.equal(field(tree,'第1笔金额（人民币元）').props.value,'15');assert.deepEqual(await facts(),before);assert.deepEqual(pointers(),p);gate.resolve();await settle(()=>text(tree.root).includes('这次记录已保存在本机'));assert.equal((await storage.db.quickNotes.get(old.id))?.expenses[0].amount,1500);assert.equal(calls,1);}finally{gate.resolve();await act(async()=>tree.unmount());}
});
for(const fault of ['lost-result','receipt-read'] as const)test(`actual completed ${fault} only retries strict history, never another apply/outbox`,async()=>{
 const {old}=await shared();let applyCalls=0,receiptCalls=0;const s=setup('QuickNoteResult',{'../services/quickNoteIntegration':{...capture,applyCaptureContinuation:async(...args:Parameters<typeof capture.applyCaptureContinuation>)=>{applyCalls++;const value=await capture.applyCaptureContinuation(...args);if(fault==='lost-result')throw new Error('synthetic committed result lost');return value;},loadCaptureReceipt:async(id:string)=>{if(id===old.id&&++receiptCalls===1&&fault==='receipt-read')throw new Error('synthetic receipt read failure');return capture.loadCaptureReceipt(id);}}}),tree=await mount(s);
 try{await continueO(tree);await act(async()=>button(tree,'确认保存所选记录').props.onClick());await settle(()=>tree.root.findAllByType('button').some(n=>visible(n)&&text(n)==='重新读取本次保存结果'));const before=await facts(),p=pointers();assert.ok(await storage.db.quickNotes.get(old.id));await act(async()=>button(tree,'重新读取本次保存结果').props.onClick());await settle(()=>text(tree.root).includes('这次记录已保存在本机'));assert.equal(applyCalls,1);assert.deepEqual(await facts(),before);assert.deepEqual(pointers(),p);}finally{await act(async()=>tree.unmount());}
});
test('actual pure amount error remains editable and correction commits the same original ID',async()=>{
 const {old}=await shared(),tree=await mount(setup('QuickNoteResult'));try{await continueO(tree);await act(async()=>field(tree,'第1笔金额（人民币元）').props.onChange({target:{value:'0'}}));await settle(()=>text(tree.root).includes('确认稿已保留在本机')&&!text(tree.root).includes('正在保留修改'));await act(async()=>button(tree,'确认保存所选记录').props.onClick());await settle(()=>tree.root.findAllByProps({role:'alert'}).filter(visible).length>0);assert.equal(tree.root.findAllByType('fieldset').filter(visible)[0].props.disabled,false);await act(async()=>field(tree,'第1笔金额（人民币元）').props.onChange({target:{value:'19.50'}}));await settle(()=>text(tree.root).includes('确认稿已保留在本机')&&!text(tree.root).includes('正在保留修改'));await act(async()=>button(tree,'确认保存所选记录').props.onClick());await settle(()=>text(tree.root).includes('这次记录已保存在本机'));assert.equal((await storage.db.quickNotes.get(old.id))?.expenses[0].amount,1950);}finally{await act(async()=>tree.unmount());}
});

test('actual speech session refuses a previously retained Continue action without stopping speech or saving O',async()=>{
 await shared();class Recognition extends EventTarget{lang='';continuous=false;interimResults=false;onresult=null;onerror=null;onend:(()=>void)|null=null;starts=0;stops=0;start(){this.starts++;}stop(){this.stops++;}}const original=Object.getOwnPropertyDescriptor(window,'SpeechRecognition');const recognizers:Recognition[]=[];Object.defineProperty(window,'SpeechRecognition',{configurable:true,value:class extends Recognition{constructor(){super();recognizers.push(this);}}});const s=setup('QuickNote'),tree=await mount(s);
 try{await act(async()=>button(tree,'语音输入').props.onClick());const start=button(tree,'开始语音输入').props.onClick;await openOriginal(tree,'O');const resume=button(tree,'继续核对此稿').props.onClick;const before=await facts(),p=pointers();await act(async()=>start());assert.equal(recognizers[0]?.starts,1);await act(async()=>resume());await settle(()=>text(tree.root).includes('当前编辑尚未稳定保留'));assert.equal(recognizers[0]?.stops,0);assert.deepEqual(await facts(),before);assert.deepEqual(pointers(),p);assert.doesNotMatch(text(tree.root),/继续核对原稿 O/);}finally{await act(async()=>tree.unmount());if(original)Object.defineProperty(window,'SpeechRecognition',original);else Reflect.deleteProperty(window,'SpeechRecognition');}
});
test('actual registered transaction quota failure stays frozen for exact retry and then commits once',async()=>{
 const {old}=await shared(),s=setup('QuickNoteResult'),tree=await mount(s),add=storage.db.settings.add;let armed=false,fired=false;storage.db.settings.add=function(...args:Parameters<typeof add>){if(armed&&!fired&&args[0].key===`capture-applied:${old.id}`){fired=true;return Promise.reject(new DOMException('synthetic quota','QuotaExceededError'))as ReturnType<typeof add>;}return add.apply(this,args);};
 try{await continueO(tree);const before=await facts(),p=pointers();armed=true;await act(async()=>button(tree,'确认保存所选记录').props.onClick());await settle(()=>tree.root.findAllByType('button').some(n=>visible(n)&&text(n)==='重试同一次确认保存'));assert.equal(fired,true);assert.deepEqual(await facts(),before);assert.deepEqual(pointers(),p);assert.equal(tree.root.findAllByType('fieldset').filter(visible)[0].props.disabled,true);const change=field(tree,'第1笔金额（人民币元）').props.onChange;await act(async()=>change({target:{value:'999.00'}}));assert.equal(field(tree,'第1笔金额（人民币元）').props.value,'15');await act(async()=>button(tree,'重试同一次确认保存').props.onClick());await settle(()=>text(tree.root).includes('这次记录已保存在本机'));assert.equal((await storage.db.quickNotes.get(old.id))?.expenses[0].amount,1500);assert.equal((await storage.db.quickNotes.toArray()).filter(n=>n.id===old.id).length,1);}finally{storage.db.settings.add=add;await act(async()=>tree.unmount());}
});
test('actual failed local O correction keeps child text and blocks return without changing resident D',async()=>{
 const {other}=await shared(),s=setup('QuickNoteResult'),tree=await mount(s),put=storage.db.settings.put;let armed=false;storage.db.settings.put=function(...args:Parameters<typeof put>){if(armed&&args[0].key==='capture-review:O')return Promise.reject(new DOMException('synthetic quota','QuotaExceededError'))as ReturnType<typeof put>;return put.apply(this,args);};
 try{await continueO(tree);const before=await facts(),p=pointers();armed=true;await act(async()=>field(tree,'第1笔金额（人民币元）').props.onChange({target:{value:'33.40'}}));await settle(()=>text(tree.root).includes('修改还没写入本机'));await act(async()=>button(tree,'返回原编辑').props.onClick());assert.match(text(tree.root),/继续核对原稿 O/);assert.equal(field(tree,'第1笔金额（人民币元）').props.value,'33.40');assert.deepEqual(await facts(),before);assert.deepEqual(pointers(),p);assert.deepEqual((await storage.db.settings.get('capture-review:D'))?.value,other);armed=false;await act(async()=>button(tree,'重试保留修改').props.onClick());await settle(()=>text(tree.root).includes('确认稿已保留在本机')&&!text(tree.root).includes('修改还没写入本机'));assert.equal((await storage.db.settings.get('capture-review:O'))?.value.expenses[0].amount,3340);}finally{storage.db.settings.put=put;await act(async()=>tree.unmount());}
});
for(const late of ['resolve','reject']as const)test(`completed old child late ${late} after unmount cannot replace a different newly mounted editor`,async()=>{
 await shared();const gate=deferred();let entered=false;const s=setup('QuickNoteResult',{'../services/quickNoteIntegration':{...capture,applyCaptureContinuation:async(...args:Parameters<typeof capture.applyCaptureContinuation>)=>{const result=await capture.applyCaptureContinuation(...args);entered=true;await gate.promise;if(late==='reject')throw new Error('old synthetic result rejected');return result;}}}),tree=await mount(s);let other:ReactTestRenderer|undefined;
 try{await continueO(tree);await act(async()=>button(tree,'确认保存所选记录').props.onClick());await settle(()=>entered);const committed=await facts();await act(async()=>tree.unmount());const next=setup('QuickNoteResult');other=await mount(next);const fieldsBefore=fields(other);gate.resolve();await act(async()=>{await tick();await tick();});assert.deepEqual(fields(other),fieldsBefore);assert.doesNotMatch(text(other.root),/这次记录已保存在本机|继续核对原稿 O|old synthetic/);assert.deepEqual(await facts(),committed);assert.deepEqual(next.navigations,[]);}finally{gate.resolve();if(other)await act(async()=>other!.unmount());}
});
