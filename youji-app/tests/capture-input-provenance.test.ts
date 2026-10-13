import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
const memory = () => { const v = new Map<string,string>(); return { getItem:(k:string)=>v.get(k)??null, setItem:(k:string,x:string)=>v.set(k,x), removeItem:(k:string)=>v.delete(k), clear:()=>v.clear(), entries:()=>[...v] }; };
Object.assign(globalThis,{localStorage:memory(),sessionStorage:memory(),window:Object.assign(new EventTarget(),{matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}}),location:{replace(){}}}),document:{documentElement:{setAttribute(){}}}});
const storage=await import('../src/db/index.ts'), api=await import('../src/services/apiClient.ts'), sync=await import('../src/services/syncEngine.ts'), capture=await import('../src/services/quickNoteIntegration.ts'), origin=await import('../src/services/captureInputProvenance.ts');
const basis={capturedAt:1791028800000,timeZone:'Asia/Shanghai',date:'2026-10-03'};
beforeEach(async()=>{sync.pauseSync();api.clearSession();localStorage.clear();sessionStorage.clear();await storage.bindAccountDatabase('synthetic-input-origin');api.setSessionActive('synthetic-input-origin');await storage.clearAllData({allowPending:true});sync.pauseSync();});
after(()=>{sync.pauseSync();storage.db.close();});
async function facts(){return storage.db.transaction('r',storage.db.tables,async()=>Object.fromEntries(await Promise.all(storage.db.tables.map(async t=>[t.name,{keys:await t.toCollection().primaryKeys(),values:await t.toArray()}]))));}
async function source(raw='  合成原输入\n  '){const input=await capture.forkCaptureInput();await capture.saveCaptureInput(input,raw,basis);return {...input,text:raw,context:basis};}
async function candidate(input:Awaited<ReturnType<typeof source>>){return capture.createCaptureDraft(input.text,input,input.context);}
async function originRow(key:string){const row=await storage.db.settings.get(origin.captureInputOriginKey(key));assert.ok(row);return row;}

test('actual fork: fresh empty root and chained copies create new drafts without changing their source rows',async()=>{
 const first=await source();const root=await originRow(first.key);assert.equal(root.value.parent,'root');assert.deepEqual(root.value.input,{present:false});assert.deepEqual(root.value.context,{present:false});
 const before=await facts(), second=await capture.forkCaptureInput(), child=await originRow(second.key);assert.equal(child.value.parent,'input');assert.equal(child.value.sourceKey,first.key);
 assert.deepEqual(child.value.input,{present:true,row:{key:first.key,value:first.text}});assert.deepEqual(child.value.context,{present:true,row:{key:first.key+':context',value:basis}});
 const draft=await candidate(second);await capture.saveCaptureDraft(draft,true);
 for(const row of before.settings.values)assert.deepEqual(await storage.db.settings.get(row.key),row);
 assert.equal((await storage.db.settings.get(`capture-review:${draft.id}`))?.value.id,draft.id);assert.equal(await storage.db.outbox.count(),0);assert.equal(await storage.db.quickNotes.count(),0);
});

test('actual fork: separate concurrent source writer cannot mix old text with new date',async()=>{
 const first=await source('合成旧文'),Dexie=(await import('dexie')).default,get=storage.db.settings.get;let writer:Promise<void>|undefined,once=false;
 storage.db.settings.get=function(...args:Parameters<typeof get>){return get.apply(this,args).then(value=>{if(args[0]===first.key&&!once){once=true;writer=Dexie.ignoreTransaction(()=>capture.saveCaptureInput(first,'合成新文',{...basis,date:'2026-10-04'}));}return value;});} as typeof get;
 let copied:Awaited<ReturnType<typeof capture.forkCaptureInput>>;
 try{copied=await capture.forkCaptureInput();await writer;}finally{storage.db.settings.get=get;}
 assert.equal(copied.text,'合成旧文');assert.deepEqual(copied.context,basis);
 const proof=await originRow(copied.key);assert.equal(proof.value.input.row.value,copied.text);assert.deepEqual(proof.value.context.row.value,copied.context);
 assert.equal((await storage.db.settings.get(first.key))?.value,'合成新文');
});

for(const marker of [undefined,null,{format:'unknown'}])test(`first put: opaque consumption marker ${String(marker)} arriving after create rejects atomically`,async()=>{
 const input=await source(),draft=await candidate(input);await storage.db.settings.put({key:origin.captureInputConsumptionKey(input.key),value:marker});const before=await facts(),pointers=(sessionStorage as unknown as ReturnType<typeof memory>).entries();
 await assert.rejects(capture.saveCaptureDraft(draft,true),/来源/);assert.deepEqual(await facts(),before);assert.deepEqual((sessionStorage as unknown as ReturnType<typeof memory>).entries(),pointers);
});

for(const refork of [false,true])test(`first put: consumption after an earlier fork still blocks descendants (refork=${refork})`,async()=>{
 const first=await source(),second=await capture.forkCaptureInput();await storage.db.settings.put({key:origin.captureInputConsumptionKey(first.key),value:{synthetic:'opaque-untrusted-marker'}});
 const input=refork?await capture.forkCaptureInput():second,before=await facts();await assert.rejects(candidate(input),/来源/);assert.deepEqual(await facts(),before);
});

test('known existing D: O sharing its input does not authorize recognition as O or rewrite D to a new ID',async()=>{
 const input=await source(),d=await candidate(input);await capture.saveCaptureDraft(d,true);
 await storage.db.settings.put({key:origin.captureInputConsumptionKey(input.key),value:{synthetic:'O-is-different'}});
 const next={...d,diary:'合成D明确同ID修正'};assert.equal(await capture.saveCaptureDraft(next,true,capture.captureFingerprint(d)),d.id);
 assert.deepEqual((await storage.db.settings.get(`capture-review:${d.id}`))?.value,next);assert.equal(await storage.db.quickNotes.count(),0);assert.equal(await storage.db.outbox.count(),0);
});

for(const bad of ['self-cycle','two-cycle','missing-parent','bad-format','wrong-owner','wrong-epoch','bad-snapshot'] as const)test(`origin ${bad}: bounded refusal preserves exact rows and pointers`,async()=>{
 const first=await source(),second=await capture.forkCaptureInput(),one=await originRow(first.key),two=await originRow(second.key);
 if(bad==='missing-parent')await storage.db.settings.delete(one.key);
 else if(bad==='self-cycle')await storage.db.settings.put({...two,value:{...two.value,parent:'input',sourceKey:second.key,input:{present:false},context:{present:false}}});
 else if(bad==='two-cycle')await storage.db.settings.put({...one,value:{...one.value,parent:'input',sourceKey:second.key,input:{present:false},context:{present:false}}});
 else if(bad==='bad-format')await storage.db.settings.put({...one,value:{...one.value,format:2}});
 else if(bad==='wrong-owner')await storage.db.settings.put({...one,value:{...one.value,ownerId:'other-synthetic-owner'}});
 else if(bad==='wrong-epoch')await storage.db.settings.put({...one,value:{...one.value,epoch:'SYNTHETIC_OTHER_EPOCH'}});
 else await storage.db.settings.put({...one,value:{...one.value,input:{present:false,row:{key:'not-absent',value:'text'}}}});
 const before=await facts();let gets=0;const get=storage.db.settings.get;storage.db.settings.get=function(...args:Parameters<typeof get>){gets++;return get.apply(this,args);} as typeof get;
 try{await assert.rejects(candidate(second),/来源/);}finally{storage.db.settings.get=get;}
 assert.ok(gets<=3*origin.CAPTURE_INPUT_ORIGIN_LIMIT+10);assert.deepEqual(await facts(),before);
});

test('origin depth: exact limit is accepted, limit+1 is refused without rewriting or shortening the chain',async()=>{
 let input=await source();for(let i=1;i<origin.CAPTURE_INPUT_ORIGIN_LIMIT;i++)input=await capture.forkCaptureInput();
 const draft=await candidate(input);await capture.saveCaptureDraft(draft);
 input=await capture.forkCaptureInput();const before=await facts();await assert.rejects(candidate(input),/来源/);assert.deepEqual(await facts(),before);
});

for(const payload of ['legacy nonempty','',undefined] as const)test(`unknown prior input ${String(payload)} is preserved, never promoted to empty root`,async()=>{
 const key='capture-input:legacy-unknown';sessionStorage.setItem('youtrace:input:synthetic-input-origin',key);await storage.db.settings.put({key,value:payload});
 const fork=await capture.forkCaptureInput(),proof=await originRow(fork.key);assert.equal(proof.value.parent,'unknown');assert.deepEqual(proof.value.input,{present:true,row:{key,value:payload}});
 const before=await facts();await assert.rejects(capture.createCaptureDraft('合成后续文字',fork,basis),/来源/);assert.deepEqual(await facts(),before);
});

test('fork quota at provenance insert rolls back child input/context and leaves session pointer exact',async()=>{
 const first=await source(),before=await facts(),pointer=sessionStorage.getItem('youtrace:input:synthetic-input-origin'),add=storage.db.settings.add;
 storage.db.settings.add=function(...args:Parameters<typeof add>){if(args[0].key.startsWith('capture-input-origin:'))return Promise.reject(new DOMException('SYNTHETIC_QUOTA','QuotaExceededError')) as ReturnType<typeof add>;return add.apply(this,args);} as typeof add;
 try{await assert.rejects(capture.forkCaptureInput(),/SYNTHETIC_QUOTA/);}finally{storage.db.settings.add=add;}
 assert.deepEqual(await facts(),before);assert.equal(sessionStorage.getItem('youtrace:input:synthetic-input-origin'),pointer);assert.equal(pointer,first.key);
});

test('first put final actor check rolls newly created review/current pointer rows back on same-owner generation replacement',async()=>{
 const input=await source(),draft=await candidate(input),before=await facts();const replace=(_key:unknown,row:{key?:string})=>{if(row.key===`capture-review:${draft.id}`)api.setSessionActive('synthetic-input-origin');};storage.db.settings.hook('creating',replace);
 try{await assert.rejects(capture.saveCaptureDraft(draft,true),/账号/);}finally{storage.db.settings.hook('creating').unsubscribe(replace);}assert.deepEqual(await facts(),before);
});

test('dangling pointer with all five source records absent creates a genuinely empty new root without inferring why they vanished',async()=>{
 const previous=await source();await storage.clearAllData({allowPending:true});assert.equal(sessionStorage.getItem('youtrace:input:synthetic-input-origin'),previous.key);
 const next=await capture.forkCaptureInput(),proof=await originRow(next.key);assert.equal(next.text,'');assert.equal(proof.value.parent,'root');assert.equal(proof.value.sourceKey,previous.key);assert.equal(proof.value.sourceMetadataPresent,false);assert.equal(proof.value.sourceConsumptionPresent,false);assert.deepEqual(proof.value.input,{present:false});assert.deepEqual(proof.value.context,{present:false});
 await capture.saveCaptureInput(next,'合成清除后的全新文字',next.context);const draft=await capture.createCaptureDraft('合成清除后的全新文字',next,next.context);await capture.saveCaptureDraft(draft);assert.equal(draft.context?.capturedAt,next.context.capturedAt);
});
for(const keyKind of ['input','context','metadata','consumption','head'] as const)for(const value of [undefined,null,''])test(`dangling pointer: present ${keyKind}/${String(value)} is never absence or a fresh-root proof`,async()=>{
 const sourceKey='capture-input:dangling';sessionStorage.setItem('youtrace:input:synthetic-input-origin',sourceKey);
 const key=keyKind==='input'?sourceKey:keyKind==='context'?sourceKey+':context':keyKind==='metadata'?origin.captureInputOriginKey(sourceKey):keyKind==='consumption'?origin.captureInputConsumptionKey(sourceKey):origin.captureInputConsumptionHeadKey(sourceKey);await storage.db.settings.put({key,value});
 const next=await capture.forkCaptureInput(),proof=await originRow(next.key);assert.notEqual(proof.value.parent,'root');const before=await facts();await assert.rejects(capture.createCaptureDraft('合成新输入仍需核对',next,next.context),/来源/);assert.deepEqual(await facts(),before);
});

for (const entry of ['create', 'first-put'] as const) test(`observed consumption survives marker removal and later forks: ${entry} refuses with all rows/pointers intact`, async () => {
 const first=await source(), ready=await candidate(first), marker=origin.captureInputConsumptionKey(first.key);
 await storage.db.settings.put({key:marker,value:{synthetic:'untrusted observed marker'}});
 const second=await capture.forkCaptureInput();assert.equal((await originRow(second.key)).value.sourceConsumptionPresent,true);
 await storage.db.settings.delete(marker);
 const next=entry==='first-put'?await capture.forkCaptureInput():second;
 const before=await facts(),pointers=(sessionStorage as unknown as ReturnType<typeof memory>).entries();
 // The public first-put service must enforce the boundary even if a caller bypasses create.
 await assert.rejects(entry==='create'?candidate(next):capture.saveCaptureDraft({...ready,inputKey:next.key},true),/来源/);
 assert.deepEqual(await facts(),before);assert.deepEqual((sessionStorage as unknown as ReturnType<typeof memory>).entries(),pointers);
});
