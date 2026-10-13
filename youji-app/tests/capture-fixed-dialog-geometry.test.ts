import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { initialSessionGeometry } from '../scripts/audit-initial-session-controls.mjs';
import { captureCatalogRawLines } from '../scripts/audit-capture-catalog.mjs';

// The 388 original screenshots show these targets painted. The original actions
// wrongly used the background review scroll box as the fixed dialog clip.
// Mobile target rect is recorded verbatim. Desktop x/y center (520,81) and
// background clip are recorded; its 216x22 box is a declared host reconstruction,
// not an independently captured historical heading rectangle.
// This is a DOM/CSS host replay, not a new browser result. Complete non-containing
// CSS is explicit synthetic input; historical snapshots did not log every CSS key.
const normal = { position:'static', visibility:'visible', display:'block', opacity:'1', overflowX:'visible', overflowY:'visible', transform:'none', translate:'none',rotate:'none',scale:'none',perspective:'none',filter:'none',backdropFilter:'none',contain:'none',willChange:'auto',containerType:'normal',contentVisibility:'visible',clip:'auto',clipPath:'none',maskImage:'none',whiteSpace:'pre-wrap' };
function rect(x:number,y:number,width:number,height:number) { return { x,y,width,height,left:x,top:y,right:x+width,bottom:y+height,toJSON(){return {x,y,width,height,left:x,top:y,right:x+width,bottom:y+height};} }; }
class Element {
  parentElement:Element|null=null; style={...normal}; tagName='DIV'; scrollTop=0;scrollHeight=0;clientHeight=0;scrollWidth=100;clientWidth=100;innerText='source';textContent='source';firstChild={nodeType:3};childNodes=[this.firstChild];
  constructor(public box:ReturnType<typeof rect>,css:Partial<typeof normal>={}) {this.style={...normal,...css};this.clientHeight=box.height;this.scrollHeight=box.height;}
  getBoundingClientRect(){return this.box;}
  contains(target:Element|null):boolean {for(let x=target;x;x=x.parentElement)if(x===this)return true;return false;}
  getAttribute(name:string){return name==='role'&&this.tagName==='DIALOG'?'dialog':null;}
  closest(selector:string):Element|null {if(selector!=='[role=dialog]')return null;return this.tagName==='DIALOG'?this:this.parentElement?.closest(selector)??null;}
}
function fixture({mobile=false,outerCSS={},fixed=true,innerClip=false,covered=false,hidden=false,missingCSS=false} : {mobile?:boolean;outerCSS?:Partial<typeof normal>;fixed?:boolean;innerClip?:boolean;covered?:boolean;hidden?:boolean;missingCSS?:boolean}={}) {
 const width=mobile?360:1280,height=mobile?800:900;
 const outer=new Element(rect(0,mobile?87.1875:110.984375,width,mobile?583.8125:660.015625),{overflowY:'auto',...outerCSS});
 const wrapper=new Element(rect(0,0,width,mobile?780:880),{position:fixed?'fixed':'absolute'});wrapper.parentElement=outer;
 const dialog=new Element(rect(mobile?0:384,mobile?100:35,mobile?360:512,mobile?680:810),{overflowY:'auto'});dialog.tagName='DIALOG';dialog.parentElement=wrapper;
 const target=new Element(mobile?rect(20,651.1875,320,36):rect(412,70,216,22));target.tagName=mobile?'SUMMARY':'H3';target.parentElement=dialog;
 if(innerClip){const clip=new Element(rect(0,120,width,500),{overflowY:'hidden'});clip.parentElement=dialog;target.parentElement=clip;}
 if(hidden)outer.style.opacity='0';
 if(missingCSS)delete (outer.style as Partial<typeof normal>).filter;
 const context={innerWidth:width,innerHeight:height,Node:{TEXT_NODE:3},getComputedStyle:(el:Element)=>el.style,document:{querySelectorAll:(selector:string)=>selector.startsWith('nav')?[]:[target],elementFromPoint:()=>covered?outer:target,createRange:()=>({setStart(){},setEnd(){},getClientRects:()=>[target.box]})}};
 return {context,target,dialog,outer,wrapper};
}
function geometry(options:Parameters<typeof fixture>[0]={}){return runInNewContext(`(${initialSessionGeometry.toString()})('target')`,fixture(options).context);}
function lines(options:Parameters<typeof fixture>[0]={}){return runInNewContext(`(${captureCatalogRawLines.toString()})('source')`,fixture(options).context);}

test('388 desktop title and mobile summary escape only the background clip of a proven viewport-fixed dialog',()=>{
 for(const mobile of [false,true]){const g=geometry({mobile});assert.equal(g.visible,true);assert.equal(g.viewportFixedDialog,true);assert.equal(g.clip.top,mobile?100:35);assert.equal(g.clip.bottom,mobile?780:845);assert.equal(g.centerHit,true);}
});
test('long-original Range uses the same proven fixed boundary but still checks its real modal clip',()=>{
 for(const mobile of [false,true]){const g=lines({mobile});assert.equal(g.lines[0].visible,true);assert.equal(g.viewportFixedDialog,true);assert.equal(g.clip.top,mobile?100:35);assert.equal(g.clip.bottom,mobile?780:845);}
});
test('all containing-block or external clipping CSS rejects the viewport escape, including individual transforms and unknown computed fields',()=>{
 for(const outerCSS of [{transform:'matrix(1,0,0,1,0,0)'},{translate:'0px'},{rotate:'0deg'},{scale:'1'},{perspective:'100px'},{filter:'blur(0px)'},{backdropFilter:'blur(0px)'},{contain:'layout'},{contain:'paint'},{contain:'strict'},{contain:'content'},{willChange:'transform'},{containerType:'inline-size'},{contentVisibility:'auto'},{clip:'rect(0px, 1px, 1px, 0px)'},{clipPath:'inset(0)'},{maskImage:'linear-gradient(black,black)'}])for(const mobile of [false,true]){
  const g=geometry({mobile,outerCSS});assert.equal(g.viewportFixedDialog,false);assert.equal(g.visible,false);assert.equal(lines({mobile,outerCSS}).lines[0].visible,false);
 }
 for(const missingCSS of [true]){assert.equal(geometry({missingCSS}).visible,false);assert.equal(lines({missingCSS}).lines[0].visible,false);}
});
test('non-fixed wrapper, inner overflow, external paint loss and a true covering element never pass',()=>{
 for(const options of [{fixed:false},{innerClip:true},{covered:true},{hidden:true},{outerCSS:{visibility:'hidden'}},{outerCSS:{display:'none'}}])for(const mobile of [false,true]){assert.equal(geometry({mobile,...options}).visible,false);assert.equal(lines({mobile,...options}).lines[0].visible,false);}
});
