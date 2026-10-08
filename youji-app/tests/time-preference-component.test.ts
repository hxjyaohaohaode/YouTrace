import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as React from 'react';
import { act, createElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { TimeSettingInput } from '../src/components/settings/TimeSettingInput';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, React });
const deferred = <T,>() => { let resolve!: (value:T)=>void; const promise=new Promise<T>(done=>{resolve=done;}); return {promise,resolve}; };
const text = (tree:ReactTestRenderer) => JSON.stringify(tree.toJSON());
const button = (tree:ReactTestRenderer,label:string) => tree.root.findAllByType('button').find(node=>node.children.filter(child=>typeof child==='string').join('')===label)!;
const props = { id:'synthetic-time',label:'时间',value:'21:00',onSave:async()=>{throw new DOMException('Synthetic postcommit read','AbortError');},onVerify:async()=> '22:00' };
async function draftAndFail(tree:ReactTestRenderer) {
 await act(async()=>{tree.root.findByType('input').props.onChange({target:{value:'22:00'}});});
 await act(async()=>{button(tree,'保存时间').props.onClick();});
 assert.equal(button(tree,'保存时间').props.disabled,true);
 assert.match(text(tree),/保存结果暂时无法核对/);
}

test('Mounted editor shows a truthful current snapshot and removes obsolete error without another Save',async()=>{
 let writes=0;let tree!:ReactTestRenderer;
 await act(async()=>{tree=create(createElement(TimeSettingInput,{...props,onSave:async()=>{writes++;throw new Error('Unknown');}}));});
 await draftAndFail(tree);
 await act(async()=>{button(tree,'重新读取当前时间').props.onClick();});
 assert.equal(tree.root.findByType('input').props.value,'22:00');
 assert.match(text(tree),/已核对本机当前时间/);assert.doesNotMatch(text(tree),/保存结果暂时无法核对/);
 assert.equal(writes,1);assert.equal(button(tree,'保存时间'),undefined);
 await act(async()=>{tree.update(createElement(TimeSettingInput,{...props,value:'22:30'}));});
 assert.equal(tree.root.findByType('input').props.value,'22:30');
 assert.doesNotMatch(text(tree),/已核对本机当前时间/, 'A newer publication also clears the older snapshot explanation');
 await act(async()=>tree.unmount());
});

test('Mounted editor rejects a delayed verification after a newer same-owner prop publication',async()=>{
 const read=deferred<string>();let tree!:ReactTestRenderer;
 const input={...props,onVerify:()=>read.promise};
 await act(async()=>{tree=create(createElement(TimeSettingInput,input));});await draftAndFail(tree);
 await act(async()=>{button(tree,'重新读取当前时间').props.onClick();});
 await act(async()=>{tree.update(createElement(TimeSettingInput,{...input,value:'22:30'}));});
 await act(async()=>{read.resolve('22:00');});
 assert.equal(tree.root.findByType('input').props.value,'22:00','Original unsaved input is retained, not replaced');
 assert.match(text(tree),/核对期间当前时间又有更新/);
 assert.equal(button(tree,'保存时间').props.disabled,true);
 assert.doesNotMatch(text(tree),/已核对本机当前时间/);
 await act(async()=>tree.unmount());
});

test('Mounted editor preserves a newer input typed during readonly verification and requires another read',async()=>{
 const read=deferred<string>();let tree!:ReactTestRenderer;
 await act(async()=>{tree=create(createElement(TimeSettingInput,{...props,onVerify:()=>read.promise}));});await draftAndFail(tree);
 await act(async()=>{button(tree,'重新读取当前时间').props.onClick();});
 await act(async()=>{tree.root.findByType('input').props.onChange({target:{value:'22:45'}});});
 await act(async()=>{read.resolve('22:00');});
 assert.equal(tree.root.findByType('input').props.value,'22:45');
 assert.equal(button(tree,'保存时间').props.disabled,true);assert.match(text(tree),/核对期间你又编辑了输入/);
 await act(async()=>tree.unmount());
});

test('Confirmed quota refusal retains direct retry and normal success clears the draft',async()=>{
 let writes=0;let tree!:ReactTestRenderer;
 await act(async()=>{tree=create(createElement(TimeSettingInput,{...props,onSave:async()=>{if(++writes===1)throw new DOMException('Full','QuotaExceededError');}}));});
 await act(async()=>{tree.root.findByType('input').props.onChange({target:{value:'22:00'}});});
 await act(async()=>{button(tree,'保存时间').props.onClick();});
 assert.equal(button(tree,'保存时间').props.disabled,false);assert.match(text(tree),/空间不足/);
 await act(async()=>{button(tree,'保存时间').props.onClick();});
 assert.equal(writes,2);assert.match(text(tree),/时间已保存在本机/);
 await act(async()=>tree.unmount());
});
