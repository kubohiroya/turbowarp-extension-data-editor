import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createBlockEditorService} from '../dist/rjsf.js';
import {decodeSource} from '../dist/codec.js';
import {documentEditorDefinitions, registerDocumentEditors} from '../examples/document-properties.ts';

for (const [format, value] of [
  ['json', ' {"text":"example","enabled":true,"extra":{"keep":1}}\n'],
  ['yaml', '# keep comment\ntext: example\nenabled: true\nextra: {keep: 1}\n']
]) {
  test(`standalone ${format} example preserves no-op/Cancel, validates edits and reopens`, async () => {
    const service = createBlockEditorService();
    const dispose = registerDocumentEditors(service.api);
    const definition = documentEditorDefinitions.find(item => item.format === format);
    const block = {targetId: 'target', blockId: 'document', opcode: definition.opcodes[0], revision: '1',
      arguments: {SOURCE: {kind: 'literal', value}}};
    let commits = 0;
    const host = {readBlock: () => block, commit: request => {
      assert.deepEqual(request.changes.map(item => item.argument), ['SOURCE']);
      commits++;
      block.arguments.SOURCE.value = request.changes[0].value;
    }};
    const unchanged = service.registry.open(block, host);
    assert.deepEqual(await unchanged.save(), {status: 'saved', changed: false});
    const cancelled = service.registry.open(block, host);
    cancelled.setDraft({data: {text: 'cancelled'}});
    cancelled.cancel();
    assert.equal(block.arguments.SOURCE.value, value);
    const session = service.registry.open(block, host);
    const original = session.getDraft().data;
    session.setDraft({data: {...original, enabled: 'wrong'}});
    assert.equal((await session.save()).status, 'invalid');
    assert.equal(commits, 0);
    const edited = {...original, text: '日本語「編集」', enabled: false};
    session.setDraft({data: edited});
    assert.deepEqual(await session.save(), {status: 'saved', changed: true});
    assert.equal(commits, 1);
    assert.deepEqual(decodeSource(block.arguments.SOURCE.value, format), edited);
    const reopened = service.registry.open(block, host);
    assert.deepEqual(reopened.getDraft().data, edited);
    assert.deepEqual(await reopened.save(), {status: 'saved', changed: false});
    assert.equal(commits, 1);
    dispose(); dispose();
    assert.equal(service.registry.resolve(block.opcode), undefined);
  });
  test(`standalone ${format} example does not insert defaults into an empty object`, async () => {
    const service = createBlockEditorService();
    const dispose = registerDocumentEditors(service.api);
    const definition = documentEditorDefinitions.find(item => item.format === format);
    const block = {targetId: 'target', blockId: 'empty', opcode: definition.opcodes[0], revision: '1',
      arguments: {SOURCE: {kind: 'literal', value: '{}'}}};
    const session = service.registry.open(block, {readBlock: () => block,
      commit: () => assert.fail('An unchanged empty object must not be committed.')});
    assert.deepEqual(session.getDraft(), {data: {}});
    assert.deepEqual(await session.save(), {status: 'saved', changed: false});
    dispose();
  });
}

test('optional example registration tolerates old hosts and disposes in reverse order once', () => {
  for (const api of [undefined, {}, {apiVersion: 2}, {apiVersion: 1}]) {
    assert.doesNotThrow(() => registerDocumentEditors(api)());
  }
  const calls = [];
  const dispose = registerDocumentEditors({apiVersion: 1,
    registerSchemaBundle: definition => () => calls.push(definition.format)});
  dispose(); dispose();
  assert.deepEqual(calls, ['yaml', 'json']);
});

test('optional example registration rolls back a partial failure', () => {
  let removed = 0;
  let registrations = 0;
  const failure = new Error('second registration');
  assert.throws(() => registerDocumentEditors({apiVersion: 1, registerSchemaBundle: () => {
    if (++registrations === 2) throw failure;
    return () => removed++;
  }}), error => error === failure);
  assert.equal(removed, 1);
});

test('example cleanup releases remaining editors even if one cleanup throws', () => {
  const removed = [];
  const dispose = registerDocumentEditors({apiVersion: 1, registerSchemaBundle: definition => () => {
    removed.push(definition.format);
    if (definition.format === 'yaml') throw new Error('cleanup');
  }});
  assert.throws(dispose, AggregateError);
  assert.deepEqual(removed, ['yaml', 'json']);
  assert.doesNotThrow(dispose);
});
