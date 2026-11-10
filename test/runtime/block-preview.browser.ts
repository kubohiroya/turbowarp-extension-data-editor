// Block previews on the TurboWarp Plus Editor's pinned VM and Scratch Blocks, through the minimal editor
// runtime. These moved here from the Editor's E2E (test/e2e/turbowarp/block-icon-preview.spec.cts).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {chromium, expect, type Page} from '@playwright/test';
import {serveEditorRuntime} from '@kubohiroya/turbowarp-plus-editor-test-runtime';

const dialog = (page: Page) => page.getByRole('dialog').filter({has: page.locator('[data-block-editor-save]')});
const icon = (page: Page, id: string) => page.locator(`.blocklyBlockCanvas [data-id="${id}"] [data-block-editor-icon]`);
const hover = (page: Page) => page.locator('[data-preview-fixture-hover]');
const visual = (page: Page) => dialog(page).locator('[data-block-preview-visual]');
const shown = (page: Page) => visual(page).locator('[data-preview-fixture-value]');
const add = (page: Page) => visual(page).getByRole('button', {name: 'Add 5', exact: true});
const number = (page: Page) => dialog(page).getByRole('textbox', {name: 'NUMBER', exact: true});
const project = (page: Page) => page.evaluate(() => (globalThis as any).fixed.host.vm.toJSON(undefined, {allowOptimization: false}));
const counts = (page: Page) => page.evaluate(() => {
    const {hovers, hoverReleases, mounts, unmounts, quits} = (globalThis as any).__previewFixture;
    return {hovers, hoverReleases, mounts, unmounts, quits};
});
const native = (page: Page, blockId: string) => page.evaluate(id => {
    const blocks = (globalThis as any).fixed.host.vm.editingTarget.blocks;
    return blocks.getBlock(blocks.getBlock(id).inputs.NUMBER.block).fields.NUM.value;
}, blockId);
const listeners = (page: Page) => page.evaluate(() => {
    const runtime = (globalThis as any).fixed.host.vm.runtime;
    return Object.fromEntries(runtime.eventNames().map((name: unknown) => [String(name), runtime.listenerCount(name)]));
});
const undo = (page: Page, redo: boolean) => page.evaluate(again => (globalThis as any).Blockly.getMainWorkspace().undo(again), redo);

async function load(t: any) {
    const server = await serveEditorRuntime({script: fileURLToPath(new URL('./page.ts', import.meta.url))});
    const browser = await chromium.launch();
    t.after(async () => { await browser.close(); await server.close(); });
    const page = await browser.newPage({viewport: {width: 1280, height: 900}});
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    t.after(() => assert.deepEqual(errors, []));
    await page.goto(server.url);
    await page.evaluate(() => (globalThis as any).setup('preview'));
    await expect(icon(page, 'preview-root')).toHaveCount(1);
    await expect(icon(page, 'plain-root')).toHaveCount(1);
    assert.deepEqual(await page.evaluate(() => (globalThis as any).__previewFixture.capabilities),
        {preview: true, fixed: true, isolatedVm: true});
    return page;
}
async function close(page: Page) {
    await dialog(page).getByRole('button', {name: 'Cancel', exact: true}).click();
    await expect(dialog(page)).toHaveCount(0);
    // Focus returns to the icon, which may legitimately start a new hover.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.mouse.move(5, 5);
    await expect(hover(page)).toHaveCount(0);
}

test('blocks without a registered preview keep their existing form and never start a preview', async t => {
    const page = await load(t);
    const original = await project(page);
    await icon(page, 'plain-root').hover();
    await expect(hover(page)).toHaveCount(0);
    await icon(page, 'plain-root').click();
    await expect(dialog(page)).toBeVisible();
    await expect(number(page)).toHaveValue('10');
    await expect(dialog(page).locator('[data-block-preview-layout]')).toHaveCount(0);
    await close(page);
    assert.deepEqual(await counts(page), {hovers: 0, hoverReleases: 0, mounts: 0, unmounts: 0, quits: 0});
    assert.equal(await project(page), original);
});

test('registered previews share the form draft, save atomically and release every preview resource', async t => {
    const page = await load(t);
    const original = await project(page);
    const beforeListeners = await listeners(page);
    await icon(page, 'preview-root').hover();
    await expect(hover(page)).toHaveText('NUMBER 10');
    await page.mouse.move(5, 5);
    await expect(hover(page)).toHaveCount(0);
    const hovered = await counts(page);
    assert.deepEqual([hovered.hovers, hovered.hoverReleases], [1, 1]);

    await icon(page, 'preview-root').click();
    await expect(shown(page)).toHaveText('10');
    await expect(hover(page)).toHaveCount(0);
    await expect(dialog(page).locator('[data-block-preview-form]')).toBeVisible();
    await number(page).fill('20');
    await expect(shown(page)).toHaveText('20');
    await add(page).click();
    await expect(number(page)).toHaveValue('25');
    await expect(shown(page)).toHaveText('25');
    // Previews and forms only stage drafts; Save remains the sole way a change reaches the project.
    assert.equal(await project(page), original);
    assert.deepEqual(await page.evaluate(() => {
        const host = (globalThis as any).fixed.host;
        const preview = (globalThis as any).__previewFixture.previewVms.at(-1);
        return {separate: preview !== host.vm && preview.runtime !== host.vm.runtime,
            previewHasFixture: typeof preview.runtime._primitives.previewfixture_place === 'function',
            hostHasFixture: typeof host.vm.runtime._primitives.previewfixture_place === 'function'};
    }), {separate: true, previewHasFixture: false, hostHasFixture: true});

    await dialog(page).locator('[data-block-editor-save]').click();
    await expect(dialog(page)).toHaveCount(0);
    await expect.poll(() => native(page, 'preview-root')).toBe('25');
    const saved = await counts(page);
    assert.deepEqual([saved.mounts, saved.unmounts, saved.quits], [1, 1, 1]);
    await undo(page, false);
    await expect.poll(() => native(page, 'preview-root')).toBe('10');
    await undo(page, true);
    await expect.poll(() => native(page, 'preview-root')).toBe('25');
    await undo(page, false);
    await expect.poll(() => native(page, 'preview-root')).toBe('10');

    const beforeCancel = await project(page);
    await icon(page, 'preview-root').click();
    await add(page).click();
    await expect(number(page)).toHaveValue('15');
    await close(page);
    await expect(visual(page)).toHaveCount(0);
    assert.equal(await project(page), beforeCancel);
    const released = await counts(page);
    assert.equal(released.hoverReleases, released.hovers);
    assert.deepEqual([released.mounts, released.unmounts, released.quits], [2, 2, 2]);
    await expect.poll(() => listeners(page)).toEqual(beforeListeners);
});
