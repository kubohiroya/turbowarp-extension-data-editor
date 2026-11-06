import assert from 'node:assert/strict';
import {test} from 'node:test';
import {domFixture} from './fixtures/fixed-form-dom.ts';
import {binding} from './fixtures/fixed-form-fixture.ts';
const options = () => ({apiVersion: 1, extensionId: 'commonfixture', editorId: 'fixed', opcodes: ['commonfixture_fixed'], contractId: 'common-fixture.ui', contractRevision: '1',
  validationContext: () => ({consumerId: 'common-fixture', nowMs: 0, settings: null}), readOnlyArguments: ['CONDITION'], bindings: [
    binding('TEXT'), binding('NUMBER', {kind: 'number'}, {type: 'number'}, {read: Number, encode: value => String(value)}),
    binding('CHOICE', {kind: 'enum', choices: [{value: 'one', label: 'First choice'}, {value: 'two', label: 'Second choice'}]}, {type: 'string', enum: ['one', 'two']}),
    binding('COLOR', {kind: 'color'}, {type: 'string', pattern: '^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$'})]});
const seed = () => ({TEXT: {literal: ' untouched '}, NUMBER: {literal: '001'}, CHOICE: {literal: 'one'}, COLOR: {literal: '#AbC'}, CONDITION: {literal: 'ready'}});

test('fixed forms render text finite-number enum color and readonly controls without changing opening raw', async t => {
  const f = await domFixture(t, 'common-only', seed(), {options: options()});
  assert.equal(f.byLabel('TEXT').tagName, 'TEXTAREA');assert.equal(f.byLabel('NUMBER').type, 'text');
  assert.equal(f.byLabel('NUMBER').inputMode, 'decimal');assert.equal(f.byLabel('CHOICE').tagName, 'SELECT');
  assert.equal(f.byLabel('CHOICE').selectedOptions[0].textContent, 'First choice');
  assert.equal(f.byLabel('COLOR').value, '#AbC');assert.equal(f.byLabel('COLOR color picker').value, '#aabbcc');
  assert.equal(f.byLabel('CONDITION').tagName, 'OUTPUT');
  assert.deepEqual(await f.save(), {status: 'saved', changed: false});assert.equal(f.requests.length, 0);
  assert.equal(f.live.arguments.NUMBER.value, '001');assert.equal(f.live.arguments.COLOR.value, '#AbC');
});

test('unknown enum is retained as a disabled current option and repaired only by an explicit known selection', async t => {
  const raw = seed();raw.CHOICE.literal = 'unknown';const f = await domFixture(t, 'common-only', raw, {options: options()});
  assert.equal(f.byLabel('CHOICE').selectedOptions[0].disabled, true);assert.equal(f.byLabel('CHOICE').selectedOptions[0].textContent, 'unknown');
  assert.equal(f.session.getDraft().inputs.CHOICE.changed, false);
  await f.change('CHOICE', 'two');assert.equal(f.session.getDraft().inputs.CHOICE.value, 'two');
  assert.equal((await f.save()).status, 'saved');assert.deepEqual(f.requests[0].changes, [{argument: 'CHOICE', value: 'two'}]);
});

test('invalid numeric text is session draft and survives failed saving and a view remount', async t => {
  const f = await domFixture(t, 'common-only', seed(), {options: options()});
  await f.change('NUMBER', '1e');assert.equal(f.session.getDraft().inputs.NUMBER.buffer, '1e');
  assert.equal(f.session.getState().canSave, false);assert.equal((await f.save()).status, 'invalid');
  assert.equal(f.requests.length, 0);assert.equal(f.session.getDraft().inputs.NUMBER.buffer, '1e');
  await f.unmount();await f.mount();assert.equal(f.byLabel('NUMBER').value, '1e');assert.equal(f.live.arguments.NUMBER.value, '001');
});

for (const token of ['-0', ' 2.50e1 ', '1e-2']) test(`number input preserves the exact accepted token ${JSON.stringify(token)}`, async t => {
  const f = await domFixture(t, 'common-only', seed(), {options: options()});await f.change('NUMBER', token);
  assert.equal(f.byLabel('NUMBER').value, token);assert.equal((await f.save()).status, 'saved');
  assert.equal(f.requests[0].changes[0].value, token.trim());
});

for (const token of ['', 'NaN', 'Infinity', '1e9999', '+1', '0x10', '.5']) test(`number input refuses invalid token ${JSON.stringify(token)} without writing`, async t => {
  const f = await domFixture(t, 'common-only', seed(), {options: options()});await f.change('NUMBER', token);
  assert.equal(f.byLabel('NUMBER').value, token);assert.equal((await f.save()).status, 'invalid');assert.equal(f.requests.length, 0);
});

test('color text and picker keep explicit changes separate from display-only normalization', async t => {
  const f = await domFixture(t, 'common-only', seed(), {options: options()});
  await f.change('TEXT', 'after');assert.equal(f.session.getDraft().inputs.COLOR.changed, false);
  await f.change('COLOR', '#ABCDEF');assert.equal(f.byLabel('COLOR').value, '#ABCDEF');
  assert.equal(f.byLabel('COLOR color picker').value, '#abcdef');
  assert.equal((await f.save()).status, 'saved');assert.equal(f.live.arguments.COLOR.value, '#ABCDEF');
});

test('string numeric branches keep string data and reset only by an explicit action', async t => {
  const f = await domFixture(t, 'CP-asset-cache', {PROPERTY: {literal: 'width'}, VALUE: {literal: '20'}});
  assert.equal(f.byLabel('VALUE').inputMode, 'decimal');await f.change('VALUE', '1e');
  assert.equal(f.session.getDraft().inputs.VALUE.value, '1e');assert.equal((await f.save()).status, 'invalid');
  await f.click('VALUE Reset');assert.deepEqual(f.session.getDraft().inputs.VALUE, {value: '', changed: true});
  assert.equal((await f.save()).status, 'saved');assert.equal(f.live.arguments.VALUE.value, '');
});

test('reporter-backed inputs stay readonly without adding a fabricated replacement value', async t => {
  const raw = seed();raw.NUMBER = {reporter: {identity: 'computed-number'}};
  const f = await domFixture(t, 'common-only', raw, {options: options()});
  assert.equal(f.byLabel('NUMBER').tagName, 'OUTPUT');assert.deepEqual(f.session.getDraft().inputs.NUMBER, {readOnly: true});
  await f.change('TEXT', 'after');assert.equal((await f.save()).status, 'saved');
  assert.deepEqual(f.live.arguments.NUMBER, {kind: 'reporter'});assert.deepEqual(f.requests[0].changes, [{argument: 'TEXT', value: 'after'}]);
});

test('owner callback diagnostics remain after a failed save until the user edits again', async t => {
  const configured = options();configured.bindings[0] = binding('TEXT', {kind: 'text'}, {type: 'string'}, {validateCandidate: () => [{message: 'private fixture data'}]});
  const f = await domFixture(t, 'common-only', seed(), {options: configured});await f.change('TEXT', 'after');
  assert.equal((await f.save()).status, 'invalid');assert.equal(f.session.getState().issues.length, 1);
  assert.ok(!f.container.textContent.includes('private fixture data'));assert.equal(f.session.getDraft().inputs.TEXT.value, 'after');
});

test('all readonly fields remain readonly even when their projection schema has defaults', async t => {
  const configured = options();configured.bindings.push(binding('EXTRA', {kind: 'text'}, {type: 'string', default: 'fabricated'}));
  const raw = seed();raw.EXTRA = {state: 'missing'};const f = await domFixture(t, 'common-only', raw, {options: configured});
  assert.equal(f.byLabel('EXTRA').tagName, 'OUTPUT');assert.deepEqual(f.session.getDraft().inputs.EXTRA, {readOnly: true});
  assert.equal((await f.save()).status, 'saved');assert.equal(Object.hasOwn(f.live.arguments, 'EXTRA'), false);
});

test('host-provided Japanese presentation messages apply without changing contracts or saved data', async t => {
  const messages = {reset: 'リセット', readOnly: 'この入力は編集できません。', unverified: '式の実行時の有効性は未検証です。', currentValue: '現在の値', colorPicker: '色を選択'};
  const f = await domFixture(t, 'CP-asset-cache', {PROPERTY: {literal: 'color'}, VALUE: {literal: '#AbC'}}, {messages});
  assert.equal(f.byLabel('VALUE リセット').textContent, 'リセット');assert.ok(f.byLabel('VALUE 色を選択'));
  assert.equal(f.byLabel('VALUE').value, '#AbC');assert.equal((await f.save()).status, 'saved');assert.equal(f.requests.length, 0);
  const raw = seed();raw.NUMBER = {reporter: {identity: 'never-evaluate'}};
  const readonly = await domFixture(t, 'common-only', raw, {options: options(), messages});
  assert.ok(readonly.container.textContent.includes(messages.readOnly));assert.ok(!readonly.container.textContent.includes('cannot be edited safely'));
  assert.equal(readonly.byLabel('NUMBER').textContent, '');assert.ok(readonly.container.textContent.includes(messages.unverified));
  assert.ok(!readonly.container.textContent.includes('Connected reporter'));
});

test('message providers run at mount and pick the current host locale on remount', async t => {
  let locale = 'en';let calls = 0;
  const messages = () => {calls++;return locale === 'ja' ? {reset: 'リセット'} : {reset: 'Reset'};};
  const f = await domFixture(t, 'CP-asset-cache', {PROPERTY: {literal: 'width'}, VALUE: {literal: '20'}}, {messages});
  assert.equal(calls, 1);assert.ok(f.byLabel('VALUE Reset'));await f.change('VALUE', '30');assert.equal(calls, 1);
  locale = 'ja';await f.unmount();await f.mount();assert.equal(calls, 2);assert.ok(f.byLabel('VALUE リセット'));
  assert.equal(f.byLabel('VALUE').value, '30');assert.equal((await f.save()).status, 'saved');assert.equal(f.live.arguments.VALUE.value, '30');
});

test('presentation message accessors and asynchronous providers fail before rendering or writing', async t => {
  let getterCalls = 0;
  const accessor = {};Object.defineProperty(accessor, 'reset', {enumerable: true, get() {getterCalls++;throw new Error('Must not run.');}});
  for (const messages of [() => accessor, () => Promise.reject(new Error('Private presentation rejection.'))]) {
    const {formFixture} = await import('./fixtures/fixed-form-fixture.ts');
    const f = formFixture('CP-asset-cache', {PROPERTY: {literal: 'width'}, VALUE: {literal: '20'}}, {messages});
    t.after(f.close);const container = document.createElement('div');
    assert.throws(() => f.session.mount(container), /Invalid fixed form messages/);
    assert.equal(f.session.getState().status, 'editing');assert.equal(f.requests.length, 0);assert.equal(container.childNodes.length, 0);
  }
  await Promise.resolve();assert.equal(getterCalls, 0);
});

test('invalid fixed inputs reference their own error while readonly descriptions remain independent', async t => {
  const f = await domFixture(t, 'common-only', seed(), {options: options()});await f.change('NUMBER', '1e');
  const control = f.byLabel('NUMBER');assert.equal(control.getAttribute('aria-invalid'), 'true');
  const errorId = control.getAttribute('aria-describedby');assert.ok(errorId);
  assert.equal(f.container.querySelector(`[id="${errorId}"]`).textContent, 'Check this value before saving.');
  const readonly = f.byLabel('CONDITION');const reasonId = readonly.getAttribute('aria-describedby');
  assert.notEqual(reasonId, errorId);assert.equal(readonly.hasAttribute('aria-invalid'), false);
  assert.equal(f.container.querySelector(`[id="${reasonId}"]`).textContent, 'This input cannot be edited safely.');
  await f.change('NUMBER', '20');assert.equal(control.hasAttribute('aria-invalid'), false);
  assert.equal(control.hasAttribute('aria-describedby'), false);assert.equal(f.container.querySelector(`[id="${errorId}"]`), null);
});

for (const locale of ['en', 'ja']) test(`hidden draft retention is explained in ${locale} without restoring the hidden control`, async t => {
  const inactiveDraft = locale === 'ja' ? '非表示の編集内容はこの画面で保持されます。非表示のまま保存しても反映されません。'
    : 'Hidden edits are retained in this dialog and will not be saved while hidden.';
  const f = await domFixture(t, 'CP-bubble-close', {TRIGGER: {literal: 'timeout'}, TIMEOUT: {literal: '10'}, CONDITION: {literal: 'ready'}}, {messages: {inactiveDraft}});
  assert.equal(f.container.querySelector('[data-fixed-inactive-draft]'), null);
  await f.change('TIMEOUT', '20');await f.change('TRIGGER', 'condition');
  assert.equal(f.byLabel('TIMEOUT'), undefined);assert.equal(f.container.querySelector('[data-fixed-inactive-draft]').textContent, inactiveDraft);
  assert.equal(f.session.getDraft().inputs.TIMEOUT.buffer, '20');await f.change('TRIGGER', 'timeout');
  assert.equal(f.byLabel('TIMEOUT').value, '20');assert.equal(f.container.querySelector('[data-fixed-inactive-draft]'), null);
  await f.change('TRIGGER', 'condition');assert.equal((await f.save()).status, 'saved');assert.equal(f.live.arguments.TIMEOUT.value, '10');
});

test('mount change and remount do not invoke owner context encoder or validator', async t => {
  let contexts = 0;let encodes = 0;let validations = 0;const configured = options();
  configured.validationContext = () => {contexts++;return {consumerId: 'common-fixture', nowMs: 0, settings: null};};
  configured.bindings[0] = binding('TEXT', {kind: 'text'}, {type: 'string'}, {encode: value => {encodes++;return value;}, validateCandidate: () => {validations++;return [];}});
  const f = await domFixture(t, 'common-only', seed(), {options: configured});await f.change('TEXT', 'after');await f.unmount();await f.mount();
  assert.equal(contexts, 0);assert.equal(encodes, 0);assert.equal(validations, 0);
  assert.equal((await f.save()).status, 'saved');assert.equal(contexts, 1);assert.equal(encodes, 1);assert.equal(validations, 1);
});

test('an enum projection alias displays its exact opening raw and keeps a no-op byte-identical', async t => {
  const configured = options();configured.bindings[2] = binding('CHOICE', {kind: 'enum', choices: [{value: 'one', label: 'First choice'}, {value: 'two', label: 'Second choice'}]}, {type: 'string', enum: ['one', 'two']}, {read: raw => String(raw).trim().toLowerCase()});
  const raw = seed();raw.CHOICE.literal = ' ONE ';const f = await domFixture(t, 'common-only', raw, {options: configured});
  assert.equal(f.byLabel('CHOICE').selectedOptions[0].textContent, 'First choice');
  const note = f.container.querySelector('[data-fixed-original-value]');assert.ok(note);assert.equal(note.querySelector('output').textContent, ' ONE ');
  assert.ok(f.byLabel('CHOICE').getAttribute('aria-describedby').split(' ').includes(note.id));
  assert.deepEqual(await f.save(), {status: 'saved', changed: false});assert.equal(f.requests.length, 0);assert.equal(f.live.arguments.CHOICE.value, ' ONE ');
});
