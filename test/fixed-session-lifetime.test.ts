import assert from 'node:assert/strict';
import test from 'node:test';
import {nativeFixture, nativeAvailable} from './fixtures/fixed-host-native.ts';

const nativeTest = (name, run) => test(name, {skip: nativeAvailable ? false : 'Supply BLOCK_EDITOR_GUI_ROOT for actual native scope lifetime.'}, run);
const open = f => {
  const session = f.registry.open(f.reference, f.host);
  assert(session);
  return session;
};
const numberDraft = (session, buffer, value = 20) => {
  const draft = session.getDraft();
  draft.inputs.NUMBER = {value, changed: true, buffer};
  session.setDraft(draft);
};

nativeTest('fixed target invalidation discards invalid buffers and reopening reads only project raw', async t => {
  const f = nativeFixture();t.after(() => f.close());
  const session = open(f);numberDraft(session, '1e', 1);
  assert.equal((await session.save()).status, 'invalid');
  assert.equal(session.getDraft().inputs.NUMBER.buffer, '1e');
  const target = f.vm.editingTarget;
  f.vm.editingTarget = {...target, id: 'other-target'};f.vm.emit('targetsUpdate');
  assert.equal(session.getState().status, 'disposed');assert.throws(() => session.getDraft(), /closed/);
  f.vm.editingTarget = target;f.vm.emit('targetsUpdate');
  const reopened = open(f);
  assert.equal(reopened.getDraft().inputs.NUMBER.value, 10);
  assert.equal(reopened.getDraft().inputs.NUMBER.buffer, undefined);
  assert.equal(f.vmValue('NUMBER'), '10');
  reopened.dispose();
});

nativeTest('fixed project generation invalidation discards drafts even when target and block IDs are reused', t => {
  const f = nativeFixture();t.after(() => f.close());
  const session = open(f);numberDraft(session, '20');
  f.vm.emit('workspaceUpdate');
  assert.equal(session.getState().status, 'disposed');assert.throws(() => session.getDraft(), /closed/);
  const reopened = open(f);assert.equal(reopened.getDraft().inputs.NUMBER.value, 10);reopened.dispose();
});

nativeTest('same-scope external value conflict retains the open fixed draft', async t => {
  const f = nativeFixture();t.after(() => f.close());
  const session = open(f);numberDraft(session, '20');
  const block = f.workspace.getBlockById('native-text');
  f.B.Events.disable();block.getField('TEXT').setValue('outside');f.B.Events.enable();
  f.workspace.fireChangeListener(new f.B.Events.Change(block, 'field', 'TEXT', 'old', 'outside'));
  assert.equal(session.getState().status, 'editing');
  assert.equal((await session.save()).status, 'conflict');
  assert.equal(session.getState().status, 'editing');assert.equal(session.getDraft().inputs.NUMBER.buffer, '20');
  assert.equal(f.vmValue('NUMBER'), '10');assert.equal(f.vmValue('TEXT'), 'outside');
  session.cancel();
});

nativeTest('disposing the native host closes fixed sessions and drops their draft', t => {
  const f = nativeFixture();t.after(() => f.close());
  const session = open(f);numberDraft(session, '1e', 1);f.host.dispose();
  assert.equal(session.getState().status, 'disposed');assert.throws(() => session.getDraft(), /closed/);
});

nativeTest('fixed pending commit is aborted and its draft discarded on scope invalidation', async t => {
  const f = nativeFixture();t.after(() => f.close());let request;let rejectCommit;
  const port = {...f.host.fixedInputs, commit: captured => {
    request = captured;
    return new Promise((_resolve, reject) => {rejectCommit = reject;});
  }};
  const host = {...f.host, fixedInputs: port};const session = f.registry.open(f.reference, host);
  numberDraft(session, '20');const saving = session.save();
  assert.equal(session.getState().status, 'saving');assert.equal(request.signal.aborted, false);
  f.vm.emit('workspaceUpdate');
  assert.equal(request.signal.aborted, true);assert.equal(session.getState().status, 'disposed');
  assert.throws(() => session.getDraft(), /closed/);rejectCommit(new Error('aborted scope'));
  assert.equal((await saving).status, 'conflict');assert.equal(session.getState().status, 'disposed');
  assert.equal(f.vmValue('NUMBER'), '10');
});

test('fixed presentation data is immutable and rejects malformed or executable results without invoking them', async () => {
  const {EditorRegistry} = await import('../dist/index.js');
  const snapshot = {targetId: 'target', blockId: 'block', opcode: 'owner_fixed', revision: '1',
    arguments: {VALUE: {kind: 'literal', value: 'old'}}, fixedContext: {
      contractId: 'owner.fixed', contractRevision: '1', generation: '1', readOnlyArguments: [], dependencies: [],
      inputs: {VALUE: {role: 'editable', source: 'shadow', identity: 'field', field: {blockId: 'shadow', name: 'TEXT', type: 'FieldTextInput'}}}
    }};
  let calls = 0;
  const outputs = [null, {}, {inputs: {}, branches: [], issues: [], get surprise() {calls++; return 'private';}},
    {get then() {calls++; return () => {};}}];
  const make = output => {
    const registry = new EditorRegistry();
    registry.registerFixed({apiVersion: 1, extensionId: 'owner', editorId: 'fixed', opcodes: ['owner_fixed'],
      editableArguments: ['VALUE'], readOnlyArguments: [], dependencies: [], contractId: 'owner.fixed', contractRevision: '1',
      saveContract: 'prepared-fixed-v1', read: () => ({}), validate: () => [], createPatch: () => [],
      readFixed: () => ({inputs: {VALUE: {value: 'old', changed: false}}}), describeFixed: () => output,
      prepareFixedSave: () => ({kind: 'ready', changes: [], context: {consumerId: 'owner', nowMs: 0, settings: null}})});
    return registry.open(snapshot, {readBlock: () => snapshot, commit() {}, fixedInputs: {
      capability: 'fixed-inputs-v1', readBlock: () => snapshot, commit() {}
    }});
  };
  for (const output of outputs) {
    const session = make(output);
    assert.throws(() => session.getFixedInputView(), /Invalid fixed input presentation/);session.dispose();
  }
  assert.equal(calls, 0);
  const external = {inputs: {VALUE: {state: 'editable', control: 'text'}}, issues: [], branches: []};
  const session = make(external);const result = session.getFixedInputView();
  assert(Object.isFrozen(result.inputs.VALUE));assert.throws(() => {result.inputs.VALUE.state = 'hidden';}, TypeError);
  external.inputs.VALUE.state = 'hidden';assert.equal(result.inputs.VALUE.state, 'editable');session.dispose();
});

nativeTest('fixed registration invalidation discards direct-registry drafts while unrelated registrations do not', t => {
  const f = nativeFixture();t.after(() => f.close());const session = open(f);numberDraft(session, '1e', 1);
  const removeOther = f.registry.register({apiVersion: 1, extensionId: 'unrelated', editorId: 'other', opcodes: ['unrelated_test'],
    editableArguments: ['TEXT'], read: () => ({}), validate: () => [], createPatch: () => []});
  removeOther();assert.equal(session.getState().status, 'editing');assert.equal(session.getDraft().inputs.NUMBER.buffer, '1e');
  f.remove();assert.equal(session.getState().status, 'disposed');assert.throws(() => session.getDraft(), /closed/);
  f.reregister();const reopened = open(f);assert.equal(reopened.getDraft().inputs.NUMBER.value, 10);
  assert.equal(reopened.getDraft().inputs.NUMBER.buffer, undefined);reopened.dispose();
});


test('failed fixed scope subscription construction releases its registration lifetime observer', async t => {
  const {EditorSession, createFixedInputEditor} = await import('../dist/index.js');
  const {formFixture} = await import('./fixtures/fixed-form-fixture.ts');
  const fixture = formFixture('common-only', {SELECTOR: {literal: 'known'}, DEPENDENT: {literal: 'old'}, INDEPENDENT: {literal: 'old'}});
  t.after(() => fixture.close());
  const definition = createFixedInputEditor(fixture.options);
  let registrations = 0;
  const subscribe = () => {registrations++;return () => {registrations--;};};
  for (const subscribeInvalidation of [() => {throw new Error('host subscription failed');}, () => null]) {
    const host = {...fixture.host, fixedInputs: {...fixture.port, subscribeInvalidation}};
    assert.throws(() => new EditorSession(definition, fixture.live, host, () => true, subscribe));
    assert.equal(registrations, 0);
  }
});
