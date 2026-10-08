import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { before, beforeEach, after, test } from 'node:test';
import { PreferenceDisplayReadError, timePreferenceFailureKind } from '../src/lib/timePreferenceOutcome';
const memory=()=>{const data=new Map<string,string>();return {getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>data.set(key,value),removeItem:(key:string)=>data.delete(key)};};
Object.assign(globalThis,{localStorage:memory(),sessionStorage:memory(),window:Object.assign(new EventTarget(),{matchMedia:()=>({matches:false,addEventListener(){}}),location:{replace(){}}}),document:{documentElement:{setAttribute(){}}}});
const storage=await import('../src/db/index');
const api=await import('../src/services/apiClient');
const {useSettingsStore,stopPreferenceSync,PREFERENCE_STATE_KEY}=await import('../src/stores/settingsStore');
const {readPreferenceTime}=await import('../src/services/readPreferenceTime');
const owner='synthetic-postcommit-boundary';
let networkCalls=0;
before(async()=>{await storage.bindAccountDatabase(owner);globalThis.fetch=async()=>{networkCalls++;throw new Error('No network permitted in store-boundary test');};});
beforeEach(async()=>{stopPreferenceSync();api.setSessionActive(owner);networkCalls=0;await storage.db.settings.clear();await storage.db.settings.bulkPut([{key:'eveningReviewTime',value:'21:00'},{key:'quietHours',value:{enabled:true,start:'23:00',end:'07:00'}},{key:'theme',value:'system'}]);});
after(()=>{stopPreferenceSync();api.clearSession();storage.db.close();});

for(const name of ['QuotaExceededError','AbortError']) test(`Actual local transaction ${name} rolls back and is never labeled committed`,async()=>{
 const before=await storage.db.settings.toArray();
 const failure=new DOMException('Synthetic native target put refusal',name);
 const refuse=(_mods:unknown,key:unknown)=>{if(key==='eveningReviewTime')throw failure;};
 storage.db.settings.hook('updating',refuse);
 try{await assert.rejects(useSettingsStore.getState().updateSetting('eveningReviewTime','22:00','21:00'),cause=>{assert.equal(cause instanceof PreferenceDisplayReadError,false);assert.equal(timePreferenceFailureKind(cause),name==='QuotaExceededError'?'precommit-refusal':'unknown');return true;});}
 finally{storage.db.settings.hook('updating').unsubscribe(refuse);}
 assert.deepEqual(await storage.db.settings.toArray(),before);assert.equal(networkCalls,0);
});

for(const key of ['eveningReviewTime','quietStart'] as const) test(`Actual ${key} transaction commits before display-read marker; readonly recovery preserves all persisted bytes`,async()=>{
 let targetWrites=0, readFaults=0;
 const target=key==='eveningReviewTime'?'eveningReviewTime':'quietHours';
 const countWrite=(_mods:unknown,primaryKey:unknown)=>{if(primaryKey===target)targetWrites++;};
 const abortTheme=(row:unknown)=>{if((row as {key?:string}|undefined)?.key==='theme'){readFaults++;throw new DOMException('Quota-named display read after commit','QuotaExceededError');}return row;};
 storage.db.settings.hook('updating',countWrite);storage.db.settings.hook('reading',abortTheme);
 try {
  const update=key==='eveningReviewTime'?useSettingsStore.getState().updateSetting('eveningReviewTime','22:00','21:00'):useSettingsStore.getState().updateQuietHours({start:'22:00'},{start:'23:00'});
  await assert.rejects(update,cause=>{assert.ok(cause instanceof PreferenceDisplayReadError);assert.equal(timePreferenceFailureKind(cause),'committed-display-read');return true;});
 }finally{storage.db.settings.hook('reading').unsubscribe(abortTheme);}
 try {
  assert.equal(targetWrites,1);assert.equal(readFaults,1);assert.equal(await readPreferenceTime(key),'22:00');
  assert.ok(await storage.db.settings.get(PREFERENCE_STATE_KEY));
  const afterCommit=await storage.db.settings.toArray();
  assert.equal(await readPreferenceTime(key),'22:00');assert.equal(await readPreferenceTime(key),'22:00');
  assert.equal(targetWrites,1);assert.deepEqual(await storage.db.settings.toArray(),afterCommit);assert.equal(networkCalls,0);
 }finally{storage.db.settings.hook('updating').unsubscribe(countWrite);}
});
