import assert from 'node:assert/strict';
import {test} from 'node:test';
import {binding, formFixture} from './fixtures/fixed-form-fixture.ts';

const options = {apiVersion: 1, extensionId: 'commonfixture', editorId: 'fixed', opcodes: ['commonfixture_fixed'],
  contractId: 'common-fixture.ui', contractRevision: '1',
  validationContext: () => ({consumerId: 'common-fixture', nowMs: 0, settings: null}),
  bindings: [binding('NAME')]};
const open = (t, value, defaults) => {
  const f = formFixture('common-only', {NAME: {literal: value}}, {options, ...(defaults ? {defaults} : {})});
  t.after(() => f.close());
  return f;
};
const edit = (f, value) => {
  const draft = f.session.getDraft();
  f.session.setDraft({...draft, inputs: {...draft.inputs, NAME: {value, changed: true}}});
};

test('a block still at its defaults offers Save, which closes without writing', async t => {
  const f = open(t, 'hello', {NAME: 'hello'});
  assert.equal(f.session.getState().saveMode, 'save');
  assert.equal(f.session.getState().canSave, true);
  assert.equal((await f.session.save()).status, 'saved');
  assert.equal(f.requests.length, 0);
});

test('a block that differs from its defaults offers Update, enabled only after a change', async t => {
  const f = open(t, 'edited', {NAME: 'hello'});
  assert.equal(f.session.getState().saveMode, 'update');
  assert.equal(f.session.getState().unchanged, true);
  assert.equal(f.session.getState().canSave, false);
  edit(f, 'again');
  assert.equal(f.session.getState().unchanged, false);
  assert.equal(f.session.getState().canSave, true);
});

test('without defaults from the host, the save button keeps its old behaviour', t => {
  const f = open(t, 'edited');
  assert.equal(f.session.getState().saveMode, undefined);
  assert.equal(f.session.getState().canSave, true);
});

test('defaults that are not literals make the snapshot invalid', t => {
  assert.throws(() => open(t, 'x', {NAME: {nested: true}}));
});

test('single editors follow the same Save and Update rule', async () => {
  const {EditorRegistry} = await import('../dist/index.js');
  const {jsonPropertiesEditor} = await import('../examples/json-properties.ts');
  const registry = new EditorRegistry();
  registry.register(jsonPropertiesEditor);
  const open = (value, defaults) => {
    const block = {targetId: 'sprite', blockId: 'scene', opcode: 'story_scene', revision: '1',
      arguments: {PROPERTIES: {kind: 'literal', value}}, ...(defaults ? {defaults} : {})};
    return registry.open(block, {readBlock: () => block, commit: () => {}});
  };
  const fresh = open('{}', {PROPERTIES: '{}'});
  assert.equal(fresh.getState().saveMode, 'save');assert.equal(fresh.getState().canSave, true);
  const edited = open('{"duration":2}', {PROPERTIES: '{}'});
  assert.equal(edited.getState().saveMode, 'update');assert.equal(edited.getState().canSave, false);
  edited.setDraft({properties: '{"duration":3}'});
  assert.equal(edited.getState().canSave, true);
  edited.setDraft({properties: '{"duration":2}'});
  assert.equal(edited.getState().canSave, false, 'typing the saved value back counts as unchanged');
  assert.equal(open('{}').getState().saveMode, undefined);
  assert.throws(() => open('{}', {PROPERTIES: {}}));
});
