import assert from 'node:assert/strict';
import test from 'node:test';
import {nativeFixture, nativeAvailable, flushNativeEvents} from './fixtures/fixed-host-native.ts';
const nativeTest = (name, run) => test(name, {skip: nativeAvailable ? false : 'Supply BLOCK_EDITOR_GUI_ROOT for native branch transactions.'}, run);
const options = inactive => ({dependencies: [{selector: 'DIRECT', dependents: ['NUMBER']}], branchPolicies: [{
  selector: 'DIRECT', cases: [{values: ['first'], activeDependents: ['NUMBER']},
    {values: ['second'], activeDependents: inactive ? [] : ['NUMBER'],
      requireOnSelectorChange: [{argument: 'CONDITION', rule: 'nonempty-string'}]}]
}]});

nativeTest('canonical branch changes commit together through real native fields VM and undo', async t => {
  const f = nativeFixture(options(false));t.after(() => f.close());
  const session = f.registry.open(f.reference, f.host);const draft = session.getDraft();
  draft.inputs.DIRECT = {value: 'second', changed: true};draft.inputs.NUMBER = {value: 20, changed: true, buffer: '20'};
  session.setDraft(draft);assert.deepEqual(await session.save(), {status: 'saved', changed: true});
  assert.equal(f.value('DIRECT'), 'second');assert.equal(f.vmValue('DIRECT'), 'second');
  assert.equal(f.value('NUMBER'), '20');assert.equal(f.vmValue('NUMBER'), '20');assert.equal(f.dirty(), 1);
  assert.equal(f.workspace.undoStack_.length, 2);assert.equal(f.workspace.undoStack_[0].group, f.workspace.undoStack_[1].group);
  f.workspace.undo(false);await flushNativeEvents();
  assert.equal(f.value('DIRECT'), 'first');assert.equal(f.vmValue('DIRECT'), 'first');assert.equal(f.vmValue('NUMBER'), '10');
  f.workspace.undo(true);await flushNativeEvents();assert.equal(f.vmValue('DIRECT'), 'second');assert.equal(f.vmValue('NUMBER'), '20');
});

nativeTest('native host rejects forged branch writes when readonly context is invalid', t => {
  const f = nativeFixture(options(false));t.after(() => f.close());
  f.B.Events.disable();f.workspace.getBlockById('native-condition').getField('TEXT').setValue('  ');f.B.Events.enable();
  f.blocks.getBlock('native-condition').fields.TEXT.value = '  ';
  const before = f.state();
  assert.throws(() => f.commit([{argument: 'DIRECT', value: 'second'}, {argument: 'NUMBER', value: '20'}]), /canonical branch/);
  assert.deepEqual(f.state(), before);
});

nativeTest('native host rejects inactive dependent patches while accepting a canonical selector and independent field', t => {
  const f = nativeFixture(options(true));t.after(() => f.close());const before = f.state();
  assert.throws(() => f.commit([{argument: 'DIRECT', value: 'second'}, {argument: 'NUMBER', value: '20'}]), /canonical branch/);
  assert.deepEqual(f.state(), before);
  f.commit([{argument: 'DIRECT', value: 'second'}, {argument: 'TEXT', value: 'outside-group'}]);
  assert.equal(f.vmValue('DIRECT'), 'second');assert.equal(f.vmValue('TEXT'), 'outside-group');assert.equal(f.vmValue('NUMBER'), '10');
});
