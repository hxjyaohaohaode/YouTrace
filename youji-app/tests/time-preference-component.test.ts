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

test('Known postcommit display failure shows the completed write separately and never repeats Save during recovery', async()=>{
 const { PreferenceDisplayReadError }=await import('../src/lib/timePreferenceOutcome');
 let writes=0, reads=0, failRead=true;let tree!:ReactTestRenderer;
 const input={...props,onSave:async()=>{writes++;throw new PreferenceDisplayReadError(new DOMException('Synthetic display quota','QuotaExceededError'));},onVerify:async()=>{reads++;if(failRead)throw new Error('Still cannot read');return '22:00';}};
 await act(async()=>{tree=create(createElement(TimeSettingInput,input));});
 await act(async()=>{tree.root.findByType('input').props.onChange({target:{value:'22:00'}});});
 const oldSave=button(tree,'保存时间').props.onClick;
 await act(async()=>{oldSave();oldSave();});
 await act(async()=>{oldSave();});
 assert.equal(writes,1);assert.match(text(tree),/本次本机写入已完成/);assert.match(text(tree),/22:00/);assert.match(text(tree),/显示读取失败/);
 assert.doesNotMatch(text(tree),/保存结果暂时无法核对|空间不足/);
 assert.equal(button(tree,'保存时间').props.disabled,true);
 await act(async()=>{tree.root.findByType('input').props.onKeyDown({key:'Enter',preventDefault(){}});});
 assert.equal(writes,1);
 await act(async()=>{button(tree,'重新读取当前时间').props.onClick();});
 assert.equal(reads,1);assert.equal(writes,1);assert.match(text(tree),/本次本机写入已完成/);assert.match(text(tree),/仍无法读取/);
 await act(async()=>{tree.root.findByType('input').props.onChange({target:{value:'22:45'}});});
 assert.match(text(tree),/本次本机写入已完成/);assert.equal(button(tree,'保存时间').props.disabled,true);
 failRead=false;
 await act(async()=>{button(tree,'重新读取当前时间').props.onClick();});
 assert.equal(reads,2);assert.equal(writes,1);assert.equal(tree.root.findByType('input').props.value,'22:45');
 assert.match(text(tree),/已核对本机当前时间：22:00/);assert.match(text(tree),/你的不同输入仍保留，尚未保存/);
 assert.equal(button(tree,'保存时间').props.disabled,false);
 assert.doesNotMatch(text(tree),/本次本机写入已完成|仍无法读取/);
 await act(async()=>tree.unmount());
});

test('Unknown outcome or forged marker never claims a write completed',async()=>{
 const error=new Error('PreferenceDisplayReadError: saved');error.name='PreferenceDisplayReadError';
 let writes=0;let tree!:ReactTestRenderer;
 await act(async()=>{tree=create(createElement(TimeSettingInput,{...props,onSave:async()=>{writes++;throw error;}}));});
 await draftAndFail(tree);assert.doesNotMatch(text(tree),/本次本机写入已完成/);
 await act(async()=>{tree.root.findByType('input').props.onKeyDown({key:'Enter',preventDefault(){}});});
 assert.equal(writes,1);await act(async()=>tree.unmount());
});

test('Unmounted save completion cannot publish its historical write fact into a replacement editor',async()=>{
 const { PreferenceDisplayReadError }=await import('../src/lib/timePreferenceOutcome');
 const pending=deferred<void>();let oldTree!:ReactTestRenderer;let newTree!:ReactTestRenderer;
 await act(async()=>{oldTree=create(createElement(TimeSettingInput,{...props,onSave:async()=>{await pending.promise;throw new PreferenceDisplayReadError(new Error('Old account read failed'));}}));});
 await act(async()=>{oldTree.root.findByType('input').props.onChange({target:{value:'22:00'}});});
 await act(async()=>{button(oldTree,'保存时间').props.onClick();});
 await act(async()=>oldTree.unmount());
 await act(async()=>{newTree=create(createElement(TimeSettingInput,{...props,value:'07:00'}));});
 await act(async()=>pending.resolve());
 assert.equal(newTree.root.findByType('input').props.value,'07:00');assert.doesNotMatch(text(newTree),/本次本机写入已完成|显示读取失败/);
 await act(async()=>newTree.unmount());
});

test('Retained Save callback cannot resubmit after matched-read recovery or after unmount',async()=>{
 let writes=0;let tree!:ReactTestRenderer;
 await act(async()=>{tree=create(createElement(TimeSettingInput,{...props,onSave:async()=>{writes++;throw new Error('Unknown save result');}}));});
 await act(async()=>{tree.root.findByType('input').props.onChange({target:{value:'22:00'}});});
 const retained=button(tree,'保存时间').props.onClick;
 await act(async()=>retained());
 await act(async()=>retained());assert.equal(writes,1,'Unknown result keeps synchronous stale callbacks blocked');
 await act(async()=>{button(tree,'重新读取当前时间').props.onClick();});
 await act(async()=>retained());assert.equal(writes,1,'Consumed draft cannot be resubmitted by old closure');
 await act(async()=>tree.unmount());
 await act(async()=>retained());assert.equal(writes,1,'Unmounted editor cannot create a new save');
});
