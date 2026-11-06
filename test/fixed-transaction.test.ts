import test from 'node:test';
import assert from 'node:assert/strict';
import {createTurboWarpBlockEditorHost} from '../dist/turbowarp.js';
import {captureFixedInputDeclaration} from '../dist/fixed-input-snapshot.js';

function fixture({grouped = false, enableFixedInputs = true, fixedRegistration = true} = {}) {
  class FieldTextInput {
    constructor(value, name = 'TEXT') { this.value_ = value; this.name = name; this.validator_ = null; }
    getValue() { return this.value_; }
    setValue(value) { if (this.beforeSet) this.beforeSet(value); this.value_ = value; }
    getValidator() { return null; }
  }
  class FieldNumber extends FieldTextInput {}
  class FieldDropdown extends FieldTextInput {}
  class FieldColourSlider extends FieldTextInput {}
  let group = ''; let enabled = true;
  class Change {
    constructor(block, element, name, oldValue, newValue) {
      Object.assign(this, {blockId: block.id, element, name, oldValue, newValue, type: 'change',
        recordUndo: true, group});
    }
  }
  const Events = {recordUndo: true, Change, getGroup: () => group, setGroup: value => { group = value === true ? 'fixed-group' : value || ''; },
    isEnabled: () => enabled, disable: () => { enabled = false; }, enable: () => { enabled = true; }};
  const ScratchBlocks = {FieldTextInput, FieldNumber, FieldDropdown, FieldColourSlider, Events};
  const fields = {}; const blocks = new Map(); const vmBlocks = new Map();
  const parent = {id: 'parent', type: 'example_set', isInFlyout: false, isShadow: () => false,
    isEditable: () => true, getParent: () => null, getField: () => null, inputList: [],
    getInput: name => parent.inputList.find(input => input.name === name)};
  blocks.set(parent.id, parent);
  vmBlocks.set(parent.id, {id: parent.id, opcode: parent.type, parent: null, fields: {}, inputs: {}});
  for (const name of ['A', 'B', 'READ']) {
    const field = new FieldTextInput(name === 'A' ? 'old-a' : name === 'B' ? 'old-b' : 'read');
    fields[name] = field;
    const shadow = {id: name, type: 'text', isShadow: () => true, getField: fieldName => fieldName === 'TEXT' ? field : null,
      inputList: [{fieldRow: [field]}]};
    blocks.set(name, shadow);
    vmBlocks.set(name, {id: name, opcode: 'text', fields: {TEXT: {name: 'TEXT', value: field.getValue()}}, parent: parent.id});
    parent.inputList.push({name, connection: {targetBlock: () => shadow}});
    vmBlocks.get(parent.id).inputs[name] = {name, block: name, shadow: name};
  }
  const declarationInput = {contractId: 'example-contract', contractRevision: '1', editableArguments: ['A', 'B'],
    readOnlyArguments: ['READ'], dependencies: grouped ? [{selector: 'A', dependents: ['B']}] : []};
  let canonical = captureFixedInputDeclaration(declarationInput);
  const registry = {resolve: () => ({extensionId: 'example', editableArguments: ['A', 'B']}), resolveFixed: () => fixedRegistration ? canonical : undefined};
  const workspaceListeners = [];
  const workspace = {options: {readOnly: false}, isFlyout: false, undoStack_: ['old-undo'], redoStack_: ['old-redo'],
    getBlockById: id => blocks.get(id), addChangeListener: listener => workspaceListeners.push(listener),
    removeChangeListener: listener => workspaceListeners.splice(workspaceListeners.indexOf(listener), 1),
    fireChangeListener: event => {
      if (event.recordUndo) { workspace.undoStack_.push(event); workspace.redoStack_.length = 0; }
      for (const listener of [...workspaceListeners]) listener(event);
    }};
  let dirty = 0; const vmListeners = new Map(); const events = [];
  const target = {id: 'target', blocks: {getBlock: id => vmBlocks.get(id), resetCache() {},
    blocklyListen(event) {
      vmBlocks.get(event.blockId).fields[event.name].value = event.newValue;
      events.push(event);
      vm.runtime.emitProjectChanged();
    }}};
  const vm = {editingTarget: target, runtime: {emitProjectChanged: () => { dirty++; }},
    on: (name, listener) => { vmListeners.set(name, [...(vmListeners.get(name) || []), listener]); },
    removeListener: (name, listener) => vmListeners.set(name, (vmListeners.get(name) || []).filter(item => item !== listener))};
  workspace.addChangeListener(event => target.blocks.blocklyListen(event));
  const host = createTurboWarpBlockEditorHost({ScratchBlocks, workspace, vm, registry, enableFixedInputs});
  const reference = {targetId: target.id, blockId: parent.id};
  const read = () => host.fixedInputs.readBlock(reference, canonical);
  const save = (expected, changes, signal = new AbortController().signal) => host.fixedInputs.commit({expected, changes,
    signal, context: {consumerId: 'test', nowMs: 0, settings: null}});
  const state = () => ({a: fields.A.getValue(), b: fields.B.getValue(), va: vmBlocks.get('A').fields.TEXT.value,
    vb: vmBlocks.get('B').fields.TEXT.value, undo: [...workspace.undoStack_], redo: [...workspace.redoStack_], dirty,
    group: Events.getGroup(), enabled: Events.isEnabled(), committing: host.isCommitting()});
  return {ScratchBlocks, host, workspace, vm, target, vmBlocks, blocks, fields, registry, reference, read, save, state,
    declarationInput, get canonical() {return canonical;}, reregister: () => {canonical = captureFixedInputDeclaration(declarationInput);},
    emit: name => {for (const listener of vmListeners.get(name) || []) listener();}, events};
}

test('fixed native host is explicitly enabled and legacy host remains unchanged', () => {
  const old = fixture({enableFixedInputs: false});
  assert.equal(old.host.fixedInputs, undefined);
  assert.equal(old.host.readBlock(old.reference), null);
  old.host.dispose();
  const legacy = fixture({enableFixedInputs: false, fixedRegistration: false});
  assert.equal(legacy.host.readBlock(legacy.reference).arguments.A.kind, 'literal');
  legacy.host.dispose();
});

test('fixed host captures readonly dependencies and applies all actual field events in one undo group', () => {
  const f = fixture(); const snapshot = f.read();
  assert.equal(snapshot.fixedContext.inputs.READ.role, 'readonly');
  f.save(snapshot, [{argument: 'A', value: 'new-a'}, {argument: 'B', value: 'new-b'}]);
  const state = f.state();
  assert.deepEqual([state.a, state.b, state.va, state.vb, state.dirty], ['new-a', 'new-b', 'new-a', 'new-b', 1]);
  assert.equal(state.undo.length, 3); assert.equal(state.redo.length, 0);
  assert.deepEqual(f.events.map(e => [e.blockId, e.name, e.group]), [['A', 'TEXT', 'fixed-group'], ['B', 'TEXT', 'fixed-group']]);
  assert.equal(state.group, ''); assert.equal(state.enabled, true); assert.equal(state.committing, false);
  f.host.dispose();
});

test('readonly forged declarations and patches are rejected before any write', () => {
  const f = fixture(); const before = f.state(); const snapshot = f.read();
  assert.equal(f.host.fixedInputs.readBlock(f.reference, {...f.declarationInput, readOnlyArguments: []}), null);
  assert.throws(() => f.save(snapshot, [{argument: 'A', value: 'new'}, {argument: 'READ', value: 'forged'}]), TypeError);
  const forged = structuredClone(snapshot); forged.fixedContext.inputs.READ.role = 'editable'; forged.fixedContext.readOnlyArguments = [];
  assert.throws(() => f.save(forged, [{argument: 'READ', value: 'forged'}]));
  assert.deepEqual(f.state(), before); f.host.dispose();
});

test('readonly raw changes and canonical re-registration conflict without partial writes', () => {
  for (const change of [f => {f.fields.READ.setValue('outside'); f.vmBlocks.get('READ').fields.TEXT.value = 'outside';},
    f => f.reregister(), f => f.emit('workspaceUpdate'), f => f.host.dispose()]) {
    const f = fixture(); const snapshot = f.read(); change(f); const before = f.state();
    assert.throws(() => f.save(snapshot, [{argument: 'A', value: 'new'}])); assert.deepEqual(f.state(), before); f.host.dispose();
  }
});

test('every candidate is validated before the first setter and duplicate writes fail closed', () => {
  const f = fixture(); const snapshot = f.read(); const before = f.state();
  for (const changes of [[{argument: 'A', value: 'new'}, {argument: 'B', value: 10}],
    [{argument: 'A', value: 'new'}, {argument: 'A', value: 'new2'}]]) {
    assert.throws(() => f.save(snapshot, changes), TypeError); assert.deepEqual(f.state(), before);
  }
  f.host.dispose();
});

test('fixed branch selector and dependent changes stay disabled before branch UI support', () => {
  const f = fixture({grouped: true}); const snapshot = f.read(); const before = f.state();
  assert.throws(() => f.save(snapshot, [{argument: 'A', value: 'new'}]), /branch/);
  assert.throws(() => f.save(snapshot, [{argument: 'B', value: 'new'}]), /branch/);
  f.save(snapshot, [{argument: 'A', value: 'old-a'}]); assert.deepEqual(f.state(), before); f.host.dispose();
});

test('second setter failure restores all raw fields, VM state, undo, redo, dirty and revision', () => {
  const f = fixture(); const snapshot = f.read(); const before = f.state();
  f.fields.B.beforeSet = value => {if (value === 'new-b') throw new Error('setter failed');};
  assert.throws(() => f.save(snapshot, [{argument: 'A', value: 'new-a'}, {argument: 'B', value: 'new-b'}]), /setter failed/);
  assert.deepEqual(f.state(), before); assert.deepEqual(f.read(), snapshot); f.host.dispose();
});

test('second synchronous event failure rolls back VM fields and undo and restores the same snapshot', () => {
  const f = fixture(); const snapshot = f.read(); const before = f.state();
  const listener = event => {if (event.blockId === 'B') throw new Error('listener failed');};
  f.workspace.addChangeListener(listener);
  assert.throws(() => f.save(snapshot, [{argument: 'A', value: 'new-a'}, {argument: 'B', value: 'new-b'}]), /listener failed/);
  assert.deepEqual(f.state(), before); assert.deepEqual(f.read(), snapshot); f.host.dispose();
});

test('aborting during setter or event restores atomic state and keeps unsaved raw values', () => {
  for (const phase of ['setter', 'event']) {
    const f = fixture(); const snapshot = f.read(); const before = f.state(); const controller = new AbortController();
    if (phase === 'setter') f.fields.A.beforeSet = () => controller.abort();
    else f.workspace.addChangeListener(() => controller.abort());
    assert.throws(() => f.save(snapshot, [{argument: 'A', value: 'new-a'}, {argument: 'B', value: 'new-b'}], controller.signal));
    assert.deepEqual(f.state(), before); assert.deepEqual(f.read(), snapshot); f.host.dispose();
  }
});

test('external target and project invalidation survive transaction rollback', () => {
  for (const kind of ['target', 'project']) {
    const f = fixture(); const snapshot = f.read(); const before = f.state();
    const otherTarget = {id: 'other', blocks: f.target.blocks};
    f.workspace.addChangeListener(() => {
      if (kind === 'target') { f.vm.editingTarget = otherTarget; f.emit('targetsUpdate'); }
      else f.emit('workspaceUpdate');
    });
    assert.throws(() => f.save(snapshot, [{argument: 'A', value: 'new-a'}]));
    assert.deepEqual(f.state(), before);
    if (kind === 'target') assert.equal(f.vm.editingTarget, otherTarget);
    else assert.notEqual(f.read().fixedContext.generation, snapshot.fixedContext.generation);
    f.host.dispose();
  }
});

test('patch accessors are never evaluated and custom iterators cannot omit writes', () => {
  const f = fixture(); const snapshot = f.read(); const before = f.state();
  let reads = 0; const change = {argument: 'A'};
  Object.defineProperty(change, 'value', {get() {reads++; return 'new';}});
  assert.throws(() => f.save(snapshot, [change]), TypeError); assert.equal(reads, 0);
  const changes = [{argument: 'A', value: 'new'}, {argument: 'READ', value: 'bad'}];
  changes[Symbol.iterator] = function* () {yield changes[0];};
  assert.throws(() => f.save(snapshot, changes), TypeError); assert.deepEqual(f.state(), before); f.host.dispose();
});


test('context is JSON own data and the signal must be native without reading attacker getters', () => {
  const f = fixture(); const expected = f.read(); const before = f.state(); let reads = 0;
  const malicious = {get aborted() {reads++; return false;}};
  assert.throws(() => f.save(expected, [{argument: 'A', value: 'new'}], malicious), TypeError);
  assert.equal(reads, 0);
  for (const context of [{consumerId: '', nowMs: 0, settings: null}, {consumerId: 'test', nowMs: Infinity, settings: null},
    {consumerId: 'test', nowMs: 0, settings: {get value() {reads++; return 'bad';}}}]) {
    assert.throws(() => f.host.fixedInputs.commit({expected, changes: [{argument: 'A', value: 'new'}],
      signal: new AbortController().signal, context}), TypeError);
  }
  assert.equal(reads, 0); assert.deepEqual(f.state(), before); f.host.dispose();
});

test('setup failure restores event group and the dirty emitter without starting writes', () => {
  const f = fixture(); const expected = f.read(); const before = f.state();
  const originalDisable = f.ScratchBlocks.Events.disable;
  f.ScratchBlocks.Events.disable = () => {originalDisable(); throw new Error('disable failed');};
  assert.throws(() => f.save(expected, [{argument: 'A', value: 'new'}]), /disable failed/);
  assert.deepEqual(f.state(), before); f.host.dispose();
});

test('non-target field and input changes are detected and retained while edited fields roll back', () => {
  for (const kind of ['field', 'input', 'mutation']) {
    const f = fixture(); const expected = f.read(); const before = f.state();
    const parentVm = f.vmBlocks.get('parent');
    f.workspace.addChangeListener(() => {
      if (kind === 'field') parentVm.fields.UNRELATED = {value: 'external'};
      else if (kind === 'input') parentVm.inputs.UNRELATED = {block: null, shadow: null};
      else parentVm.mutation = {tagName: 'mutation', external: 'yes'};
    });
    assert.throws(() => f.save(expected, [{argument: 'A', value: 'new-a'}]));
    assert.deepEqual(f.state(), before);
    if (kind === 'field') assert.equal(parentVm.fields.UNRELATED.value, 'external');
    else if (kind === 'input') assert.ok(parentVm.inputs.UNRELATED);
    else assert.equal(parentVm.mutation.external, 'yes');
    f.host.dispose();
  }
});


test('statement connection and VM next replacement conflict without changing connected blocks', () => {
  for (const phase of ['before-write', 'during-write']) {
    const f = fixture(); const expected = f.read(); const before = f.state();
    const parent = f.blocks.get('parent'); const parentVm = f.vmBlocks.get('parent');
    const outside = {id: 'next-block', type: 'example_other'};
    const connect = () => {
      parent.nextConnection = {targetBlock: () => outside, targetConnection: {}};
      parentVm.next = outside.id;
    };
    if (phase === 'before-write') connect();
    else f.workspace.addChangeListener(connect);
    assert.throws(() => f.save(expected, [{argument: 'A', value: 'new-a'}]));
    assert.deepEqual(f.state(), before); assert.equal(parentVm.next, outside.id);
    assert.equal(parent.nextConnection.targetBlock(), outside); f.host.dispose();
  }
});


test('external reentrant field changes retain their undo and dirty while only editor writes roll back', () => {
  const f = fixture(); const expected = f.read();
  f.workspace.addChangeListener(event => {
    if (event.blockId !== 'A') return;
    f.fields.READ.setValue('outside');
    f.workspace.fireChangeListener(new f.ScratchBlocks.Events.Change(f.blocks.get('READ'), 'field', 'TEXT', 'read', 'outside'));
  });
  assert.throws(() => f.save(expected, [{argument: 'A', value: 'new-a'}]));
  const state = f.state();
  assert.equal(state.a, 'old-a'); assert.equal(state.va, 'old-a');
  assert.equal(f.fields.READ.getValue(), 'outside'); assert.equal(f.vmBlocks.get('READ').fields.TEXT.value, 'outside');
  assert.equal(state.undo.length, 2); assert.equal(state.undo[1].blockId, 'READ'); assert.deepEqual(state.redo, []);
  assert.equal(state.dirty, 1); f.host.dispose();
});

test('new project history arrays remain authoritative after a pending edit rolls back', () => {
  const f = fixture(); const expected = f.read(); const nextUndo = ['new-project-undo']; const nextRedo = ['new-project-redo'];
  f.workspace.addChangeListener(() => {
    f.workspace.undoStack_ = nextUndo; f.workspace.redoStack_ = nextRedo; f.emit('workspaceUpdate');
  });
  assert.throws(() => f.save(expected, [{argument: 'A', value: 'new-a'}]));
  assert.equal(f.workspace.undoStack_, nextUndo); assert.equal(f.workspace.redoStack_, nextRedo);
  assert.deepEqual(nextUndo, ['new-project-undo']); assert.deepEqual(nextRedo, ['new-project-redo']);
  assert.equal(f.fields.A.getValue(), 'old-a'); assert.equal(f.vmBlocks.get('A').fields.TEXT.value, 'old-a'); f.host.dispose();
});

test('legacy commit cannot bypass a fixed registration', () => {
  const f = fixture(); const before = f.state(); const expected = f.read();
  assert.throws(() => f.host.commit({expected, changes: [{argument: 'A', value: 'new-a'}]}), /fixed transaction/);
  assert.deepEqual(f.state(), before); f.host.dispose();
});


test('external writes to the same field survive rollback and undo never revives the rejected candidate', () => {
  const f = fixture(); const expected = f.read(); let outside = false;
  f.workspace.addChangeListener(event => {
    if (event.blockId !== 'A' || outside) return;
    outside = true; f.fields.A.setValue('outside');
    f.workspace.fireChangeListener(new f.ScratchBlocks.Events.Change(f.blocks.get('A'), 'field', 'TEXT', 'new-a', 'outside'));
  });
  assert.throws(() => f.save(expected, [{argument: 'A', value: 'new-a'}]));
  const state = f.state();
  assert.deepEqual([state.a, state.va, state.dirty], ['outside', 'outside', 1]);
  assert.equal(state.undo.length, 2); assert.equal(state.undo[1].oldValue, 'old-a');
  assert.equal(state.undo[1].newValue, 'outside'); f.host.dispose();
});

test('successful fixed commit publishes undo records only once and honors MAX_UNDO', () => {
  const f = fixture(); f.workspace.MAX_UNDO = 2; const expected = f.read(); const seen = [];
  f.workspace.addChangeListener(event => seen.push([event.recordUndo, f.workspace.undoStack_.length, f.workspace.redoStack_.length]));
  f.save(expected, [{argument: 'A', value: 'new-a'}, {argument: 'B', value: 'new-b'}]);
  assert.deepEqual(seen, [[false, 1, 1], [false, 1, 1]]);
  assert.equal(f.workspace.undoStack_.length, 2); assert.deepEqual(f.workspace.undoStack_.map(event => event.recordUndo), [true, true]);
  assert.equal(f.workspace.redoStack_.length, 0); f.host.dispose();
});

test('external non-undo events do not lose the existing redo history during editor rollback', () => {
  const f = fixture(); const expected = f.read();
  f.workspace.addChangeListener(event => {
    if (event.blockId !== 'A') return;
    f.fields.READ.setValue('outside');
    const external = new f.ScratchBlocks.Events.Change(f.blocks.get('READ'), 'field', 'TEXT', 'read', 'outside');
    external.recordUndo = false; f.workspace.fireChangeListener(external);
  });
  assert.throws(() => f.save(expected, [{argument: 'A', value: 'new-a'}]));
  assert.deepEqual(f.workspace.undoStack_, ['old-undo']); assert.deepEqual(f.workspace.redoStack_, ['old-redo']);
  assert.equal(f.state().dirty, 1); f.host.dispose();
});


test('undo accessors and histories frozen during delivery fail before publishing partial editor history', () => {
  for (const kind of ['configuration', 'freeze-during-delivery']) {
    const f = fixture(); const expected = f.read(); const before = f.state(); let reads = 0;
    if (kind === 'configuration') Object.defineProperty(f.workspace, 'MAX_UNDO', {get() {reads++; throw new Error('unknown');}});
    else f.workspace.addChangeListener(() => Object.freeze(f.workspace.undoStack_));
    assert.throws(() => f.save(expected, [{argument: 'A', value: 'new-a'}]), TypeError);
    assert.equal(reads, 0); assert.deepEqual(f.state(), before); f.host.dispose();
  }
});
