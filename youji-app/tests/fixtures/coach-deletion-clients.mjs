// Synthetic roundtrip regression: two separate client processes, no browser or external provider.
// Real TCP/Hono/Prisma + two child processes with independent fake IndexedDB.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fork } from 'node:child_process';
import { once } from 'node:events';
const root = resolve(process.argv[2]);
const appDir = join(root, 'youji-app');
const appRequire = createRequire(join(appDir, 'package.json'));
const serverRequire = createRequire(join(appDir, 'server/package.json'));
const load = (p) => import(pathToFileURL(join(root, p)).href);
const owner = 'synthetic-coach-deletion-owner';
const victim = 'synthetic-push-deleted';
const retained = 'synthetic-push-paged-out-still-live';
if (process.argv[3] === 'client') {
  await import(appRequire.resolve('fake-indexeddb/auto'));
  const memory = () => { const m = new Map(); return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)}; };
  Object.assign(globalThis, { localStorage:memory(),sessionStorage:memory(),window:Object.assign(new EventTarget(),{matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}}),location:{replace(){}}}),document:{documentElement:{setAttribute(){}}} });
  const storage = await load('youji-app/src/db/index.ts');
  const {useCoachStore} = await load('youji-app/src/stores/coachStore.ts');
  const session = await load('youji-app/src/services/apiClient.ts');
  const {pauseSync} = await load('youji-app/src/services/syncEngine.ts');
  const native = globalThis.fetch;
  let base='',cookie='', loseDeleteAck=false;
  globalThis.fetch=async(path,init={})=>{
    const url=new URL(String(path),base);assert.equal(url.origin,base);assert.equal(url.hostname,'127.0.0.1');
    const headers=new Headers(init.headers);headers.set('Cookie',cookie);headers.set('Origin','http://coach-repro.invalid');
    const response=await native(url,{...init,headers,redirect:'error'});
    if(loseDeleteAck && init.method==='DELETE' && response.ok){loseDeleteAck=false;await response.arrayBuffer();throw new Error('Synthetic lost DELETE acknowledgment');}
    return response;
  };
  process.on('message', async ({id,command,args={}})=>{
    try {
      if(command==='init'){base=args.base;cookie=args.cookie;await storage.bindAccountDatabase(owner);session.setSessionActive(owner);}
      if(command==='load'){if(args.reset)useCoachStore.setState({pushes:[],insights:[],loaded:false});await useCoachStore.getState().loadFromDB();}
      if(command==='local') await useCoachStore.getState().addPush({type:'follow_up',title:'Synthetic local-only',body:'Synthetic local-only body',actions:[],read:false,acted:false});
      if(command==='dismissLost'){loseDeleteAck=true;await useCoachStore.getState().dismissPush(args.id);}
      if(command==='dismiss')await useCoachStore.getState().dismissPush(args.id);
      const result={visible:useCoachStore.getState().pushes.map(p=>p.id),cached:(await storage.db.coachPushes.toArray()).map(p=>({id:p.id,origin:p.origin})),dismissed:!!await storage.db.settings.get(`coachPushDismissed:${victim}`)};
      process.send({id,result});
      if(command==='stop'){pauseSync();session.clearSession();storage.db.close();process.disconnect();}
    }catch(e){process.send({id,error:e.stack});}
  });
  process.send({ready:true});
} else if (process.argv[3] === 'server') {
  const {prisma}=await load('youji-app/server/src/utils/db.ts');
  const {app}=await load('youji-app/server/src/app.ts');
  const {issueSession}=await load('youji-app/server/src/utils/session.ts');
  const {Hono}=await import(serverRequire.resolve('hono'));
  const {serve}=await import(serverRequire.resolve('@hono/node-server'));
  const fixture=new Hono();
  fixture.get('/__fixture/session',async(c)=>{issueSession(c,await prisma.user.findUniqueOrThrow({where:{id:owner}}));return c.text('ok')});
  fixture.get('/__fixture/other',async(c)=>{issueSession(c,await prisma.user.findUniqueOrThrow({where:{id:'synthetic-other-owner'}}));return c.text('ok')});
  fixture.route('/',app);
  const server=serve({fetch:fixture.fetch,hostname:'127.0.0.1',port:0});await once(server,'listening');
  // Any provider request from application code is forbidden in this fixture.
  globalThis.fetch=async()=>{throw new Error('No provider calls allowed')};
  process.send({base:'http://127.0.0.1:'+server.address().port});
  process.on('message',async(message)=>{if(message==='stop'){await new Promise((res,rej)=>server.close(e=>e?rej(e):res()));await prisma.$disconnect();process.disconnect();}});
} else {
  const {DatabaseSync}=await import('node:sqlite');
  const scratch=await mkdtemp(join(tmpdir(),'youtrace-coach-repro-'));
  Object.assign(process.env,{NODE_ENV:'test',DATABASE_URL:'file:'+join(scratch,'synthetic.sqlite3'),JWT_SECRET:'synthetic-coach-repro-secret-at-least-32-chars',ALLOWED_ORIGINS:'http://coach-repro.invalid',DEV_OTP_EXPOSE:'false',SERVER_AI_ENABLED:'false',LLM_API_KEY:''});
  const sqlite=new DatabaseSync(join(scratch,'synthetic.sqlite3'),{enableDoubleQuotedStringLiterals:true});
  for(const dir of (await readdir(join(appDir,'server/prisma/migrations'))).filter(n=>/^\d/.test(n)).sort())sqlite.exec(await readFile(join(appDir,'server/prisma/migrations',dir,'migration.sql'),'utf8'));
  sqlite.close();
  const {prisma}=await load('youji-app/server/src/utils/db.ts');
  await prisma.user.create({data:{id:owner,phone:'synthetic-coach-001',nickname:'Synthetic'}});
  const other=await prisma.user.create({data:{id:'synthetic-other-owner',phone:'synthetic-coach-002',nickname:'Synthetic other'}});
  for(const id of [victim,retained])await prisma.push.create({data:{id,userId:owner,type:'follow_up',title:'Synthetic '+id,body:'Synthetic body',createdAt:new Date('2026-07-31T00:00:00Z')}});
  const native=globalThis.fetch;let base='',backend;
  const startBackend=async()=>{
    backend=fork(new URL(import.meta.url),[root,'server'],{execArgv:['--import',appRequire.resolve('tsx')],stdio:['ignore','inherit','inherit','ipc']});
    base=await new Promise((res,rej)=>{backend.once('error',rej);backend.once('message',m=>res(m.base))});
  };
  const stopBackend=async()=>{if(backend?.connected){const done=once(backend,'exit');backend.send('stop');const [code]=await done;assert.equal(code,0,'backend must stop cleanly');}};
  await startBackend();
  globalThis.fetch=async(input,init={})=>{const url=new URL(input);assert.equal(url.origin,base,'no provider calls');return native(input,init)};
  const cookie=async(path)=>(await fetch(base+path)).headers.get('set-cookie').split(';')[0];
  let serial=0;const children=[];
  const client=async()=>{
    const child=fork(new URL(import.meta.url),[root,'client'],{execArgv:['--import',appRequire.resolve('tsx')],stdio:['ignore','inherit','inherit','ipc']});children.push(child);
    await new Promise((res,rej)=>{child.once('error',rej);child.on('message',m=>{if(m.ready)res()})});
    return(command,args={})=>new Promise((res,rej)=>{const id=++serial;const timer=setTimeout(()=>rej(new Error('client timeout')),15000);const onMessage=m=>{if(m.id!==id)return;clearTimeout(timer);child.off('message',onMessage);m.error?rej(new Error(m.error)):res(m.result)};child.on('message',onMessage);child.send({id,command,args})});
  };
  try{
    const a=await client(),b=await client();await a('init',{base,cookie:await cookie('/__fixture/session')});await b('init',{base,cookie:await cookie('/__fixture/session')});
    const initialA=await a('load'),initialB=await b('load');assert.ok(initialA.visible.includes(victim)&&initialB.visible.includes(victim));
    await b('local');
    const otherCookie=await cookie('/__fixture/other');const denied=await fetch(base+'/api/coach/pushes/'+victim,{method:'DELETE',headers:{Cookie:otherCookie,Origin:'http://coach-repro.invalid','X-YouTrace-Account':other.id}});assert.equal(denied.status,404);assert.equal(await prisma.push.count({where:{id:victim}}),1);
    await prisma.push.createMany({data:Array.from({length:55},(_,i)=>({id:'synthetic-newer-'+i,userId:owner,type:'follow_up',title:'Synthetic newer',body:'Synthetic newer body',createdAt:new Date(Date.parse('2026-08-01T00:00:00Z')+i*1000)}))});
    await assert.rejects(a('dismissLost',{id:victim}), /Synthetic lost DELETE acknowledgment/);
    assert.equal(await prisma.push.count({where:{id:victim}}),0);
    await prisma.push.create({data:{id:'synthetic-concurrent-new',userId:owner,type:'follow_up',title:'Synthetic newly created',body:'Synthetic new body'}});
    const afterA=await a('dismiss',{id:victim});assert.ok(!afterA.visible.includes(victim));assert.ok(afterA.dismissed);assert.equal(await prisma.push.count({where:{id:victim}}),0);
    const reloaded=await b('load',{reset:true});assert.ok(!reloaded.visible.includes(victim),'device B honors the durable deletion');assert.ok(reloaded.visible.includes(retained),'paged-out live record must stay');assert.ok(reloaded.cached.some(p=>p.origin==='local'),'local reminder preserved');assert.equal(reloaded.dismissed,true);assert.ok(reloaded.visible.includes('synthetic-concurrent-new'));
    const latest=await (await fetch(base+'/api/coach/pushes',{headers:{Cookie:await cookie('/__fixture/session'),'X-YouTrace-Account':owner}})).json();assert.equal(latest.pushes.length,50);assert.ok(!latest.pushes.some(p=>p.id===retained));assert.equal(await prisma.push.count({where:{id:retained,userId:owner}}),1);
    await stopBackend();await startBackend();
    await a('init',{base,cookie:await cookie('/__fixture/session')});await b('init',{base,cookie:await cookie('/__fixture/session')});
    const restarted=await b('load',{reset:true});assert.ok(!restarted.visible.includes(victim));assert.ok(restarted.visible.includes(retained));assert.ok(restarted.visible.includes('synthetic-concurrent-new'));assert.equal(restarted.dismissed,true);
    assert.equal(await prisma.syncTombstone.count({where:{userId:owner,entity:'coachPushes',entityId:victim}}),1);
    console.log(JSON.stringify({status:'PASS',transport:'real ephemeral TCP HTTP',clients:'two separate Node processes with independent fake IndexedDB',server_restart:'separate API process stopped and restarted with same SQLite',lost_delete_ack:'real commit then synthetic response loss; repeated delete succeeds',device_b_visible_deleted:false,latest_page:latest.pushes.length,paged_out_live_retained:true,local_only_retained:true,new_reminder_retained:true,cross_owner_delete_status:denied.status}));
    await a('stop');await b('stop');
  }finally{for(const child of children)if(child.connected)child.kill();globalThis.fetch=native;await stopBackend();await prisma.$disconnect();await rm(scratch,{recursive:true,force:true});}
}
