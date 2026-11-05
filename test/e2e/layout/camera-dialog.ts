import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from '@playwright/test';
import {readFile, mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve} from 'node:path';

// Optional cross-repository verification: no sibling checkout is a production dependency.
if (!process.argv[2]) throw Error('Usage: node test/e2e/layout/camera-dialog.ts /path/to/built/camera-source');
const common = process.cwd(), camera = resolve(process.argv[2]);
const raw = await readFile(camera + '/tests/fixtures/calibration/valid/minimal.json', 'utf8');
const entry = `
import * as React from ${JSON.stringify(common + '/node_modules/react/index.js')};
import * as ReactDOM from ${JSON.stringify(common + '/node_modules/react-dom/index.js')};
import {createBlockEditorService} from ${JSON.stringify(common + '/dist/rjsf.js')};
import {BlockEditorDialog} from ${JSON.stringify(common + '/dist/react.js')};
import {createSourceEditorOptions,cameraProfileSchemaBundles,cameraProfileUiSchemas,validateCameraProfileInput} from ${JSON.stringify(camera + '/lib-editor/src/editor-metadata.js')};
const service=createBlockEditorService({commonLayout:true}), options=createSourceEditorOptions()[0];
const standard=new URLSearchParams(location.search).get('route')==='rjsf';
const opcode=standard?'camera_profile_standard':options.opcodes[0];
if(standard)service.api.registerSchemaBundle({apiVersion:1,extensionId:'camera',editorId:'standard',opcodes:[opcode],argument:'PROFILE_JSON',schemaBundle:cameraProfileSchemaBundles.twcs,uiSchema:cameraProfileUiSchemas.twcs,validationContext:options.validationContext,ownerValidate:validateCameraProfileInput});
else service.api.registerSourceEditor(options);
const block={targetId:'sprite',blockId:'profile',opcode,revision:'1',arguments:{PROFILE_JSON:{kind:'literal',value:${JSON.stringify(raw)}}}};
const commits=[];
const session=service.registry.open(block,{readBlock:()=>block,commit:request=>{commits.push(request);block.arguments.PROFILE_JSON.value=request.changes[0].value;}});
const styles={modalContent:'modal-content',header:'header',body:'body',editorBody:'editor-body',buttons:'buttons',errors:'errors'};
const messages={title:'カメラプロファイルを編集',saving:'保存中…',cancel:'キャンセル',save:'保存',saveAll:'すべて保存',structureError:'構造が変更されました',conflict:'競合',failed:'保存できませんでした',structuralNode:'構造'};
function Modal(props){return React.createElement('div',{role:'dialog','aria-label':props.contentLabel,className:props.className},React.createElement('header',{className:props.headerClassName},React.createElement('span',null,'Camera Source'),React.createElement('h1',null,props.contentLabel)),props.children);}
ReactDOM.render(React.createElement(BlockEditorDialog,{session,ModalComponent:Modal,messages,styles,onClose:()=>{},onError:console.error}),document.getElementById('app'));
window.editor={session,block,commits};
`;
const bundle = await build({stdin: {contents: entry, resolveDir: common}, write: false, bundle: true, format: 'iife', platform: 'browser'});
const css = (await readFile(common + '/src/react.css', 'utf8')).replace(/:global\(([^)]*)\)/g, '$1');
// Only the host modal frame is styled here. Every form/control style comes from the shipped library.
const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><title>Camera Source 編集フォーム</title><style>${css}
body{margin:0;padding:24px;background:#edf1f8;color:#25334a;font:14px system-ui}.modal-content{width:820px;max-width:calc(100vw - 48px);margin:8px auto;background:white;border-radius:14px;border:1px solid #d5ddeb;overflow:hidden;box-shadow:0 12px 40px #283e5b18}.header{padding:18px 24px;background:#f7f9fd;border-bottom:1px solid #e2e7f0}.header span{font-size:12px;font-weight:650;letter-spacing:.04em;color:#637086}.header h1{font-size:19px;margin:5px 0 0}.body{max-height:calc(100vh - 180px)}.buttons button[data-block-editor-save]{background:#426ad6;color:white;border-color:#426ad6;border-radius:7px}.buttons button{font:14px system-ui}
</style><div id="app"></div><script src="/preview.js"></script></html>`;
const server = createServer((request, response) => {response.setHeader('Content-Type', request.url === '/preview.js' ? 'text/javascript' : 'text/html; charset=utf-8');response.end(request.url === '/preview.js' ? bundle.outputFiles[0].text : html);});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, ...(process.env.LAYOUT_CHROMIUM_EXECUTABLE ? {executablePath: process.env.LAYOUT_CHROMIUM_EXECUTABLE} : {})});
  const page = await browser.newPage({viewport: {width: 1050, height: 1500}, deviceScaleFactor: 1});
  const errors = [];page.on('pageerror', error => errors.push(error.message));
  await mkdir('test-results/layout', {recursive: true});
  for (const route of ['source', 'rjsf']) {
    await page.goto(`http://127.0.0.1:${server.address().port}/?route=${route}`);
    await page.waitForFunction(() => window.editor);
    await page.getByRole('tab', {name: 'Profile', exact: true}).waitFor();
    await page.getByRole('dialog').screenshot({path: `test-results/layout/camera-${route}-profile-after.png`});
    await page.getByRole('tab', {name: 'Camera', exact: true}).click();
    assert.equal(await page.locator('[data-layout-field="fx"] .editor-form-hint, [data-layout-field="fx"] .editor-form-help').count(), 0);
    assert.ok(await page.locator('.editor-form-help').count() > 0);
    assert.equal(await page.locator('.editor-form-help').evaluateAll(elements => elements.every(element =>
      element.querySelector('summary')?.textContent === '説明を表示' && !!element.querySelector('p')?.textContent.trim())), true);
    const explanation = page.locator('.editor-form-help').first();
    await explanation.locator('summary').click();
    assert.equal(await explanation.locator('p').isVisible(), true);
    await page.getByRole('dialog').screenshot({path: `test-results/layout/camera-${route}-description-open.png`});
    await explanation.locator('summary').click();
    if (route === 'source') {
      assert.equal(await page.locator('[data-source-type-control]').count(), 0);
      assert.equal(await page.getByRole('button', {name: 'Remove /image/width', exact: true}).count(), 0);
      assert.equal(await page.getByRole('button', {name: 'Add item /distortion/coefficients', exact: true}).count(), 0);
    }
    await page.getByRole('dialog').screenshot({path: `test-results/layout/camera-${route}-after.png`});
    const fx = page.locator('[data-layout-field="fx"] input');
    await fx.fill(route === 'source' ? '1e' : '-1');
    await page.getByRole('tab', {name: 'Profile', exact: true}).click();
    assert.equal((await page.evaluate(() => window.editor.session.save())).status, 'invalid');
    await fx.waitFor({state: 'visible'});
    await page.waitForFunction(() => document.activeElement === document.querySelector('[data-layout-field="fx"] input'));
    await fx.fill('941.25');
    await page.getByRole('button', {name: '保存', exact: true}).click();
    await page.waitForFunction(() => window.editor.commits.length === 1);
    assert.equal(JSON.parse(await page.evaluate(() => window.editor.block.arguments.PROFILE_JSON.value)).intrinsics.fx, 941.25);
    await page.goto(`http://127.0.0.1:${server.address().port}/?route=${route}`);await page.waitForFunction(() => window.editor);
    await page.getByRole('tab', {name: 'Camera', exact: true}).click();await fx.fill('1000');
    await page.getByRole('button', {name: 'キャンセル', exact: true}).click();
    assert.equal(await page.evaluate(() => window.editor.commits.length), 0);
    await page.setViewportSize({width: 390, height: 844});
    await page.goto(`http://127.0.0.1:${server.address().port}/?route=${route}`);await page.waitForFunction(() => window.editor);
    await page.getByRole('tab', {name: 'Camera', exact: true}).click();
    assert.equal(await page.locator('.block-editor-layout-grid').first().evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length), 1);
    assert.equal(await page.getByRole('dialog').evaluate(element => element.scrollWidth <= element.clientWidth), true);
    await page.getByRole('dialog').screenshot({path: `test-results/layout/camera-${route}-mobile-after.png`});
    await page.setViewportSize({width: 1050, height: 1500});
  }
  assert.deepEqual(errors, []);
  console.log('PASS: actual Camera Source metadata + common dialog, both paths, absent descriptions hidden, real descriptions expandable, schema controls, screenshots, hidden errors/focus, save, cancel');
} finally {await browser?.close();await new Promise(resolve => server.close(resolve));}
