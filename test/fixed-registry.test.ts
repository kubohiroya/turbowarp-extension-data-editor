import assert from 'node:assert/strict';
import test from 'node:test';
import {EditorRegistry} from '../dist/index.js';

const definition = () => ({
  apiVersion: 1, extensionId: 'owner', editorId: 'fixed', opcodes: ['owner_fixed'],
  editableArguments: ['VALUE'], readOnlyArguments: ['CONDITION'], dependencies: [],
  contractId: 'owner.fixed', contractRevision: '1', saveContract: 'prepared-fixed-v1',
  read: () => ({}), validate: () => [], createPatch: () => [], readFixed: () => ({}),
  prepareFixedSave: () => ({kind: 'ready', changes: [], context: {consumerId: 'owner', nowMs: 0, settings: null}})
});

test('fixed registration authority is stable, immutable and contains no callbacks', () => {
  const registry = new EditorRegistry();
  registry.registerFixed(definition());
  const declaration = registry.resolveFixed('owner_fixed');
  assert.equal(registry.resolveFixed('owner_fixed'), declaration);
  assert.deepEqual(Object.keys(declaration).sort(), ['contractId', 'contractRevision', 'dependencies', 'editableArguments', 'readOnlyArguments']);
  assert.deepEqual(declaration.readOnlyArguments, ['CONDITION']);
  assert(Object.isFrozen(declaration));
  assert(Object.isFrozen(declaration.editableArguments));
  assert(Object.isFrozen(declaration.readOnlyArguments));
  assert.throws(() => declaration.readOnlyArguments.pop(), TypeError);
  assert.deepEqual(registry.resolve('owner_fixed'), {apiVersion: 1, extensionId: 'owner', editorId: 'fixed',
    opcodes: ['owner_fixed'], editableArguments: ['VALUE']});
});

test('re-registering identical fixed data creates a distinct registration identity', () => {
  const registry = new EditorRegistry();
  const remove = registry.registerFixed(definition());
  const first = registry.resolveFixed('owner_fixed');
  remove();
  assert.equal(registry.resolveFixed('owner_fixed'), undefined);
  registry.registerFixed(definition());
  const second = registry.resolveFixed('owner_fixed');
  assert.notEqual(first, second);
  assert.deepEqual(first, second);
});

test('legacy descriptors never advertise a fixed declaration', () => {
  const registry = new EditorRegistry();
  const {contractId, contractRevision, readOnlyArguments, dependencies, saveContract, readFixed, prepareFixedSave, ...legacy} = definition();
  registry.register(legacy);
  assert.equal(registry.resolveFixed('owner_fixed'), undefined);
  assert.equal(registry.resolveFixed('missing'), undefined);
});
