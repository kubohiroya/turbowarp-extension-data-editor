import test from 'node:test';
import assert from 'node:assert/strict';
import {captureFixedInputDeclaration, captureFixedSnapshot, sameFixedSnapshot} from '../dist/fixed-input-snapshot.js';
import {FIXED_INPUTS_CAPABILITY, supportsFixedInputs} from '../dist/fixed-input-types.js';
import {captureSnapshot} from '../dist/data.js';

const declaration = () => ({contractId: 'bubble-close', contractRevision: '1',
  editableArguments: ['TRIGGER', 'TIMEOUT'], readOnlyArguments: ['CONDITION'],
  dependencies: [{selector: 'TRIGGER', dependents: ['TIMEOUT']}]});
function snapshot() {
  return {targetId: 'target', blockId: 'block', opcode: 'close', revision: 'r1',
    arguments: {TRIGGER: {kind: 'literal', value: 'timeout'}, TIMEOUT: {kind: 'literal', value: '10'},
      CONDITION: {kind: 'reporter'}},
    fixedContext: {contractId: 'bubble-close', contractRevision: '1', generation: 'project1',
      readOnlyArguments: ['CONDITION'], dependencies: [{selector: 'TRIGGER', dependents: ['TIMEOUT']}],
      inputs: {TRIGGER: {role: 'editable', source: 'field', identity: 'trigger1',
        field: {blockId: 'block', name: 'TRIGGER', type: 'FieldDropdown'}},
      TIMEOUT: {role: 'editable', source: 'shadow', identity: 'timeout1',
        field: {blockId: 'number', name: 'NUM', type: 'FieldNumber'}},
      CONDITION: {role: 'readonly', source: 'reporter', identity: 'reporter1'}}}};
}

test('fixed snapshots retain and deeply freeze metadata, with detached raw values', () => {
  const original = snapshot();
  const copy = captureFixedSnapshot(original, original, declaration());
  original.fixedContext.inputs.TIMEOUT.field.blockId = 'different';
  original.arguments.TIMEOUT.value = '20';
  assert.equal(copy.fixedContext.inputs.TIMEOUT.field.blockId, 'number');
  assert.equal(copy.arguments.TIMEOUT.value, '10');
  assert.ok(Object.isFrozen(copy.fixedContext.dependencies[0].dependents));
  assert.ok(Object.isFrozen(copy.fixedContext.inputs.TIMEOUT.field));
  assert.ok(Object.isFrozen(copy.arguments.TIMEOUT));
  assert.equal(captureSnapshot(snapshot(), snapshot()).fixedContext, undefined);
});

test('fixed raw capture preserves NaN, infinities and negative zero without JSON coercion', () => {
  for (const value of [NaN, Infinity, -Infinity, -0]) {
    const raw = snapshot(); raw.arguments.TIMEOUT.value = value;
    const copy = captureFixedSnapshot(raw);
    assert.ok(Object.is(copy.arguments.TIMEOUT.value, value));
    assert.equal(sameFixedSnapshot(raw, copy), true);
  }
  const a = snapshot(); a.arguments.TIMEOUT.value = -0;
  const b = snapshot(); b.arguments.TIMEOUT.value = 0;
  assert.equal(sameFixedSnapshot(a, b), false);
});

test('fixed comparisons include read-only connection identity, context, contract and raw', () => {
  const paths = [
    s => {s.fixedContext.inputs.CONDITION.identity = 'reporter2';},
    s => {s.fixedContext.generation = 'project2';},
    s => {s.fixedContext.contractRevision = '2';},
    s => {s.fixedContext.inputs.TIMEOUT.field.blockId = 'number2';},
    s => {s.arguments.TIMEOUT.value = '10.0';},
    s => {s.revision = 'r2';}
  ];
  for (const change of paths) {
    const a = snapshot(); const b = snapshot(); change(b);
    assert.equal(sameFixedSnapshot(a, b), false);
  }
  assert.equal(sameFixedSnapshot(snapshot(), snapshot()), true);
});

test('declarations reject overlapping roles, missing dependencies and duplicate arguments', () => {
  for (const mutate of [
    d => {d.readOnlyArguments = ['TIMEOUT'];},
    d => {d.editableArguments.push('TIMEOUT');},
    d => {d.dependencies[0].dependents = ['CONDITION'];},
    d => {d.dependencies[0].selector = 'MISSING';},
    d => {d.dependencies[0].dependents = ['TRIGGER'];},
    d => {d.dependencies.push(d.dependencies[0]);}
  ]) {
    const d = declaration(); mutate(d);
    assert.throws(() => captureFixedInputDeclaration(d), TypeError);
  }
});

test('fixed snapshots reject missing metadata, malformed shapes and role or contract changes', () => {
  for (const mutate of [
    s => {delete s.fixedContext;},
    s => {delete s.fixedContext.inputs.TIMEOUT;},
    s => {s.fixedContext.inputs.TIMEOUT.source = 'custom';},
    s => {s.fixedContext.inputs.TIMEOUT.role = 'readonly';},
    s => {s.fixedContext.inputs.TIMEOUT.source = 'reporter'; delete s.fixedContext.inputs.TIMEOUT.field;},
    s => {delete s.fixedContext.inputs.TIMEOUT.field;},
    s => {s.fixedContext.contractRevision = '2';},
    s => {s.fixedContext.dependencies = [];}
  ]) {
    const s = snapshot(); mutate(s);
    assert.throws(() => captureFixedSnapshot(s, {targetId: 'target', blockId: 'block'}, declaration()));
  }
});

test('unregistered arguments retain raw values without requiring fixed metadata', () => {
  const a = snapshot();
  a.arguments.FUTURE_SELECTOR = {kind: 'literal', value: 'raw value'};
  const copy = captureFixedSnapshot(a, a, declaration());
  assert.equal(copy.arguments.FUTURE_SELECTOR.value, 'raw value');
  assert.equal(copy.fixedContext.inputs.FUTURE_SELECTOR, undefined);
  const b = snapshot(); b.arguments.FUTURE_SELECTOR = {kind: 'literal', value: 'changed'};
  assert.equal(sameFixedSnapshot(a, b), false);
  const connected = snapshot(); connected.arguments.FUTURE_SELECTOR = {kind: 'reporter'};
  assert.equal(sameFixedSnapshot(a, connected), false);
  const identityChanged = snapshot();
  identityChanged.arguments.FUTURE_SELECTOR = {kind: 'literal', value: 'raw value'};
  identityChanged.revision = 'r2';
  assert.equal(sameFixedSnapshot(a, identityChanged), false);
});

test('unsupported metadata retains safe raw literals while missing metadata rejects literals', () => {
  for (const source of ['missing', 'unsupported']) {
    const s = snapshot();
    delete s.arguments.TIMEOUT;
    s.fixedContext.inputs.TIMEOUT = {role: 'editable', source, identity: 'unavailable', reason: 'Not editable'};
    assert.equal(captureFixedSnapshot(s).fixedContext.inputs.TIMEOUT.source, source);
    s.arguments.TIMEOUT = {kind: 'literal', value: 10};
    if (source === 'missing') assert.throws(() => captureFixedSnapshot(s), TypeError);
    else {
      const copy = captureFixedSnapshot(s);
      assert.equal(copy.arguments.TIMEOUT.value, 10);
      s.arguments.TIMEOUT.value = 11;
      assert.equal(sameFixedSnapshot(copy, s), false);
    }
  }
});

test('capture never executes accessors, custom iterators, toJSON or thenables', () => {
  let called = 0;
  const getter = () => {called++; throw Error('executed');};
  const cases = [
    s => Object.defineProperty(s, 'fixedContext', {get: getter}),
    s => Object.defineProperty(s.arguments.TIMEOUT, 'value', {get: getter}),
    s => Object.defineProperty(s.fixedContext.inputs.CONDITION, 'identity', {get: getter}),
    s => {s.fixedContext.dependencies[Symbol.iterator] = getter;},
    s => {s.fixedContext.toJSON = getter;},
    s => {s.fixedContext = {then: getter};}
  ];
  for (const modify of cases) {
    const s = snapshot(); modify(s);
    assert.throws(() => captureFixedSnapshot(s));
  }
  assert.equal(called, 0);
  const d = declaration(); Object.defineProperty(d, 'editableArguments', {get: getter});
  assert.throws(() => captureFixedInputDeclaration(d));
  assert.equal(called, 0);
});

test('fixed capability is optional and requires methods without evaluating getters', () => {
  const legacy = {readBlock() {}, commit() {}};
  assert.equal(supportsFixedInputs(legacy), false);
  assert.equal(supportsFixedInputs({...legacy, fixedInputs: {capability: FIXED_INPUTS_CAPABILITY}}), false);
  assert.equal(supportsFixedInputs({...legacy, fixedInputs: {capability: FIXED_INPUTS_CAPABILITY, readBlock() {}, commit() {}}}), true);
  let called = 0;
  const host = {...legacy};
  Object.defineProperty(host, 'fixedInputs', {get() {called++; throw Error('executed');}});
  assert.equal(supportsFixedInputs(host), false);
  const port = {capability: FIXED_INPUTS_CAPABILITY, commit() {}};
  Object.defineProperty(port, 'readBlock', {get() {called++; throw Error('executed');}});
  assert.equal(supportsFixedInputs({...legacy, fixedInputs: port}), false);
  assert.equal(called, 0);
});
