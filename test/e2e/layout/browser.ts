import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {mkdir} from 'node:fs/promises';

const result = await build({entryPoints: ['test/e2e/layout/fixture.ts'], bundle: true, platform: 'browser', format: 'iife', write: false});
const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><title>共通レイアウトの実装確認</title><style>
body{font:16px system-ui;margin:24px;color:#202636;background:#f5f7fa}main{display:grid;grid-template-columns:1fr 1fr;gap:24px}section{background:white;padding:20px;min-width:0;border:1px solid #ccd2df;border-radius:12px}fieldset{min-width:0;margin:12px 0;padding:12px;border:1px solid #bfc8d7}input,textarea,select{max-width:100%;box-sizing:border-box;padding:6px}button{padding:8px;margin:3px}label{display:block}legend{font-weight:600}@media(max-width:600px){main{display:block}}h1{font-size:24px}
</style><h1>共通レイアウトの実装確認</h1><main><section><h2>RJSF</h2><div id="rjsf"></div></section><section><h2>Source / Form</h2><div id="source"></div></section></main><script src="/fixture.js"></script></html>`;
const server = createServer((request, response) => {
  response.setHeader('Content-Type', request.url === '/fixture.js' ? 'text/javascript' : 'text/html; charset=utf-8');
  response.end(request.url === '/fixture.js' ? result.outputFiles[0].text : html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, ...(process.env.LAYOUT_CHROMIUM_EXECUTABLE ? {executablePath: process.env.LAYOUT_CHROMIUM_EXECUTABLE} : {})});
  const page = await browser.newPage({viewport: {width: 1280, height: 1000}});
  const errors = [];page.on('pageerror', error => errors.push(error.message));
  const url = `http://127.0.0.1:${server.address().port}/`;
  await page.goto(url);await page.waitForFunction(() => window.editors?.source);
  for (const route of ['rjsf', 'source']) {
    const root = page.locator(`#${route}`);
    await root.getByRole('tab', {name: '画像'}).click();
    const grid = root.locator('.block-editor-layout-grid');
    assert.equal(await grid.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length), 2);
    const width = root.locator('[data-layout-field="width"] input');
    await width.fill(route === 'source' ? '1e' : '0');
    await root.getByRole('tab', {name: '基本'}).click();
    assert.equal(await root.getByRole('tab', {name: /画像/}).locator('[aria-label^="エラー"]').count(), 1);
    assert.equal(await page.evaluate(route => window.editors[route].session.getState().canSave, route), false);
    assert.equal((await page.evaluate(route => window.editors[route].session.save(), route)).status, 'invalid');
    await width.waitFor({state: 'visible'});await page.waitForFunction(route => document.activeElement === document.querySelector(`#${route} [data-layout-field="width"] input`), route);
    if (route === 'source') assert.equal(await width.inputValue(), '1e');
    await width.fill('800');
    await root.getByRole('tab', {name: /画像/}).focus();await page.keyboard.press('Home');
    assert.equal(await root.getByRole('tab', {name: '基本'}).getAttribute('aria-selected'), 'true');
    assert.equal(await root.getByRole('tab', {name: '基本'}).evaluate(element => element === document.activeElement), true);
    await root.locator('[data-layout-field="name"] input, [data-layout-field="name"] textarea').fill('updated');
    await root.getByRole('tab', {name: /画像/}).click();
  }
  const ids = await page.locator('[role="tab"]').evaluateAll(elements => elements.map(element => element.id));assert.equal(new Set(ids).size, ids.length);
  await mkdir('test-results/layout', {recursive: true});
  await page.screenshot({path: 'test-results/layout/desktop.png', fullPage: true});
  await page.setViewportSize({width: 390, height: 844});
  for (const route of ['rjsf', 'source']) assert.equal(await page.locator(`#${route} .block-editor-layout-grid`).evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length), 1);
  await page.screenshot({path: 'test-results/layout/mobile.png', fullPage: true});
  for (const route of ['rjsf', 'source']) {
    assert.equal((await page.evaluate(route => window.editors[route].session.save(), route)).status, 'saved');
    assert.equal(await page.evaluate(route => window.editors[route].commits.length, route), 1);
    const data = JSON.parse(await page.evaluate(route => window.editors[route].block.arguments.SOURCE.value, route));
    assert.equal(data.width, 800);assert.equal(data.name, 'updated');assert.equal(data.other, '未分類の項目');
  }
  await page.goto(url + '?off');await page.waitForFunction(() => window.editors?.source);
  assert.equal(await page.getByRole('tab').count(), 0);assert.deepEqual(errors, []);
  console.log('PASS: Chromium / React 16, both renderers, error reveal/focus, draft retention, keyboard, responsive grid, atomic save, flag OFF');
} finally {await browser?.close();await new Promise(resolve => server.close(resolve));}
