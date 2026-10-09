import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import * as React from 'react';
import { act, createElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import ts from 'typescript';
import * as actualDate from '../src/utils/date';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const require=createRequire(import.meta.url);
const host=(tag:string)=>({children,...props}:React.HTMLAttributes<HTMLElement>)=>createElement(tag,props,children);
function compile(source:string,mocks:Record<string,unknown>,globals:Record<string,unknown>={}) {
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports:Record<string,React.ComponentType>={};
 runInNewContext(code,{exports,require:(name:string)=>name.endsWith('.css')?{}:mocks[name]??require(name),structuredClone,...globals});return exports;
}
const buttonText=(tree:ReactTestRenderer,label:string)=>tree.root.findAllByType('button').find(node=>node.children.filter(child=>typeof child==='string').join('')===label);
test('Actual onboarding keeps four native steps and the established final Start action',async()=>{
 const navigations:unknown[]=[],writes:unknown[]=[];
 const source=readFileSync(process.env.YOUTRACE_ONBOARDING_SOURCE??new URL('../src/pages/Onboarding.tsx',import.meta.url),'utf8');
 const Page=compile(source,{'react-router-dom':{useNavigate:()=> (...args:unknown[])=>navigations.push(structuredClone(args))},'../components/ui/Button':{Button:host('button')},'../components/ui/Brand':{Brand:()=>createElement('span',{},'Original artwork protected separately')}},{localStorage:{setItem:(...args:unknown[])=>writes.push(args)}}).default;
 let tree!:ReactTestRenderer;await act(async()=>{tree=create(createElement(Page));});
 try {
  for(let step=0;step<3;step++){assert.ok(buttonText(tree,'下一步'));assert.equal(navigations.length,0);await act(async()=>buttonText(tree,'下一步')!.props.onClick());}
  assert.equal(buttonText(tree,'下一步'),undefined);assert.ok(buttonText(tree,'开始使用'),'Established final onboarding action must remain discoverable');
  await act(async()=>buttonText(tree,'开始使用')!.props.onClick());
  assert.deepEqual(writes,[['youji_onboarded','true']]);assert.deepEqual(navigations,[['/',{replace:true}]]);
 }finally{await act(async()=>tree.unmount());}
});

test('Actual rebuilt agenda exposes a native button with the unchanged exact accessible name and record',async()=>{
 const record={id:'synthetic-schedule',virtualId:'synthetic-schedule',title:'Synthetic schedule original',date:'2026-10-08',occurrenceDate:'2026-10-08',startTime:'09:00',endTime:'10:30',type:'work',location:'Synthetic room A',repeat:'none'};
 const occurrence={...record,source:{...record}};
 const state={items:[occurrence],loaded:true,selectedDate:'2026-10-08',setSelectedDate(){}};
 const edited:unknown[]=[];
 const source=readFileSync(new URL('../src/components/schedule/ScheduleContent.tsx',import.meta.url),'utf8');
 const Page=compile(source,{'../../utils/date':actualDate,'framer-motion':{motion:{button:host('button'),div:host('div')}},'../../stores/scheduleStore':{useScheduleStore:(select:(value:typeof state)=>unknown)=>select(state),expandRecurringForRange:()=>[occurrence]},'../ui/Card':{Card:host('div')},'./ScheduleEditor':{ScheduleEditor:({item}:{item:unknown})=>{edited.push(item);return createElement('div',{'data-editor':'open'});}}}).ScheduleContent;
 let tree!:ReactTestRenderer;await act(async()=>{tree=create(createElement(Page));});
 try{
  const controls=tree.root.findAllByType('button').filter(node=>node.props['aria-label']==='09:00-10:30 Synthetic schedule original');
  assert.equal(controls.length,1);assert.equal(controls[0].props.role,undefined,'Native button already provides implicit button semantics');
  await act(async()=>controls[0].props.onClick());assert.deepEqual(edited.at(-1),occurrence);
 }finally{await act(async()=>tree.unmount());}
});

test('Native schedule audit locators accept implicit or explicit button roles without dropping exact names',()=>{
 for(const file of ['e2e-recovery.mjs','audit-planning-outcomes.mjs']){
  const source=readFileSync(new URL(`../scripts/${file}`,import.meta.url),'utf8');
  assert.match(source,/:is\(button:not\(\[role\]\),\[role=button\]\)\[aria-label=/);
  assert.doesNotMatch(source,/(?<!\))\[role=button\]\[aria-label=/);
 }
});
