import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {nativeFixture, nativeAvailable, flushNativeEvents, guiRoot} from './fixtures/fixed-host-native.mjs';

const nativeTest = (name, fn) => test(name, {skip: nativeAvailable ? false : 'Supply BLOCK_EDITOR_GUI_ROOT for SB3 numeric primitive integration.'}, fn);
const require = createRequire(import.meta.url);

function fixture(t) {
  const f = nativeFixture();t.after(() => f.close());
  const {deserializeBlocks} = require(join(guiRoot, 'node_modules/scratch-vm/src/serialization/sb3.js'));
  const serialized = {parent: {opcode: 'motion_gotoxy', parent: null, next: null,
    inputs: {X: [1, [4, 10]], Y: [1, [4, 0]]}, fields: {}, shadow: false, topLevel: true}};
  deserializeBlocks(serialized);
  const number = Object.values(serialized).find(b => b.opcode === 'math_number' && b.fields.NUM.value === 10);
  assert(number);assert.equal(typeof number.fields.NUM.value, 'number');
  // Keep the fixture's actual Blockly connections and install the VM shadow produced by SB3.
  f.blocks._blocks['native-number'] = {...number, id: 'native-number', parent: 'native-root'};
  return f;
}

nativeTest('SB3 numeric primitives synchronize with native FieldNumber text and survive no-op save unchanged', async t => {
  const f = fixture(t);assert.equal(f.value('NUMBER'), '10');assert.equal(f.vmValue('NUMBER'), 10);
  const snapshot = f.host.readBlock(f.reference);assert(snapshot);assert.equal(snapshot.arguments.NUMBER.value, 10);
  const before = f.state();const session = f.registry.open(f.reference, f.host);assert(session);
  assert.equal(session.getDraft().inputs.NUMBER.value, 10);
  assert.deepEqual(await session.save(), {status: 'saved', changed: false});assert.deepEqual(f.state(), before);
  assert.equal(typeof f.vmValue('NUMBER'), 'number');
});

nativeTest('SB3-loaded numeric fields accept a placement candidate and preserve one native Undo/Redo group', async t => {
  const f = fixture(t);const session = f.registry.open(f.reference, f.host);const draft = session.getDraft();
  // The real UI encodes drag numbers to native string tokens, as the field contract requires.
  draft.inputs.NUMBER = {value: 25.5, changed: true, buffer: '25.5'};session.setDraft(draft);
  assert.deepEqual(await session.save(), {status: 'saved', changed: true});
  assert.equal(f.value('NUMBER'), '25.5');assert.equal(f.vmValue('NUMBER'), '25.5');
  assert.equal(new Set(f.workspace.undoStack_.map(e => e.group)).size, 1);
  f.workspace.undo(false);await flushNativeEvents();assert.equal(f.vmValue('NUMBER'), '10');
  f.workspace.undo(true);await flushNativeEvents();assert.equal(f.vmValue('NUMBER'), '25.5');
});

nativeTest('failed writes restore the original SB3 number primitive and native history exactly', t => {
  const f = fixture(t);const before = f.state();
  f.workspace.addChangeListener(event => {if (event.type === 'change') throw new Error('reject numeric write');});
  assert.throws(() => f.commit([{argument: 'NUMBER', value: '25'}]), /reject numeric write/);
  assert.deepEqual(f.state(), before);assert.equal(typeof f.vmValue('NUMBER'), 'number');
});

nativeTest('numeric mismatch and unrelated text/boolean coercions still fail closed', t => {
  const f = fixture(t);f.blocks.getBlock('native-number').fields.NUM.value = 11;
  assert.equal(f.host.readBlock(f.reference), null);
  f.blocks.getBlock('native-number').fields.NUM.value = '10';f.blocks.getBlock('native-text').fields.TEXT.value = 10;
  assert.equal(f.host.readBlock(f.reference), null);
  f.blocks.getBlock('native-text').fields.TEXT.value = 'old';f.blocks.getBlock('native-number').fields.NUM.value = true;
  assert.equal(f.host.readBlock(f.reference), null);
});
