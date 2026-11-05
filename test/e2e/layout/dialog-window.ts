import assert from 'node:assert/strict';
import {test, before, after} from 'node:test';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {chromium, expect} from '@playwright/test';

let browser, server, base;
const entry = `
import React from 'react';import ReactDOM from 'react-dom';
import {EditorRegistry,DESCENDANT_EDITING_CAPABILITY} from './dist/index.js';
import {BlockEditorDialog} from './dist/react.js';
const params=new URLSearchParams(location.search);const hierarchy=params.has('hierarchy');
document.documentElement.lang=params.get('lang')||'ja';
if(params.has('blank'))document.documentElement.lang='';
const state=window.fixture={mounts:0,unmounts:0,commits:[],closes:0};
const node=(id,branches=[])=>({block:{targetId:'sprite',blockId:id,opcode:'fixture_data',revision:'1',arguments:{VALUE:{kind:'literal',value:id+' original'}}},branches});
const live={targetId:'sprite',blockId:'root',generation:'1',nodes:[node('root',hierarchy?[{input:'SUBSTACK',blockIds:['child']}]:[]),...(hierarchy?[node('child')]:[])]};
state.live=live;
const registry=new EditorRegistry();registry.register({apiVersion:1,extensionId:'fixture',editorId:'fields',opcodes:['fixture_data'],editableArguments:['VALUE'],read:b=>({value:b.arguments.VALUE.value}),validate:d=>d.value==='invalid'?[{message:'Invalid value',path:'value'}]:[],createPatch:d=>[{argument:'VALUE',value:d.value}],mount:(container,context)=>{
state.mounts++;const label=document.createElement('label');label.textContent='Value';const input=document.createElement('input');input.value=context.getDraft().value;input.oninput=()=>context.setDraft({value:input.value});label.append(input);container.append(label);
for(let i=0;i<25;i++){const p=document.createElement('p');p.textContent='Scrollable form content '+i;container.append(p);}
return()=>{state.unmounts++;container.replaceChildren();};}});
const commit=request=>{state.commits.push(request);for(const change of request.changes){const b=live.nodes.find(n=>n.block.blockId===(change.blockId||'root')).block;b.arguments[change.argument].value=change.value;}};
const host={readBlock:ref=>live.nodes.find(n=>n.block.blockId===ref.blockId)?.block,commit,descendants:{capability:DESCENDANT_EDITING_CAPABILITY,readSubtree:()=>live,commitSubtree:commit,subscribeInvalidation:()=>()=>{}}};
const session=hierarchy?registry.openDescendants(live,host):registry.open(live,host);state.session=session;
const messages={title:'Edit block',saving:'Saving',cancel:'Cancel',save:'Save',saveAll:'Save all',structureError:'Structure error',conflict:'Conflict',failed:'Failed',structuralNode:'Block'};
const styles={modalContent:'modal-content',hierarchyModal:'hierarchy-modal',header:'header',body:'body',editorBody:'editor-body',buttons:'buttons',errors:'errors',tree:'tree',treeNode:'tree-node',nodeHeading:'node-heading'};
function Modal(props){return ReactDOM.createPortal(React.createElement('div',{className:'overlay',onClick:e=>{if(e.target===e.currentTarget)props.onRequestClose();}},React.createElement('div',{role:'dialog','aria-label':props.contentLabel,className:props.className},React.createElement('div',{className:'frame'},React.createElement('div',{className:props.headerClassName},React.createElement('div',null,props.contentLabel),React.createElement('div',{className:'close-container'},React.createElement('button',{'aria-label':'Close',onClick:props.onRequestClose},'×'))),props.children))),document.body);}
const close=()=>{state.closes++;ReactDOM.unmountComponentAtNode(document.getElementById('app'));};
ReactDOM.render(React.createElement(BlockEditorDialog,{session,ModalComponent:Modal,messages,styles,onClose:close,onError:e=>{throw e;}}),document.getElementById('app'));
window.unmount=()=>ReactDOM.unmountComponentAtNode(document.getElementById('app'));window.ready=true;
`;
before(async () => {
  const bundle = await build({stdin:{contents:entry,resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser'});
  const css=(await readFile('src/react.css','utf8')).replace(/:global\(([^)]*)\)/g,'$1');
  const html=`<!doctype html><html lang="ja"><meta charset="utf-8"><style>html,body{margin:0;font:14px system-ui}*{box-sizing:border-box}.overlay{position:fixed;inset:0;background:#0005}.modal-content{border:4px solid #888;overflow:hidden;background:#fff;border-radius:8px}.header{display:flex;background:#2878af;color:white}.header>div{padding:14px}.close-container{display:flex;align-items:center}button{cursor:pointer}.header button{min-width:32px;min-height:32px}.frame{display:flex;flex-direction:column} ${css}</style><div id="app"></div><script src="/bundle.js"></script></html>`;
  server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?bundle.outputFiles[0].text:html);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true});
});
after(async()=>{await browser?.close();await new Promise(resolve=>server?.close(resolve));});
const near=(a,b)=>assert.ok(Math.abs(a-b)<2, a+' should equal '+b);
async function drag(page,locator,dx,dy){const r=await locator.boundingBox();await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();await page.mouse.move(r.x+r.width/2+dx,r.y+r.height/2+dy,{steps:5});await page.mouse.up();}
async function open(query=''){const page=await browser.newPage({viewport:{width:1440,height:1100}});await page.goto(base+'/'+query);await page.waitForFunction(()=>window.ready);await page.locator('[data-block-editor-window]').waitFor();return page;}

test('single and hierarchy dialogs move, resize on all edges, maximize and restore without remounting drafts',async()=>{
 for(const query of ['', '?hierarchy=1']){
  const page=await open(query),dialog=page.getByRole('dialog');
  const input=dialog.getByLabel('Value',{exact:true}).first();await input.fill('retained draft');
  const mounts=await page.evaluate(()=>window.fixture.mounts);
  await drag(page,page.locator('[data-block-editor-resize="se"]'),-60,-240);
  const initial=await dialog.boundingBox();
  await drag(page,page.locator('[data-block-editor-titlebar] > div').first(),40,30);
  let r=await dialog.boundingBox();near(r.x,initial.x+40);near(r.y,initial.y+30);
  for(const edge of ['n','e','s','w','ne','se','sw','nw']){
   const before=await dialog.boundingBox(),dx=edge.includes('w')?-8:edge.includes('e')?8:0,dy=edge.includes('n')?-8:edge.includes('s')?8:0;
   await drag(page,page.locator('[data-block-editor-resize="'+edge+'"]'),dx,dy);r=await dialog.boundingBox();near(r.width,before.width+(dx?8:0));near(r.height,before.height+(dy?8:0));
  }
  const stored=await dialog.boundingBox();await page.getByRole('button',{name:'全画面化',exact:true}).click();assert.deepEqual(await dialog.boundingBox(),{x:0,y:0,width:1440,height:1100});
  await page.getByRole('button',{name:'元のサイズに戻す',exact:true}).click();assert.deepEqual(await dialog.boundingBox(),stored);
  assert.equal(await input.inputValue(),'retained draft');assert.equal(await page.evaluate(()=>window.fixture.mounts),mounts);assert.equal(await page.evaluate(()=>window.fixture.commits.length),0);
  await dialog.getByRole('button',{name:query?'Save all':'Save',exact:true}).click();await expect(dialog).toHaveCount(0);
  assert.equal(await page.evaluate(()=>window.fixture.commits.length),1);assert.equal(await page.evaluate(()=>window.fixture.live.nodes[0].block.arguments.VALUE.value),'retained draft');
  await page.close();
 }
});
test('narrow windows keep the header and footer reachable and Cancel discards drafts',async()=>{
 const page=await open(),dialog=page.getByRole('dialog');await dialog.getByLabel('Value').fill('cancelled draft');
 await drag(page,page.locator('[data-block-editor-resize="se"]'),-1000,-1000);
 let r=await dialog.boundingBox();near(r.width,360);near(r.height,280);
 await page.setViewportSize({width:320,height:500});
 await page.getByRole('button',{name:'全画面化',exact:true}).click();
 assert.deepEqual(await dialog.boundingBox(),{x:0,y:0,width:320,height:500});
 await page.setViewportSize({width:390,height:720});await expect(dialog).toHaveCSS('width','390px');assert.deepEqual(await dialog.boundingBox(),{x:0,y:0,width:390,height:720});
 await page.getByRole('button',{name:'元のサイズに戻す',exact:true}).click();r=await dialog.boundingBox();
 for(const locator of [page.getByRole('button',{name:'Close',exact:true}),page.getByRole('button',{name:'全画面化',exact:true}),page.getByRole('button',{name:'Cancel',exact:true}),page.getByRole('button',{name:'Save',exact:true})]){
  const b=await locator.boundingBox();assert.ok(b.x>=r.x&&b.y>=r.y&&b.x+b.width<=r.x+r.width&&b.y+b.height<=r.y+r.height);
 }
 await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog).toHaveCount(0);assert.equal(await page.evaluate(()=>window.fixture.live.nodes[0].block.arguments.VALUE.value),'root original');assert.equal(await page.evaluate(()=>window.fixture.commits.length),0);
 await page.close();
});
test('English labels support keyboard maximize and unmount releases all controls',async()=>{
 const page=await open('?lang=en'),dialog=page.getByRole('dialog');
 await page.getByRole('button',{name:'Maximize',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.getByRole('button',{name:'Restore window',exact:true})).toBeVisible();
 await page.keyboard.press('Enter');await expect(page.getByRole('button',{name:'Maximize',exact:true})).toBeVisible();
 await page.evaluate(()=>window.unmount());await expect(dialog).toHaveCount(0);assert.equal(await page.locator('[data-block-editor-resize], [data-block-editor-maximize]').count(),0);
 await page.setViewportSize({width:600,height:500});await page.mouse.move(50,50);assert.equal(await page.evaluate(()=>window.fixture.unmounts),1);await page.close();
});
test('an unset document language uses the host URL language for window controls',async()=>{
 const page=await open('?lang=ja&blank=1');
 await page.getByRole('button',{name:'全画面化',exact:true}).click();
 await expect(page.getByRole('button',{name:'元のサイズに戻す',exact:true})).toBeVisible();
 await page.close();
});
