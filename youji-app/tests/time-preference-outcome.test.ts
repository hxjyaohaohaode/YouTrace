import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { needsTimePreferenceVerification, reconcileTimePreferenceRead, PreferenceDisplayReadError } from '../src/lib/timePreferenceOutcome';
const memory = () => { const data = new Map<string,string>(); return { getItem:(key:string)=>data.get(key)??null, setItem:(key:string,value:string)=>data.set(key,value), removeItem:(key:string)=>data.delete(key) }; };
Object.assign(globalThis,{localStorage:memory(),sessionStorage:memory(),window:Object.assign(new EventTarget(),{location:{replace(){}}})});
const storage = await import('../src/db/index.ts');
const api = await import('../src/services/apiClient.ts');
const { readPreferenceTime } = await import('../src/services/readPreferenceTime');
const owner = 'synthetic-time-verification';
before(async()=>{await storage.bindAccountDatabase(owner);});
beforeEach(async()=>{api.setSessionActive(owner); await storage.db.settings.clear(); await storage.db.settings.bulkPut([{key:'eveningReviewTime',value:'22:00'},{key:'quietHours',value:{enabled:true,start:'23:00',end:'07:00'}},{key:'pendingSetting:accountPreferences',value:{count:1}}]);});
after(()=>{api.clearSession();storage.db.close();});

test('Unknown save outcome cannot offer direct resubmission; definite quota refusal remains distinct',()=>{
 assert.equal(needsTimePreferenceVerification(new DOMException('Display read failed','AbortError')),true);
 assert.equal(needsTimePreferenceVerification(new Error('Unknown failure')),true);
 assert.equal(needsTimePreferenceVerification(null),true);
 assert.equal(needsTimePreferenceVerification(new DOMException('Storage full','QuotaExceededError')),false);
 assert.equal(needsTimePreferenceVerification(new PreferenceDisplayReadError(new DOMException('QuotaExceededError after write','QuotaExceededError'))),true, 'A post-write read failure never offers direct resubmission even if its cause mentions quota');
});
test('Readonly verification reads actual persisted time without consuming pending intent or writing anything',async()=>{
 const before=await storage.db.settings.toArray();
 assert.equal(await readPreferenceTime('eveningReviewTime'),'22:00');
 assert.equal(await readPreferenceTime('quietStart'),'23:00');
 assert.equal(await readPreferenceTime('quietEnd'),'07:00');
 assert.deepEqual(await storage.db.settings.toArray(),before);
});
test('A missing or malformed current value never becomes an invented successful default',async()=>{
 await storage.db.settings.delete('eveningReviewTime'); await assert.rejects(readPreferenceTime('eveningReviewTime'),/尚未读到/);
 await storage.db.settings.put({key:'eveningReviewTime',value:'25:77'}); await assert.rejects(readPreferenceTime('eveningReviewTime'),/尚未读到/);
});
test('A revoked owner cannot read preference recovery results',async()=>{
 api.clearSession(); await assert.rejects(readPreferenceTime('eveningReviewTime'),/账号/);
});
test('A session change during the readonly boundary invalidates the result',async()=>{
 let hit=false;
 const changed=(row: unknown)=>{if(!hit){hit=true;api.clearSession();}return row;};
 storage.db.settings.hook('reading',changed);
 try{await assert.rejects(readPreferenceTime('eveningReviewTime'),/账号/);assert.equal(hit,true);}finally{storage.db.settings.hook('reading').unsubscribe(changed);}
});
test('A matched current value closes only the same draft, without attributing it to an earlier mutation',()=>{
 const draft={value:'22:00',baseline:'21:30',revision:1};
 assert.deepEqual(reconcileTimePreferenceRead(draft,draft,'22:00'),{draft:null,needsVerification:false});
 const different={...draft,value:'22:15'};
 assert.deepEqual(reconcileTimePreferenceRead(different,different,'22:00'),{draft:{...different,baseline:'22:00'},needsVerification:false});
});
test('A newer edit during verification is never cleared or rebased by the older read',()=>{
 const started={value:'22:00',baseline:'21:30',revision:1};
 const newer={value:'22:15',baseline:'21:30',revision:2};
 assert.deepEqual(reconcileTimePreferenceRead(started,newer,'22:15'),{draft:newer,needsVerification:true});
});
