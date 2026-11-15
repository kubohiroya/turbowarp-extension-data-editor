import assert from 'node:assert/strict';
import {test} from 'node:test';
import {nativeFixture, nativeAvailable} from './fixtures/fixed-host-native.ts';

test('the TurboWarp host reads each input default from the extension block info', {skip: !nativeAvailable}, t => {
  const f = nativeFixture();
  t.after(() => f.close());
  assert.equal(f.read().defaults, undefined, 'no block info, no defaults');
  f.runtime._blockInfo = [{id: 'other', blocks: []}, {id: 'native', blocks: [
    {info: {opcode: 'other', arguments: {}}},
    {info: {opcode: 'fixed', arguments: {TEXT: {defaultValue: 'old'}, NUMBER: {defaultValue: 10}, MENU: {}}}}
  ]}];
  assert.deepEqual({...f.read().defaults}, {TEXT: 'old', NUMBER: 10, MENU: ''});
});

test('the legacy TurboWarp host reports defaults for single editors too', {skip: !nativeAvailable}, async t => {
  const {createTurboWarpBlockEditorHost} = await import('../dist/turbowarp.js');
  const f = nativeFixture({enableFixedInputs: false});
  t.after(() => f.close());
  f.remove();
  const {jsonPropertiesEditor} = await import('../examples/json-properties.ts');
  f.registry.register({...jsonPropertiesEditor, extensionId: 'native', opcodes: ['native_fixed']});
  f.runtime._blockInfo = [{id: 'native', blocks: [{info: {opcode: 'fixed', arguments: {TEXT: {defaultValue: 'old'}, NUMBER: {defaultValue: 10}}}}]}];
  const host = createTurboWarpBlockEditorHost({ScratchBlocks: f.B, workspace: f.workspace, vm: f.vm, registry: f.registry, onError: error => {throw error;}});
  t.after(() => host.dispose());
  assert.deepEqual({...host.readBlock(f.reference).defaults}, {TEXT: 'old', NUMBER: 10});
});
