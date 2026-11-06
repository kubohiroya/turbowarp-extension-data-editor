import assert from 'node:assert/strict';
import {test} from 'node:test';
import {nativeAvailable, nativeFixture, flushNativeEvents} from './fixtures/fixed-host-native.ts';
import {createBlockEditorService} from '../dist/rjsf.js';

const nativeTest = (name, fn) => test(name, {skip: nativeAvailable ? false : 'Supply BLOCK_EDITOR_GUI_ROOT for actual ScratchBlocks/VM integration.'}, fn);
const fixture = (t, options) => {const f = nativeFixture(options); t.after(() => f.close()); return f;};
const changes = [{argument: 'TEXT', value: 'new'}, {argument: 'NUMBER', value: '25'}, {argument: 'MENU', value: 'second'},
  {argument: 'DIRECT', value: 'second'}, {argument: 'COLOR', value: '#445566'}];

nativeTest('native five field families map shadow and parent identities to actual VM fields', t => {
  const f = fixture(t);const snapshot = f.read();
  for (const name of ['TEXT', 'NUMBER', 'MENU', 'DIRECT', 'COLOR', 'CONDITION']) {
    assert.equal(snapshot.arguments[name].kind, 'literal');assert.equal(snapshot.arguments[name].value, f.value(name));assert.equal(f.value(name), f.vmValue(name));
  }
  assert.equal(snapshot.fixedContext.inputs.DIRECT.source, 'field');
  assert.equal(snapshot.fixedContext.inputs.DIRECT.field.blockId, f.block.id);
  assert.equal(snapshot.fixedContext.inputs.NUMBER.field.name, 'NUM');
  assert.equal(snapshot.fixedContext.inputs.MENU.field.name, 'CHOICE');
  assert.equal(snapshot.fixedContext.inputs.COLOR.field.name, 'COLOUR');
  assert.equal(snapshot.fixedContext.inputs.CONDITION.role, 'readonly');
});

nativeTest('native fixed capability and service registration remain default off', t => {
  const f = fixture(t, {enableFixedInputs: false});assert.equal(f.host.fixedInputs, undefined);
  assert.equal(Object.hasOwn(createBlockEditorService().api, 'registerFixedInputEditor'), false);
  assert.equal(f.registry.open(f.reference, f.host), undefined);
});

nativeTest('native five-field transaction produces exact VM events and one dirty notification', t => {
  const f = fixture(t);f.commit(changes);
  assert.equal(f.dirty(), 1);assert.equal(f.workspace.undoStack_.length, 5);
  assert.equal(new Set(f.workspace.undoStack_.map(event => event.group)).size, 1);
  for (const {argument, value} of changes) {assert.equal(f.value(argument), value);assert.equal(f.vmValue(argument), value);}
  const events = f.events.filter(event => event.type === 'change');assert.equal(events.length, 5);
  assert.deepEqual(events.map(event => [event.blockId, event.name]), [['native-text', 'TEXT'], ['native-number', 'NUM'],
    ['native-menu', 'CHOICE'], ['native-root', 'DIRECT'], ['native-color', 'COLOUR']]);
  assert.equal(f.value('CONDITION'), 'ready');assert.equal(f.B.Events.getGroup(), '');assert.equal(f.B.Events.isEnabled(), true);
});

nativeTest('native repeated saves retain independent grouped undo and redo with actual VM adapter', async t => {
  const f = fixture(t);f.commit([{argument: 'TEXT', value: 'one'}, {argument: 'DIRECT', value: 'second'}]);
  f.commit([{argument: 'TEXT', value: 'two'}, {argument: 'NUMBER', value: '30'}]);
  assert.equal(f.dirty(), 2);assert.equal(new Set(f.workspace.undoStack_.map(event => event.group)).size, 2);
  f.workspace.undo(false);await flushNativeEvents();assert.equal(f.value('TEXT'), 'one');assert.equal(f.vmValue('TEXT'), 'one');assert.equal(f.vmValue('NUMBER'), '10');
  f.workspace.undo(false);await flushNativeEvents();assert.equal(f.vmValue('TEXT'), 'old');assert.equal(f.vmValue('DIRECT'), 'first');
  f.workspace.undo(true);await flushNativeEvents();assert.equal(f.vmValue('TEXT'), 'one');assert.equal(f.vmValue('DIRECT'), 'second');
  f.workspace.undo(true);await flushNativeEvents();assert.equal(f.vmValue('TEXT'), 'two');assert.equal(f.vmValue('NUMBER'), '30');
});

nativeTest('native synchronous listener failure rolls back all fields VM stacks dirty and event state', t => {
  const f = fixture(t);const before = f.state();let seen = 0;
  f.workspace.addChangeListener(event => {if (event.type === 'change' && ++seen === 2) throw new Error('second event failure');});
  assert.throws(() => f.commit(changes), /second event failure/);assert.deepEqual(f.state(), before);
});

nativeTest('native abort during a change event restores previous VM and Blockly transaction', t => {
  const f = fixture(t);const before = f.state();const controller = new AbortController();
  f.workspace.addChangeListener(event => {if (event.type === 'change') controller.abort();});
  assert.throws(() => f.commit(changes, {signal: controller.signal}));assert.deepEqual(f.state(), before);
});

nativeTest('native read-only CONDITION drift and reporter replacement invalidate prepared snapshots', t => {
  const f = fixture(t);const expected = f.read();
  f.B.Events.disable();f.workspace.getBlockById('native-condition').getField('TEXT').setValue('changed');f.B.Events.enable();
  f.blocks.getBlock('native-condition').fields.TEXT.value = 'changed';
  assert.throws(() => f.commit([{argument: 'TEXT', value: 'bad'}], {expected}));assert.equal(f.value('TEXT'), 'old');assert.equal(f.dirty(), 0);
  f.B.Events.disable();const input = f.block.getInput('CONDITION');input.connection.disconnect();
  const reporter = f.workspace.newBlock('native_reporter');input.connection.connect(reporter.outputConnection);f.B.Events.enable();
  f.blocks.createBlock({id: reporter.id, opcode: 'native_reporter', inputs: {}, fields: {}, next: null, parent: f.block.id, shadow: false, topLevel: false});
  f.blocks.getBlock(f.block.id).inputs.CONDITION.block = reporter.id;
  let reporterFieldReads = 0;reporter.getField = () => {reporterFieldReads++;throw new Error('reporter field must not be evaluated');};
  const reporterSnapshot = f.read();assert.equal(reporterSnapshot.arguments.CONDITION.kind, 'reporter');
  assert.equal(reporterSnapshot.fixedContext.inputs.CONDITION.role, 'readonly');
  assert.throws(() => f.commit([{argument: 'CONDITION', value: 'bad'}]));assert.equal(reporterFieldReads, 0);
});

nativeTest('native stale canonical registration and changed target cannot commit', t => {
  const f = fixture(t);const expected = f.read();const declaration = f.declaration();f.remove();f.reregister();
  const replacement = f.host.fixedInputs.readBlock(f.reference, declaration);
  assert.ok(replacement);assert.notEqual(replacement.revision, expected.revision);
  assert.throws(() => f.commit([{argument: 'TEXT', value: 'bad'}], {expected}));
  const current = f.read();f.vm.editingTarget = {...f.vm.editingTarget};f.vm.emit('targetsUpdate');
  assert.throws(() => f.commit([{argument: 'TEXT', value: 'bad'}], {expected: current}));assert.equal(f.value('TEXT'), 'old');
});

nativeTest('native custom validator and dynamic dropdown callbacks are rejected without evaluation', t => {
  const f = fixture(t);let validators = 0;let menus = 0;
  const text = f.workspace.getBlockById('native-text').getField('TEXT');text.setValidator(() => {validators++;return 'unsafe';});
  const dropdown = f.block.getField('DIRECT');dropdown.menuGenerator_ = () => {menus++;return [['bad', 'bad']];};
  const snapshot = f.read();assert.notEqual(snapshot.fixedContext.inputs.TEXT.source, 'shadow');assert.equal(snapshot.fixedContext.inputs.DIRECT.source, 'unsupported');
  assert.throws(() => f.commit([{argument: 'TEXT', value: 'bad'}]));assert.throws(() => f.commit([{argument: 'DIRECT', value: 'bad'}]));
  assert.equal(validators, 0);assert.equal(menus, 0);assert.equal(f.value('TEXT'), 'old');
});

nativeTest('native dependency-group writes stay closed while independent writes preserve group raw', t => {
  const f = fixture(t, {dependencies: [{selector: 'DIRECT', dependents: ['TEXT']}]});
  assert.throws(() => f.commit([{argument: 'DIRECT', value: 'second'}]));assert.throws(() => f.commit([{argument: 'TEXT', value: 'bad'}]));
  f.commit([{argument: 'NUMBER', value: '22'}]);assert.equal(f.vmValue('NUMBER'), '22');assert.equal(f.vmValue('TEXT'), 'old');assert.equal(f.vmValue('DIRECT'), 'first');
});

nativeTest('native real VM adapter failure after its second mutation rolls back fields and stored VM data', t => {
  const f = fixture(t);const before = f.state();const changeBlock = f.blocks.changeBlock;let calls = 0;
  f.blocks.changeBlock = function (event) {changeBlock.call(this, event);if (++calls === 2) throw new Error('VM change failure');};
  assert.throws(() => f.commit(changes), /VM change failure/);assert.deepEqual(f.state(), before);
});

nativeTest('native registration replacement during event delivery rolls back the complete pending transaction', t => {
  const f = fixture(t);const before = f.state();let removed = false;
  f.workspace.addChangeListener(event => {if (event.type === 'change' && !removed) {removed = true;f.remove();f.reregister();}});
  assert.throws(() => f.commit(changes));assert.deepEqual(f.state(), before);
});

nativeTest('native legacy text editor still saves through the original host port with fixed capability disabled', async t => {
  const f = fixture(t, {enableFixedInputs: false});f.remove();
  f.registry.register({apiVersion: 1, extensionId: 'native', editorId: 'legacy', opcodes: ['native_fixed'], editableArguments: ['TEXT'],
    read: snapshot => ({text: snapshot.arguments.TEXT.value}), validate: () => [], createPatch: draft => [{argument: 'TEXT', value: draft.text}]});
  const session = f.registry.open(f.reference, f.host);assert.ok(session);session.setDraft({text: 'legacy'});
  assert.deepEqual(await session.save(), {status: 'saved', changed: true});assert.equal(f.value('TEXT'), 'legacy');assert.equal(f.vmValue('TEXT'), 'legacy');
  assert.equal(f.value('NUMBER'), '10');assert.equal(f.value('DIRECT'), 'first');assert.equal(f.host.fixedInputs, undefined);assert.equal(f.dirty(), 1);
});

nativeTest('native malformed number color and static menu candidates fail before any write', t => {
  const f = fixture(t);const before = f.state();
  for (const [argument, value] of [['NUMBER', '1e'], ['NUMBER', 'Infinity'], ['COLOR', 'invalid'], ['DIRECT', 'unknown'], ['MENU', 'unknown']]) {
    assert.throws(() => f.commit([{argument, value}]));assert.deepEqual(f.state(), before);
  }
});

nativeTest('native custom own field accessors remain unsupported and are never invoked', t => {
  const f = fixture(t);let calls = 0;const field = f.workspace.getBlockById('native-number').getField('NUM');
  Object.defineProperty(field, 'getValue', {configurable: true, get() {calls++;throw new Error('custom field getter must not run');}});
  const snapshot = f.read();assert.equal(snapshot.fixedContext.inputs.NUMBER.source, 'unsupported');
  assert.throws(() => f.commit([{argument: 'NUMBER', value: '20'}]));assert.equal(calls, 0);
  delete field.getValue;
});

nativeTest('native class prototype replacement is rejected without invoking the substituted setter', t => {
  const f = fixture(t);const before = f.state();const original = f.B.FieldNumber.prototype.setValue;let calls = 0;
  f.B.FieldNumber.prototype.setValue = function () {calls++;throw new Error('substituted setter must not run');};
  try {assert.throws(() => f.commit(changes));assert.deepEqual(f.state(), before);assert.equal(calls, 0);}
  finally {f.B.FieldNumber.prototype.setValue = original;}
});

nativeTest('native color setter internal failure restores raw color four block colors HSV VM and undo state', t => {
  const f = fixture(t);const before = f.state();const colorBlock = f.workspace.getBlockById('native-color');const original = colorBlock.setColour;let failures = 0;
  colorBlock.setColour = function (...colors) {original.apply(this, colors);if (colors[0] === '#445566') {failures++;assert.equal(f.value('COLOR'), '#445566');throw new Error('native color render failure');}};
  try {assert.throws(() => f.commit(changes), /native color render failure/);assert.deepEqual(f.state(), before);assert.equal(failures, 1);}
  finally {colorBlock.setColour = original;}
});

nativeTest('native next statement connection changes conflict even when Blockly events are disabled', t => {
  const f = fixture(t);f.B.Blocks.native_statement = {init() {this.appendDummyInput().appendField('statement');this.setPreviousStatement(true);this.setNextStatement(true);}};
  f.B.Events.disable();const first = f.workspace.newBlock('native_statement');const second = f.workspace.newBlock('native_statement');
  f.block.nextConnection.connect(first.previousConnection);f.B.Events.enable();
  for (const block of [first, second]) f.blocks.createBlock({id: block.id, opcode: block.type, fields: {}, inputs: {}, next: null, shadow: false, topLevel: block === second, parent: block === first ? f.block.id : null});
  f.blocks.getBlock(f.block.id).next = first.id;const expected = f.read();
  f.B.Events.disable();f.block.nextConnection.disconnect();f.block.nextConnection.connect(second.previousConnection);f.B.Events.enable();
  f.blocks.getBlock(f.block.id).next = second.id;f.blocks.getBlock(first.id).parent = null;f.blocks.getBlock(first.id).topLevel = true;
  f.blocks.getBlock(second.id).parent = f.block.id;f.blocks.getBlock(second.id).topLevel = false;
  const before = f.state();assert.throws(() => f.commit([{argument: 'TEXT', value: 'bad'}], {expected}));assert.deepEqual(f.state(), before);
});

nativeTest('native concurrent external readonly event keeps its own undo and dirty while editor writes roll back', async t => {
  const f = fixture(t);let external = false;
  f.workspace.addChangeListener(event => {
    if (event.type !== 'change' || external) return;
    external = true;const condition = f.workspace.getBlockById('native-condition');
    condition.getField('TEXT').setValue('outside');
    const outsideEvent = new f.B.Events.Change(condition, 'field', 'TEXT', 'ready', 'outside');
    outsideEvent.group = 'outside-group';f.workspace.fireChangeListener(outsideEvent);
  });
  assert.throws(() => f.commit([{argument: 'TEXT', value: 'editor'}]));
  assert.equal(f.value('TEXT'), 'old');assert.equal(f.vmValue('TEXT'), 'old');
  assert.equal(f.value('CONDITION'), 'outside');assert.equal(f.vmValue('CONDITION'), 'outside');
  assert.equal(f.dirty(), 1);assert.equal(f.workspace.undoStack_.length, 1);
  assert.equal(f.workspace.undoStack_[0].blockId, 'native-condition');assert.equal(f.workspace.undoStack_[0].group, 'outside-group');
  f.workspace.undo(false);await flushNativeEvents();assert.equal(f.value('CONDITION'), 'ready');assert.equal(f.vmValue('CONDITION'), 'ready');
  assert.equal(f.value('TEXT'), 'old');assert.equal(f.vmValue('TEXT'), 'old');
});

for (const [argument, fieldId, fieldName, editorValue, outsideValue, openingValue] of [
  ['TEXT', 'native-text', 'TEXT', 'editor', 'outside', 'old'],
  ['COLOR', 'native-color', 'COLOUR', '#445566', '#abcdef', '#112233']
]) nativeTest(`native external ${argument} write survives rollback and undo never revives the aborted editor value`, async t => {
  const f = fixture(t);let external = false;
  f.workspace.addChangeListener(event => {
    if (event.type !== 'change' || external) return;
    external = true;const block = f.workspace.getBlockById(fieldId);const field = block.getField(fieldName);const oldValue = field.getValue();
    field.setValue(outsideValue);const outsideEvent = new f.B.Events.Change(block, 'field', fieldName, oldValue, outsideValue);
    outsideEvent.group = 'outside-group';f.workspace.fireChangeListener(outsideEvent);
  });
  assert.throws(() => f.commit([{argument, value: editorValue}, {argument: 'NUMBER', value: '20'}]));
  assert.equal(f.value(argument), outsideValue);assert.equal(f.vmValue(argument), outsideValue);
  assert.equal(f.value('NUMBER'), '10');assert.equal(f.vmValue('NUMBER'), '10');
  assert.equal(f.dirty(), 1);assert.equal(f.workspace.undoStack_.length, 1);
  assert.equal(f.workspace.undoStack_[0].blockId, fieldId);assert.equal(f.workspace.undoStack_[0].oldValue, openingValue);
  assert.equal(f.workspace.undoStack_[0].newValue, outsideValue);assert.equal(f.workspace.undoStack_[0].group, 'outside-group');
  if (argument === 'COLOR') assert.equal(f.workspace.getBlockById(fieldId).getColour(), outsideValue);
  f.workspace.undo(false);await flushNativeEvents();assert.equal(f.value(argument), openingValue);assert.equal(f.vmValue(argument), openingValue);
  f.workspace.undo(true);await flushNativeEvents();assert.equal(f.value(argument), outsideValue);assert.equal(f.vmValue(argument), outsideValue);
  assert.notEqual(f.value(argument), editorValue);assert.equal(f.value('NUMBER'), '10');
});
