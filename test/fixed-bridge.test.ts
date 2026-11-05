import assert from 'node:assert/strict';
import {test} from 'node:test';
import {attachTurboWarpBlockEditors, openBlockEditorSession} from '../dist/turbowarp.js';
import {FIXED_INPUTS_CAPABILITY, DESCENDANT_EDITING_CAPABILITY} from '../dist/index.js';
import {nativeFixture, nativeAvailable} from './fixtures/fixed-host-native.ts';

test('fixed roots use a single session even when descendants are enabled', () => {
  let single = 0;let aggregate = 0;
  const registry = {resolveFixed: opcode => opcode === 'fixed' ? {} : undefined,
    open: () => {single++;return 'fixed';}, openDescendants: () => {aggregate++;throw new Error('No fallback');}};
  const host = {readBlock: () => ({opcode: 'fixed'}),
    descendants: {capability: DESCENDANT_EDITING_CAPABILITY, readSubtree() {}, commitSubtree() {}},
    fixedInputs: {capability: FIXED_INPUTS_CAPABILITY, readBlock() {}, commit() {}}};
  assert.equal(openBlockEditorSession({registry, host, reference: {targetId: 't', blockId: 'b'}, descendants: true}), 'fixed');
  assert.equal(single, 1);assert.equal(aggregate, 0);
  delete host.fixedInputs;
  assert.equal(openBlockEditorSession({registry, host, reference: {targetId: 't', blockId: 'b'}, descendants: true}), undefined);
  assert.equal(single, 1);assert.equal(aggregate, 0);
});

test('legacy aggregate errors remain fail-closed after fixed support is enabled', () => {
  let singles = 0;
  const registry = {resolveFixed: () => undefined, open: () => {singles++;}, openDescendants: () => {throw new Error('fixed descendant');}};
  const host = {readBlock: () => ({opcode: 'legacy'}),
    descendants: {capability: DESCENDANT_EDITING_CAPABILITY, readSubtree() {}, commitSubtree() {}}};
  assert.throws(() => openBlockEditorSession({registry, host, reference: {targetId: 't', blockId: 'b'}, descendants: true}), /fixed descendant/);
  assert.equal(singles, 0);
});

function nativeBridge(t, {fixedInputs = true, descendants = false, reporter = false} = {}) {
  const f = nativeFixture();
  const {B, block, workspace, dom} = f;
  B.Events.disable();
  const icon = new B.FieldImage('data:image/svg+xml,<svg/>', 40, 40, '');
  block.appendDummyInput('ICON').appendField(icon);block.moveInputBefore('ICON', 'TEXT');
  if (reporter) {
    block.getInput('CONDITION').connection.targetBlock().dispose();
    const connected = workspace.newBlock('native_reporter', 'condition-reporter');
    block.getInput('CONDITION').connection.connect(connected.outputConnection);
    const dirty = f.runtime.emitProjectChanged;
    f.runtime.emitProjectChanged = () => {};
    try {f.blocks.createBlock({id: connected.id, opcode: connected.type, parent: block.id, next: null, shadow: false,
      topLevel: false, fields: {}, inputs: {}});} finally {f.runtime.emitProjectChanged = dirty;}
    f.blocks.getBlock(block.id).inputs.CONDITION = {name: 'CONDITION', block: connected.id, shadow: null};
  }
  B.Events.enable();
  icon.fieldGroup_ = dom.window.document.createElement('div');icon.imageElement_ = {tooltip: 'original'};
  icon.setTooltip = value => {icon.imageElement_.tooltip = value;};
  B.hideChaff = () => {};
  let session;
  let appearances;
  const listeners = new Set();
  const service = {registry: f.registry, subscribe: listener => {listeners.add(listener);return () => listeners.delete(listener);}};
  const bridge = attachTurboWarpBlockEditors({enabled: true, fixedInputs, descendants, ScratchBlocks: B, workspace, vm: f.vm,
    service, label: 'Edit', canOpen: () => true, onOpen: (value, labels, metadata) => {
      session = value;appearances = metadata;
    }, onError: error => {throw error;}});
  t.after(() => {bridge.dispose();f.close();});
  return {...f, bridge, icon, session: () => session, appearances: () => appearances,
    registrationChanged: () => {for (const listener of listeners) listener();},
    open: () => icon.fieldGroup_.dispatchEvent(new dom.window.KeyboardEvent('keydown', {key: 'Enter', bubbles: true, cancelable: true}))};
}

test('native bridge opens fixed readonly reporters as a single session beside descendants', {skip: !nativeAvailable}, t => {
  const f = nativeBridge(t, {reporter: true, descendants: true});
  f.open();
  assert.ok(f.session());assert.equal(f.session().getState().status, 'editing');
  assert.equal(typeof f.session().getNodes, 'undefined');
  assert.equal(f.session().getDraft().inputs.TEXT.value, 'old');
});

test('fixed opt-in OFF blocks opening without removing legacy decoration behavior', {skip: !nativeAvailable}, t => {
  const f = nativeBridge(t, {fixedInputs: false});
  f.open();assert.equal(f.session(), undefined);assert.equal(f.dirty(), 0);
});

test('native bridge includes readonly identifiers and excludes registered editor values from labels', {skip: !nativeAvailable}, t => {
  const f = nativeBridge(t);const before = f.state();
  f.open();
  assert.equal(f.appearances()[f.block.id].name, 'first (ready)');
  assert.deepEqual(f.state(), before);
});

test('native bridge target changes and registration removal discard fixed sessions', {skip: !nativeAvailable}, t => {
  const f = nativeBridge(t);f.open();assert.ok(f.session());
  f.vm.editingTarget = null;f.vm.emit('targetsUpdate');assert.equal(f.session().getState().status, 'disposed');
  assert.equal(f.dirty(), 0);
});

test('native bridge retains same-target conflict drafts and ignores unrelated registration notifications', {skip: !nativeAvailable}, async t => {
  const f = nativeBridge(t);f.open();
  const session = f.session();
  const draft = session.getDraft();draft.inputs.TEXT = {value: 'unsaved', changed: true};session.setDraft(draft);
  f.registrationChanged();assert.equal(session.getState().status, 'editing');
  f.B.Events.disable();f.workspace.getBlockById('native-text').getField('TEXT').setValue('external');f.B.Events.enable();
  f.blocks.getBlock('native-text').fields.TEXT.value = 'external';
  f.vm.emit('targetsUpdate');
  assert.equal(session.getState().status, 'editing');
  assert.equal((await session.save()).status, 'conflict');
  assert.equal(session.getDraft().inputs.TEXT.value, 'unsaved');
  assert.equal(f.dirty(), 0);
});

test('native bridge closes a fixed draft when its canonical registration is removed', {skip: !nativeAvailable}, t => {
  const f = nativeBridge(t);f.open();const session = f.session();
  f.remove();f.registrationChanged();
  assert.equal(session.getState().status, 'disposed');assert.equal(f.dirty(), 0);
});
