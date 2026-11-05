import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createBlockEditorService} from '../dist/rjsf.js';

const schemaDefinition = () => ({
  apiVersion: 1, extensionId: 'story', editorId: 'schema', opcodes: ['story_scene'],
  argument: 'PROPERTIES', schema: {
    type: 'object', properties: {duration: {type: 'number', minimum: 1}},
    required: ['duration'], additionalProperties: false
  }
});

test('services isolate registrations and emit once per register or active removal', () => {
  const first = createBlockEditorService();
  const second = createBlockEditorService();
  assert.equal(first.api.apiVersion, 1);
  assert.ok(Object.isFrozen(first.api));
  let updates = 0;
  const stop = first.subscribe(() => { updates++; });
  const remove = first.api.registerSchema(schemaDefinition());
  assert.equal(updates, 1);
  assert.ok(first.registry.resolve('story_scene'));
  assert.equal(second.registry.resolve('story_scene'), undefined);
  remove();
  remove();
  assert.equal(updates, 2);
  assert.equal(first.registry.resolve('story_scene'), undefined);
  stop();
  first.api.registerSchema(schemaDefinition())();
  assert.equal(updates, 2);
});

test('schema-only registration validates and serializes without a mounted UI', async () => {
  const service = createBlockEditorService();
  service.api.register(schemaDefinition());
  const block = {targetId: 'sprite', blockId: 'scene', opcode: 'story_scene', revision: '1',
    arguments: {PROPERTIES: {kind: 'literal', value: '{"duration":2}'}}};
  let commits = 0;
  const session = service.registry.open(block, {readBlock: () => block, commit: request => {
    commits++;
    block.arguments.PROPERTIES.value = request.changes[0].value;
  }});
  session.setDraft({data: {duration: 0}});
  assert.equal((await session.save()).status, 'invalid');
  assert.equal(commits, 0);
  session.setDraft({data: {duration: 9}});
  assert.equal((await session.save()).status, 'saved');
  assert.equal(commits, 1);
  assert.deepEqual(JSON.parse(block.arguments.PROPERTIES.value), {duration: 9});
});

test('invalid or duplicate registrations leave the service unchanged without notifying', () => {
  const service = createBlockEditorService();
  let updates = 0;
  service.subscribe(() => { updates++; });
  assert.throws(() => service.api.register({...schemaDefinition(), schema: {type: 'invalid'}}),
    /Invalid or unsupported JSON Schema/);
  assert.equal(updates, 0);
  assert.equal(service.registry.resolve('story_scene'), undefined);
  const remove = service.api.registerSchema(schemaDefinition());
  assert.throws(() => service.api.registerSchema(schemaDefinition()), /already registered/);
  assert.equal(updates, 1);
  remove();
  assert.equal(updates, 2);
});

test('custom mounts take precedence over schema detection and remain responsible for their view', () => {
  const service = createBlockEditorService();
  assert.throws(() => service.api.register({apiVersion: 1}), /provide mount/);
  const body = {};
  let released = 0;
  const remove = service.api.register({
    ...schemaDefinition(), schema: {type: 'invalid'}, editableArguments: ['PROPERTIES'],
    read: () => ({}), validate: () => [], createPatch: () => [],
    mount: container => {
      assert.equal(container, body);
      return () => { released++; };
    }
  });
  const block = {targetId: 'sprite', blockId: 'scene', opcode: 'story_scene', revision: '1', arguments: {}};
  const session = service.registry.open(block, {readBlock: () => block, commit: () => {}});
  const unmount = session.mount(body);
  unmount();
  unmount();
  assert.equal(released, 1);
  session.dispose();
  remove();
});
