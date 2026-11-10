// Fixed inputs on the TurboWarp Plus Editor's pinned VM and Scratch Blocks, through the minimal editor
// runtime. These moved here from the Editor's E2E (test/e2e/turbowarp/fixed-inputs.spec.cts); the Editor
// keeps the checks of its own wiring: the GUI's wording and that an ordinary startup has the editors.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {chromium, expect, type Page} from '@playwright/test';
import {serveEditorRuntime} from '@kubohiroya/turbowarp-plus-editor-test-runtime';

const words = {title: 'Edit block', save: 'Save', cancel: 'Cancel', error: 'Check this value before saving.',
    readOnly: 'This input cannot be edited safely.',
    unverified: 'The expression is retained without evaluation. Its runtime validity has not been checked.',
    inactive: 'Hidden edits are retained in this dialog and will not be saved while hidden.', picker: 'COLOR color picker'};
const dialog = (page: Page) => page.getByRole('dialog').filter({has: page.locator('[data-block-editor-save]')});
const raw = (page: Page) => page.evaluate(() => (globalThis as any).raw());

async function load(t: any) {
    const server = await serveEditorRuntime({script: fileURLToPath(new URL('./page.ts', import.meta.url))});
    const browser = await chromium.launch();
    t.after(async () => { await browser.close(); await server.close(); });
    const page = await browser.newPage({viewport: {width: 1280, height: 900}});
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    t.after(() => assert.deepEqual(errors, []));
    await page.goto(server.url);
    await page.evaluate(() => (globalThis as any).setup('fixed'));
    await expect(page.locator('.blocklyBlockCanvas [data-id="fixed-root"]')).toHaveCount(1);
    assert.equal(await page.evaluate(() => (globalThis as any).__fixedFixtureAvailable), true);
    return page;
}
const open = async (page: Page) => {
    const icon = page.getByRole('button', {name: words.title, exact: true});
    await icon.focus(); await page.keyboard.press('Enter');
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page)).toHaveAccessibleName(/^Edit fixed /);
};

test('fixed native fields validate, save from the keyboard and leave the reporter unevaluated', async t => {
    const page = await load(t);
    await open(page);
    const view = dialog(page);
    await expect(view.locator('[data-block-editor-node]')).toHaveCount(0);
    const mode = view.getByRole('combobox', {name: 'MODE', exact: true});
    const number = view.getByRole('textbox', {name: 'NUMBER', exact: true});
    const color = view.getByRole('textbox', {name: 'COLOR', exact: true});
    await expect(mode).toHaveValue('"timeout"'); await expect(number).toHaveValue('10');
    const condition = view.locator('[data-fixed-argument="CONDITION"]');
    await expect(condition).toBeVisible(); await expect(condition).toHaveAttribute('disabled', '');
    await expect(condition.locator('output[aria-label="CONDITION"]')).toHaveCount(1);
    await expect(condition.locator('input, textarea, select')).toHaveCount(0);
    await expect(condition.getByText(words.readOnly, {exact: true})).toBeVisible();
    await expect(condition.getByText(words.unverified, {exact: true})).toBeVisible();
    const picker = view.locator(`input[type="color"][aria-label="${words.picker}"]`);
    await expect(picker).toHaveValue('#112233');
    const bounds = await picker.boundingBox();
    assert.ok(bounds && bounds.width >= 40 && bounds.height >= 40, JSON.stringify(bounds));
    assert.ok(await picker.evaluate(element => {
        const style = getComputedStyle(element);
        return element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) > 0;
    }));
    assert.equal(await view.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true);
    await number.focus(); await expect(number).toBeFocused(); await page.keyboard.press('Tab');
    assert.equal(await view.evaluate(element => element.contains(element.ownerDocument.activeElement)), true);
    await number.fill('1e'); await expect(number).toHaveAttribute('aria-invalid', 'true');
    const describedBy = await number.getAttribute('aria-describedby');
    assert.ok(describedBy);
    await expect(view.locator(`[id="${describedBy.split(/\s+/).find(id => id.endsWith('-error'))}"]`)).toHaveText(words.error);
    await expect(view.getByRole('button', {name: words.save, exact: true})).toBeDisabled();
    assert.equal((await raw(page)).number, '10');
    await number.fill('25'); await color.fill('#445566');
    await expect(view.getByRole('button', {name: words.save, exact: true})).toBeEnabled();
    await view.getByRole('button', {name: words.save, exact: true}).click(); await expect(view).toHaveCount(0);
    assert.deepEqual(await raw(page), {mode: 'timeout', number: '25', timeout: '10', color: '#445566',
        reporter: 'fixed-context', evaluations: 0});
    await open(page);
    await expect(dialog(page).getByRole('textbox', {name: 'NUMBER', exact: true})).toHaveValue('25');
    await dialog(page).getByRole('button', {name: words.cancel, exact: true}).click();
});

test('hidden branch drafts are retained in the dialog and excluded from the native saved values', async t => {
    const page = await load(t);
    await open(page);
    const view = dialog(page);
    const timeout = view.getByRole('textbox', {name: 'TIMEOUT', exact: true});
    const mode = view.getByRole('combobox', {name: 'MODE', exact: true});
    await timeout.fill('20');
    await mode.selectOption('"forever"');
    await expect(timeout).toHaveCount(0);
    await expect(view.locator('[data-fixed-inactive-draft]')).toContainText(words.inactive);
    await mode.selectOption('"timeout"');
    await expect(timeout).toHaveValue('20');
    await mode.selectOption('"forever"');
    await view.getByRole('button', {name: words.save, exact: true}).click(); await expect(view).toHaveCount(0);
    const saved = await raw(page);
    assert.equal(saved.mode, 'forever'); assert.equal(saved.timeout, '10'); assert.equal(saved.evaluations, 0);
});

test('the Scratch Blocks dropdown updates the VM and the next fixed form without executing reporters', async t => {
    const page = await load(t);
    const native = page.locator('.blocklyBlockCanvas [data-id="fixed-root"] .blocklyDropdownText');
    const dropdown = page.locator('.blocklyDropDownDiv');
    await native.click(); await expect(dropdown).toBeVisible();
    await dropdown.locator('.goog-menuitem').filter({hasText: /^Forever$/}).click();
    await expect.poll(async () => (await raw(page)).mode).toBe('forever');
    await open(page);
    await expect(dialog(page).getByRole('combobox', {name: 'MODE', exact: true})).toHaveValue('"forever"');
    await expect(dialog(page).getByRole('textbox', {name: 'TIMEOUT', exact: true})).toHaveCount(0);
    await dialog(page).getByRole('button', {name: words.cancel, exact: true}).click();
    await native.click(); await expect(dropdown).toBeVisible();
    await dropdown.locator('.goog-menuitem').filter({hasText: /^Timeout$/}).click();
    await expect.poll(async () => (await raw(page)).mode).toBe('timeout');
    await open(page);
    await expect(dialog(page).getByRole('textbox', {name: 'TIMEOUT', exact: true})).toHaveValue('10');
    assert.equal((await raw(page)).evaluations, 0);
    await dialog(page).getByRole('button', {name: words.cancel, exact: true}).click();
});
