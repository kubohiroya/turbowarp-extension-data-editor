// Nested block forms on the TurboWarp Plus Editor's pinned VM and Scratch Blocks, through the minimal
// editor runtime. These moved here from the Editor's E2E (test/e2e/turbowarp/invalid-theme.spec.cts).
// The colours checked are this package's own defaults; the Editor keeps its theme checks, light and dark,
// which come from its stylesheet and the GUI's theme variables.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {chromium, expect, type Locator, type Page} from '@playwright/test';
import {serveEditorRuntime} from '@kubohiroya/turbowarp-plus-editor-test-runtime';

const colours = {red: 'rgb(198, 40, 40)', errorText: 'rgb(166, 27, 27)', tint: 'rgba(198, 40, 40, 0.08)'};
const paths = ['name', 'amount', 'mode', 'notes', 'nested_invalid'];
const dialog = (page: Page) => page.getByRole('dialog').filter({has: page.locator('[data-block-editor-save]')});
const section = (page: Page, id: string) => dialog(page).locator(`[data-block-editor-node="theme-${id}"]`);
const form = (page: Page, id = 'grand') => section(page, id).locator('.rjsf').first();
const field = (scope: Locator, path: string) =>
    scope.locator(`input[id$="_${path}"], textarea[id$="_${path}"], select[id$="_${path}"]`);
const save = (page: Page) => dialog(page).locator('[data-block-editor-save]');
const canvas = (page: Page) => page.locator('.blocklySvg > .blocklyWorkspace > .blocklyBlockCanvas').first();
const errorFor = async (control: Locator) => control.page().locator(`[id="${await control.getAttribute('id')}__error"]`);

async function load(t: any) {
    const server = await serveEditorRuntime({script: fileURLToPath(new URL('./page.ts', import.meta.url))});
    const browser = await chromium.launch();
    t.after(async () => { await browser.close(); await server.close(); });
    const page = await browser.newPage({viewport: {width: 1280, height: 900}});
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    t.after(() => assert.deepEqual(errors, []));
    await page.goto(server.url);
    await page.evaluate(() => (globalThis as any).setup('theme'));
    await expect(page.locator('[data-block-editor-icon]')).toHaveCount(3);
    return page;
}
const open = async (page: Page, id: string) => {
    await page.locator(`.blocklyBlockCanvas [data-id="theme-${id}"] > [data-block-editor-icon]`).click();
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page)).toHaveAccessibleName(/^Edit Theme (group|item)/);
};
const expectInvalid = async (control: Locator) => {
    await expect(control).toHaveAttribute('aria-invalid', 'true');
    await expect(control).toHaveCSS('border-top-color', colours.red);
    await expect.poll(() => control.evaluate(element => getComputedStyle(element).backgroundImage)).toContain(colours.tint);
    const error = await errorFor(control);
    await expect(error).toBeVisible();
    await expect(error).not.toHaveText('');
    assert.ok((await control.getAttribute('aria-describedby'))!.split(/\s+/).includes((await error.getAttribute('id'))!));
    await expect(error).toHaveCSS('border-left-color', colours.red);
    await expect(error).toHaveCSS('color', colours.errorText);
};
const expectValid = async (control: Locator) => {
    await expect(control).not.toHaveAttribute('aria-invalid', 'true');
    await expect(control).not.toHaveAttribute('data-block-editor-invalid', 'true');
    await expect(control).toHaveCSS('background-image', 'none');
    await expect(await errorFor(control)).toHaveCount(0);
};
// Each block's section keeps its block's own colour, whatever the fields do.
const readBlocks = async (page: Page) => {
    const blocks: Record<string, {border: string; background: string}> = {};
    for (const id of ['root', 'grand', 'sibling']) {
        const node = section(page, id);
        await expect(node.locator(`[data-block-editor-node-name="theme-${id}"]`)).toHaveText(id === 'root' ? 'Theme group' : 'Theme item');
        const icon = node.locator(`[data-block-editor-node-icon="theme-${id}"]`);
        await expect(icon).toBeVisible();
        await expect.poll(() => icon.evaluate(element => (element as HTMLImageElement).complete &&
            (element as HTMLImageElement).naturalWidth > 0)).toBe(true);
        blocks[id] = await node.evaluate(element => {
            const css = getComputedStyle(element);
            return {border: css.borderTopColor, background: css.backgroundImage};
        });
        const colour = id === 'grand' ? '102, 51, 153' : '8, 127, 140';
        assert.equal(blocks[id]!.border, `rgb(${colour})`);
        assert.ok(blocks[id]!.background.includes(`rgba(${colour}, 0.08)`), blocks[id]!.background);
    }
    return blocks;
};
const correct = async (scope: Locator) => {
    await field(scope, 'name').fill('Corrected name');
    await field(scope, 'amount').fill('3');
    await field(scope, 'mode').selectOption({label: 'b'});
    await field(scope, 'notes').fill('OK notes');
    await field(scope, 'nested_invalid').fill('OK');
};

test('nested forms mark invalid fields, clear them when corrected and keep each block\'s colour', async t => {
    const page = await load(t);
    const original = await canvas(page).textContent();
    await open(page, 'root');

    const shortcutKey = form(page).locator('input[id$="_shortcuts_ArrowRight-key"]');
    const shortcut = form(page).locator('[data-block-editor-item]').filter({has: page.locator('input[id$="_shortcuts_ArrowRight-key"]')});
    await shortcutKey.scrollIntoViewIfNeeded();
    await expect(shortcut.locator('label')).toHaveText(['キー', '値']);
    await expect(shortcut.locator('input')).toHaveCount(2);
    await expect(shortcutKey).toHaveValue('ArrowRight');
    await expect(shortcut.getByLabel('値', {exact: true})).toHaveValue('rehearsal.skipAction');
    await expect(shortcut).toHaveCSS('border-top-style', 'solid');
    assert.equal(await shortcut.locator('[data-block-editor-pair-row]').evaluateAll(rows => rows.every(row => {
        const label = row.querySelector('label')!.getBoundingClientRect();
        const input = row.querySelector('input')!.getBoundingClientRect();
        return Math.abs((label.top + label.bottom) - (input.top + input.bottom)) < 2;
    })), true, 'each key-value label sits on its input\'s row');
    await shortcut.getByRole('button', {name: '項目のメニュー', exact: true}).click();
    await expect(shortcut.getByRole('menuitem')).toBeVisible();
    await shortcut.getByRole('menuitem').press('Escape');
    await expect(shortcut.getByRole('menu')).toHaveCount(0);
    await expect(dialog(page)).toBeVisible();

    for (const path of paths) await expectInvalid(field(form(page), path));
    for (const [id, path] of [['grand', 'nested_valid'], ['grand', 'items_0_label'], ['root', 'name'], ['sibling', 'amount']] as const) {
        await expectValid(field(form(page, id), path));
    }
    await expect(save(page)).toBeDisabled();
    const before = await readBlocks(page);

    await correct(form(page));
    for (const path of paths) await expectValid(field(form(page), path));
    await expect(save(page)).toBeEnabled();
    assert.deepEqual(await readBlocks(page), before);
    assert.equal(await canvas(page).textContent(), original);

    await field(form(page), 'name').fill('');
    await expectInvalid(field(form(page), 'name'));
    await expect(await errorFor(field(form(page), 'name'))).toContainText('required');
    await field(form(page), 'name').fill('Corrected name');
    await expectValid(field(form(page), 'name'));
    const amount = field(form(page), 'amount');
    await amount.fill('0');
    await expectInvalid(amount);
    await expect(amount).toBeFocused();
    await expect(amount).toHaveCSS('outline-style', /auto|solid/);
    // Collapsing the invalid block's parents keeps the issue reachable from the issue list.
    await dialog(page).locator('[data-block-editor-toggle="theme-grand"]').click();
    await dialog(page).locator('[data-block-editor-toggle="theme-middle"]').click();
    await expect(section(page, 'grand')).toHaveCount(0);
    await expect(save(page)).toBeDisabled();
    await dialog(page).locator('[data-block-editor-issue]').first().click();
    await expect(field(form(page), 'amount')).toBeFocused();
    await expectInvalid(field(form(page), 'amount'));
    await expect(field(form(page), 'name')).toHaveValue('Corrected name');
    await field(form(page), 'amount').fill('3');
    await expectValid(field(form(page), 'amount'));

    const optional = field(form(page), 'group_other');
    await optional.fill('');
    const objectGroup = form(page).locator('.field-object.has-error').filter({has: page.locator('input[id$="_group_valid"]')}).last();
    await expect(objectGroup).toHaveAttribute('aria-invalid', 'true');
    await expect(objectGroup.locator('.error-detail')).toContainText('2');
    await expectValid(field(form(page), 'group_valid'));
    await expectValid(optional);
    await expect(save(page)).toBeDisabled();
    await optional.fill('Restored property');
    await expect(save(page)).toBeEnabled();
    const array = form(page).locator('.field-array').first();
    await array.getByRole('button', {name: '項目のメニュー', exact: true}).last().click();
    await expect(array.locator('.array-item')).toHaveCount(2);
    await array.getByRole('menuitem', {name: '🗑️この項目を削除', exact: true}).click();
    await expect(array).toHaveAttribute('aria-invalid', 'true');
    await expect(array.locator('.error-detail')).toContainText('2');
    await expectValid(field(form(page), 'items_0_label'));
    await expect(save(page)).toBeDisabled();
    await array.getByRole('button', {name: '➕項目を追加', exact: true}).click();
    await field(form(page), 'items_1_label').fill('Restored valid item');
    await expect(save(page)).toBeEnabled();
    assert.deepEqual(await readBlocks(page), before);

    // Cancel discards every draft: the project and the next form are as they were.
    await dialog(page).getByRole('button', {name: 'Cancel', exact: true}).click();
    await expect(dialog(page)).toHaveCount(0);
    assert.equal(await canvas(page).textContent(), original);
    await open(page, 'root');
    for (const path of paths) await expectInvalid(field(form(page), path));
    await expect(field(form(page), 'name')).toHaveValue('');
    await dialog(page).getByRole('button', {name: 'Cancel', exact: true}).click();
});

test('a single nested block opens alone, validates and closes on Escape', async t => {
    const page = await load(t);
    await open(page, 'grand');
    await expect(dialog(page).locator('[data-block-editor-node]')).toHaveCount(1);
    const single = form(page);
    for (const path of paths) await expectInvalid(field(single, path));
    await expect(save(page)).toBeDisabled();
    await correct(single);
    for (const path of paths) await expectValid(field(single, path));
    await expect(save(page)).toBeEnabled();
    await field(single, 'amount').press('Escape');
    await expect(dialog(page)).toHaveCount(0);
});
