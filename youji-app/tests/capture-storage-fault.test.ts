import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { randomInt } from 'node:crypto';
import { after, beforeEach, test } from 'node:test';
const memory = () => { const v = new Map<string,string>(); return { getItem:(k:string)=>v.get(k)??null, setItem:(k:string,x:string)=>v.set(k,x), removeItem:(k:string)=>v.delete(k), clear:()=>v.clear() }; };
Object.assign(globalThis,{localStorage:memory(),sessionStorage:memory(),window:Object.assign(new EventTarget(),{matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}}),location:{replace(){}}}),document:{documentElement:{setAttribute(){}}}});
const storage=await import('../src/db/index.ts'),api=await import('../src/services/apiClient.ts'),sync=await import('../src/services/syncEngine.ts'),capture=await import('../src/services/quickNoteIntegration.ts');
beforeEach(async()=>{sync.pauseSync();api.clearSession();localStorage.clear();sessionStorage.clear();await storage.bindAccountDatabase('synthetic-storage-fault');api.setSessionActive('synthetic-storage-fault');await storage.clearAllData({allowPending:true});sync.pauseSync();});
after(()=>{sync.pauseSync();storage.db.close();});
import { installCaptureStorageFault, collectCaptureStorageFailure } from '../scripts/audit-capture-storage-fault.mjs';
const fault = () => (globalThis as unknown as { __captureStorageFault: { snapshot(): { hits: { method: string; key: string }[]; dropped: number }; release(): { restored: boolean } } }).__captureStorageFault;
async function facts(){return storage.db.transaction('r',storage.db.tables,async()=>Object.fromEntries(await Promise.all(storage.db.tables.map(async t=>[t.name,{keys:await t.toCollection().primaryKeys(),values:await t.toArray()}]))));}
test('initialization fault rejects actual fork add atomically; exact native descriptors restore and original can save',async()=>{
 const before=await facts(),add=Object.getOwnPropertyDescriptor(IDBObjectStore.prototype,'add'),put=Object.getOwnPropertyDescriptor(IDBObjectStore.prototype,'put');
 installCaptureStorageFault(storage.db.name);
 try{await assert.rejects(capture.forkCaptureInput(),/Synthetic quota/);assert.deepEqual(await facts(),before);assert.ok(fault().snapshot().hits.some(row=>row.method==='add'));assert.equal(fault().snapshot().dropped,0);}finally{assert.equal(fault().release().restored,true);}
 assert.deepEqual(Object.getOwnPropertyDescriptor(IDBObjectStore.prototype,'add'),add);assert.deepEqual(Object.getOwnPropertyDescriptor(IDBObjectStore.prototype,'put'),put);
 const input=await capture.forkCaptureInput();await capture.saveCaptureInput(input,'  合成完整原文  ',input.context);assert.equal((await storage.db.settings.get(input.key))?.value,'  合成完整原文  ');
});
test('put autosave is also precisely faulted without changing existing source; settings/origin/reviews and other owners are excluded',async()=>{
 const input=await capture.forkCaptureInput();await capture.saveCaptureInput(input,'original',input.context);const before=await facts();installCaptureStorageFault(storage.db.name);
 try{await assert.rejects(capture.saveCaptureInput(input,'new',input.context),/Synthetic quota/);assert.deepEqual(await facts(),before);assert.ok(fault().snapshot().hits.some(row=>row.method==='put'));
 await storage.db.settings.put({key:'other-key',value:'unrelated'});await storage.db.settings.put({key:'capture-review:unrelated',value:'unrelated'});await storage.db.settings.put({key:'capture-input-origin:unrelated',value:'unrelated'});
 const foreign=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open(`youtrace:user:synthetic-other-owner:schedule-v1`);request.onupgradeneeded=()=>request.result.createObjectStore('settings',{keyPath:'key'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
 try{await new Promise<void>((resolve,reject)=>{const tx=foreign.transaction('settings','readwrite');tx.objectStore('settings').put({key:input.key,value:'foreign untouched by fault'});tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});}finally{foreign.close();}
 }finally{fault().release();}
});
test('invalid owner or duplicate install does not replace the active native descriptors',()=>{
 assert.throws(()=>installCaptureStorageFault('foreign'),/Invalid/);installCaptureStorageFault(storage.db.name);const add=IDBObjectStore.prototype.add;try{assert.throws(()=>installCaptureStorageFault(storage.db.name),/Invalid/);assert.equal(IDBObjectStore.prototype.add,add);}finally{fault().release();}
});
test('first evidence failure does not skip later fault/source/editor/screenshot collectors or change original error',async()=>{
 const original=new Error('original synthetic failure'),seen:string[]=[];const failures=await collectCaptureStorageFailure({firstError:()=>{seen.push('first');throw Error('disk');},fault:()=>{seen.push('fault');},source:()=>{seen.push('source');throw Error('read');},editor:()=>{seen.push('editor');},screenshot:()=>{seen.push('image');}},original);assert.deepEqual(seen,['first','fault','source','editor','image']);assert.deepEqual(failures.map((x:{part:string})=>x.part),['firstError','source']);assert.equal(original.message,'original synthetic failure');
});


test('actual native recovery orchestration restores fault after first receipt write failure and keeps original exception',async()=>{
 const source=readFileSync(new URL('../scripts/audit-user-outcomes.mjs',import.meta.url),'utf8'),body=source.slice(source.indexOf('async function recoverStorage(page) {'),source.indexOf('\n}\n\ntry {',source.indexOf('async function recoverStorage(page) {'))+2);
 const first=new Error('first installed receipt disk failure'),order:string[]=[];
 const sandbox={runtimeRecordPhone:()=> 'SYNTHETIC',login:async()=>{},apiFor:async()=>({ownerId:'synthetic'}),writeFile:async(path:string)=>{order.push(path);if(path.endsWith('installed.json'))throw first;},join:(...x:string[])=>x.join('/'),artifacts:'evidence',readExistingAccount:()=>{},installCaptureStorageFault,collectCaptureStorageFailure,actions:[],assert,capture:async()=>{order.push('screenshot');}};
 const run=runInNewContext(body+'; recoverStorage',sandbox);
 const page={evaluate:async(fn:()=>unknown)=>{const text=String(fn);if(text.includes('.release()')){order.push('release');return {restored:true,dropped:0};}if(text.includes('.snapshot()')){order.push('snapshot');return {};}return {};},$eval:async()=>({value:'preserved',disabled:false})};
 await assert.rejects(run(page),(e:unknown)=>e===first);assert.ok(order.includes('screenshot'));assert.ok(order.some(x=>x.endsWith('failure-source.json')));assert.ok(order.indexOf('release')>order.indexOf('screenshot'));assert.ok(order.some(x=>x.endsWith('released.json')));
});
test('changed native record identities are generated at runtime while authentication remains the original test-only protocol',()=>{
 const source=readFileSync(new URL('../scripts/audit-user-outcomes.mjs',import.meta.url),'utf8');assert.doesNotMatch(source,/139\d{8}/);
 const code=source.match(/const runtimeRecordPhoneBase =[^;]+;\nconst runtimeRecordPhone =[^;]+;/)?.[0];assert.ok(code);
 const phone=runInNewContext(code+'; runtimeRecordPhone',{randomInt});const all=Array.from({length:6},(_,i)=>phone(i+1));assert.equal(new Set(all).size,6);for(const value of all)assert.match(value,/^139\d{8}$/);
 assert.match(source,/NODE_ENV: 'test'/);assert.match(source,/DEV_OTP_EXPOSE: 'true'/);assert.match(source,/SMS_PROVIDER_URL: ''/);assert.match(source,/SMS_PROVIDER_TOKEN: ''/);
});
