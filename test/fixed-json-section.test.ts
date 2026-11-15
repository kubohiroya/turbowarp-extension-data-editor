import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {domFixture} from './fixtures/fixed-form-dom.ts';
import {createFixedInputEditor} from '../dist/fixed-input-editor.js';
const {act, Simulate} = createRequire(import.meta.url)('react-dom/test-utils');
import {binding} from './fixtures/fixed-form-fixture.ts';

// A JSON input that holds either a schema name (plain text) or a JSON Schema (JSON text).
const readSchema = value => {
  if (typeof value !== 'string') throw new TypeError();
  try {return JSON.parse(value);} catch {return value;}
};
const encodeSchema = value => typeof value === 'string' ? value : JSON.stringify(value);
const schemaBinding = (extra = {}) => binding('SCHEMA', {kind: 'json', basic: 'json-schema'},
  {anyOf: [{type: 'string', minLength: 1}, {type: 'object'}]},
  {read: readSchema, encode: encodeSchema, listNames: () => ['Player', 'Scored'], ...extra});
const options = (extra = {}) => ({apiVersion: 1, extensionId: 'commonfixture', editorId: 'fixed', opcodes: ['commonfixture_fixed'],
  contractId: 'common-fixture.ui', contractRevision: '1', readOnlyArguments: ['CONDITION'],
  validationContext: () => ({consumerId: 'common-fixture', nowMs: 0, settings: null}),
  bindings: [binding('EXPORT', {kind: 'enum', choices: [{value: 'none'}, {value: 'tool'}]}, {type: 'string', enum: ['none', 'tool']}),
    schemaBinding(extra)]});
const seed = schema => ({EXPORT: {literal: 'none'}, SCHEMA: {literal: schema}, CONDITION: {literal: 'ready'}});
const BASIC = '{"type":"object","properties":{"a":{"type":"number"}},"required":["a"]}';

const status = f => f.container.querySelector('[data-fixed-json-status]').getAttribute('data-fixed-json-status');
const mode = f => f.container.querySelector('[data-fixed-json-mode]').getAttribute('data-fixed-json-mode');
const tab = (f, name) => [...f.container.querySelectorAll('[role="tab"]')].find(item => item.textContent === name);
const typeExpert = async (f, text) => {
  const area = f.container.querySelector('.block-editor-fixed-json textarea');
  await act(async () => Simulate.change(area, {target: {value: text}}));
};

test('a json control opens in the mode its value fits and shows a ready mark', async t => {
  const basic = await domFixture(t, 'common-only', seed(BASIC), {options: options()});
  assert.equal(mode(basic), 'basic');assert.equal(status(basic), 'ready');
  assert.ok(basic.container.querySelector('.block-editor-fixed-json [id^="block-editor-json-"]'), 'the basic form is rendered');
  const named = await domFixture(t, 'common-only', seed('Scored'), {options: options()});
  assert.equal(mode(named), 'name');
  const expert = await domFixture(t, 'common-only', seed('{"type":"object","properties":{"a":{"oneOf":[]}}}'), {options: options()});
  assert.equal(mode(expert), 'expert');
});

test('expert text saves as one literal, and unparsable text blocks saving', async t => {
  const f = await domFixture(t, 'common-only', seed(BASIC), {options: options()});
  await act(async () => Simulate.click(tab(f, 'Expert')));assert.equal(mode(f), 'expert');
  await typeExpert(f, '{"type": "object", "properties": {');
  assert.equal(status(f), 'attention');assert.equal(f.session.getState().canSave, false);
  assert.equal((await f.save()).status, 'invalid');assert.equal(f.requests.length, 0);
  await typeExpert(f, '{"type": "object"}');
  assert.equal(status(f), 'ready');assert.equal(f.session.getState().canSave, true);
  assert.deepEqual(await f.save(), {status: 'saved', changed: true});
  assert.deepEqual(f.requests[0].changes, [{argument: 'SCHEMA', value: '{"type":"object"}'}]);
});

test('the name mode lists the owner names and saves the name as plain text', async t => {
  const f = await domFixture(t, 'common-only', seed('Scored'), {options: options()});
  const select = f.container.querySelector('.block-editor-fixed-json select');
  assert.deepEqual([...select.options].map(option => option.value), ['Player', 'Scored']);
  await act(async () => Simulate.change(select, {target: {value: 'Player'}}));
  assert.deepEqual(await f.save(), {status: 'saved', changed: true});
  assert.deepEqual(f.requests[0].changes, [{argument: 'SCHEMA', value: 'Player'}]);
});

test('a value the basic form cannot hold is shown read-only there', async t => {
  const f = await domFixture(t, 'common-only', seed('{"type":"object","properties":{"a":{"oneOf":[]}}}'), {options: options()});
  await act(async () => Simulate.click(tab(f, 'Basic')));
  assert.ok(f.container.querySelector('.block-editor-fixed-json-unfit'));
  assert.equal(f.session.getDraft().inputs.SCHEMA.changed, false);
});

test('listNames and basic are refused on controls that are not json', () => {
  const base = options();
  assert.throws(() => createFixedInputEditor({...base, bindings: [binding('X', {kind: 'text'}, {type: 'string'}, {listNames: () => []})]}));
  assert.throws(() => createFixedInputEditor({...base, bindings: [binding('X', {kind: 'text', basic: 'json-schema'})]}));
});
