import assert from 'node:assert/strict';
import {test} from 'node:test';
import {toValidationIssues} from '@kubohiroya/turbowarp-extension-data-editor/schema';

const identity = Object.freeze({ownerId: 'owner', contractId: 'document', revision: '1', variantId: 'default'});
const scope = Object.freeze({identity, consumerId: 'consumer'});
const diagnostic = (overrides = {}) => ({
  phase: 'structure', code: 'schema-data-invalid', scope, dataPath: '', ...overrides
});
function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

test('converts all input codes to fixed messages, preserving order, duplicates and pointers', () => {
  const input = deepFreeze([
    diagnostic({phase: 'decode', code: 'input-format-invalid'}),
    diagnostic({phase: 'decode', code: 'variant-unrecognized', dataPath: '/items/0'}),
    diagnostic({code: 'input-not-json', dataPath: '/a~1b/~0key'}),
    diagnostic({dataPath: '/.label/[]/'}),
    diagnostic({phase: 'semantic', code: 'owner-input-invalid', ruleId: 'fixed', dataPath: '/items/0'}),
    diagnostic({dataPath: '/.label/[]/'})
  ]);
  const before = JSON.stringify(input);
  const issues = toValidationIssues(input);
  assert.deepEqual(issues, [
    {message: 'Input format is invalid.', path: ''},
    {message: 'Input variant is not recognized.', path: '/items/0'},
    {message: 'Input must be a JSON-compatible value.', path: '/a~1b/~0key'},
    {message: 'Value does not satisfy the schema.', path: '/.label/[]/'},
    {message: 'Value does not satisfy the owner input rules.', path: '/items/0'},
    {message: 'Value does not satisfy the schema.', path: '/.label/[]/'}
  ]);
  assert.equal(JSON.stringify(input), before);
  assert.ok(Object.isFrozen(issues));
  for (let i = 0; i < issues.length; i++) {
    assert.ok(Object.isFrozen(issues[i]));
    assert.notEqual(issues[i], input[i]);
  }
  assert.throws(() => { issues[0].message = 'changed'; }, TypeError);
  assert.throws(() => { issues.push({message: 'changed'}); }, TypeError);
});

test('returns a new frozen array, including for empty input', () => {
  const empty = Object.freeze([]);
  const result = toValidationIssues(empty);
  assert.deepEqual(result, []);
  assert.notEqual(result, empty);
  assert.ok(Object.isFrozen(result));
  assert.notEqual(toValidationIssues(empty), result);
  const input = [diagnostic()];
  assert.notEqual(toValidationIssues(input)[0], toValidationIssues(input)[0]);
});

test('ignores unknown metadata and never formats raw values, keywords or rule IDs into messages', () => {
  const secret = 'credential-secret';
  const input = deepFreeze([
    diagnostic({keyword: secret, params: {value: secret}, rawSource: secret, message: secret}),
    diagnostic({phase: 'semantic', code: 'owner-input-invalid', ruleId: secret, error: new Error(secret)})
  ]);
  const issues = toValidationIssues(input);
  assert.equal(JSON.stringify(issues).includes(secret), false);
  assert.deepEqual(Object.keys(issues[0]), ['message', 'path']);
});

test('rejects malformed diagnostics and compiler/execution failures instead of returning success', () => {
  const bad = [
    null, undefined, true, '', 1, [], {},
    diagnostic({code: 'unknown'}), diagnostic({code: 'toString'}),
    diagnostic({phase: 'decode'}), diagnostic({phase: 'unknown'}),
    diagnostic({phase: 'compile', code: 'schema-invalid'}),
    diagnostic({phase: 'execution', operation: 'structure', code: 'engine-failed'}),
    diagnostic({phase: 'semantic', code: 'owner-input-invalid'}),
    diagnostic({phase: 'semantic', code: 'owner-input-invalid', ruleId: 1}),
    diagnostic({scope: null}), diagnostic({scope: {}}), diagnostic({scope: {identity: {}}}),
    diagnostic({scope: {identity: {...identity, revision: 1}}}),
    diagnostic({scope: {...scope, consumerId: 1}}),
    diagnostic({resourceUri: 1}), diagnostic({schemaPath: '/bad~2'}),
    diagnostic({keyword: 1}), diagnostic({dataPath: undefined}),
    ...['.label', '#/a', '/~', '/~2', '/~00~', 1, null].map(dataPath => diagnostic({dataPath}))
  ];
  for (const value of bad) {
    assert.throws(() => toValidationIssues([diagnostic(), value]), {
      name: 'TypeError', message: 'Invalid input diagnostic.'
    });
  }
  for (const value of [undefined, null, {}, new Array(1)]) {
    assert.throws(() => toValidationIssues(value), TypeError);
  }
  for (const key of ['ownerId', 'contractId', 'revision', 'variantId']) {
    const incomplete = {...identity};
    delete incomplete[key];
    assert.throws(() => toValidationIssues([diagnostic({scope: {identity: incomplete}})]), TypeError);
  }
});

test('does not leak exceptions from malformed objects or indexed array getters', () => {
  const secret = 'credential-secret';
  const hostile = Object.defineProperty({}, 'scope', {get() { throw new Error(secret); }});
  const brokenElement = Object.defineProperty(new Array(1), 0, {get() { throw new Error(secret); }});
  for (const input of [[hostile], brokenElement]) {
    assert.throws(() => toValidationIssues(input), {
      name: 'TypeError', message: 'Invalid input diagnostic.'
    });
  }
});

test('reads changing diagnostic getters once and converts the same validated values', () => {
  const reads = new Map();
  const changing = (target, key, first, later) => Object.defineProperty(target, key, {
    enumerable: true,
    get() {
      const count = (reads.get(key) ?? 0) + 1;
      reads.set(key, count);
      return count === 1 ? first : later;
    }
  });
  const identitySnapshot = {...identity};
  for (const key of Object.keys(identitySnapshot)) {
    changing(identitySnapshot, key, identity[key], null);
  }
  const scopeSnapshot = changing({consumerId: 'consumer'}, 'identity', identitySnapshot, null);
  changing(scopeSnapshot, 'consumerId', 'consumer', null);
  const value = changing({}, 'scope', scopeSnapshot, null);
  changing(value, 'phase', 'structure', 'compile');
  changing(value, 'code', 'input-not-json', '__proto__');
  changing(value, 'dataPath', '/a~1b/~0key', 'not-a-pointer');
  changing(value, 'resourceUri', 'urn:document', null);
  changing(value, 'schemaPath', '/type', '/~2');
  changing(value, 'keyword', 'type', null);
  const result = toValidationIssues(Object.freeze([Object.freeze(value)]));
  assert.deepEqual(result, [{message: 'Input must be a JSON-compatible value.', path: '/a~1b/~0key'}]);
  for (const key of ['scope', 'identity', ...Object.keys(identity), 'consumerId',
    'phase', 'code', 'dataPath', 'resourceUri', 'schemaPath', 'keyword']) {
    assert.equal(reads.get(key), 1, key);
  }
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result[0]));
});

test('does not copy a code or path that becomes invalid on a second getter read', () => {
  for (const [key, first, later] of [['code', 'input-not-json', '__proto__'], ['dataPath', '', 'not-a-pointer']]) {
    let reads = 0;
    const value = Object.defineProperty(diagnostic(), key, {get() {
      return ++reads === 1 ? first : later;
    }});
    const result = toValidationIssues([value]);
    assert.deepEqual(result, [{
      message: key === 'code' ? 'Input must be a JSON-compatible value.' : 'Value does not satisfy the schema.',
      path: ''
    }]);
    assert.equal(reads, 1, key);
  }
});

test('rejects an invalid first getter value even if a later read would be valid', () => {
  for (const [key, first, later] of [['code', '__proto__', 'input-not-json'], ['dataPath', '/~2', '']]) {
    let reads = 0;
    const value = Object.defineProperty(diagnostic(), key, {
      get() { return ++reads === 1 ? first : later; }
    });
    assert.throws(() => toValidationIssues([value]), {
      name: 'TypeError', message: 'Invalid input diagnostic.'
    });
    assert.equal(reads, 1, key);
  }
});

test('preserves indexed order and count without consulting a custom array iterator', () => {
  for (const kind of ['empty', 'reverse', 'duplicate', 'throwing-getter']) {
    const input = [diagnostic({dataPath: '/first'}), diagnostic({dataPath: '/second'})];
    let reads = 0;
    Object.defineProperty(input, Symbol.iterator, {get() {
      reads++;
      if (kind === 'throwing-getter') throw new Error('Iterator must not be accessed.');
      return function*() {
        if (kind === 'reverse') { yield input[1]; yield input[0]; }
        if (kind === 'duplicate') { yield input[0]; yield input[0]; yield input[0]; }
      };
    }});
    Object.freeze(input);
    const result = toValidationIssues(input);
    assert.deepEqual(result.map(issue => issue.path), ['/first', '/second'], kind);
    assert.equal(reads, 0, kind);
  }
});

test('rejects invalid indexed diagnostics even when the iterator hides or replaces them', () => {
  for (const invalid of [
    diagnostic({phase: 'compile', code: 'schema-invalid'}),
    diagnostic({phase: 'execution', operation: 'structure', code: 'engine-failed'}),
    diagnostic({code: 'unknown'}), diagnostic({dataPath: '/~2'})
  ]) {
    const input = [diagnostic(), invalid];
    input[Symbol.iterator] = function*() { yield input[0]; };
    assert.throws(() => toValidationIssues(input), {
      name: 'TypeError', message: 'Invalid input diagnostic.'
    });
  }
  const sparse = new Array(1);
  sparse[Symbol.iterator] = function*() { yield diagnostic(); };
  assert.throws(() => toValidationIssues(sparse), TypeError);
});

test('snapshots indexed elements before diagnostic getters can remove later elements', () => {
  const input = [diagnostic({dataPath: '/first'}), diagnostic({dataPath: '/second'})];
  let reads = 0;
  Object.defineProperty(input[0], 'dataPath', {get() {
    reads++;
    input.length = 0;
    return '/first';
  }});
  assert.deepEqual(toValidationIssues(input).map(issue => issue.path), ['/first', '/second']);
  assert.equal(reads, 1);
});

test('reads each indexed array getter once', () => {
  let reads = 0;
  const input = Object.defineProperty(new Array(1), 0, {get() {
    return ++reads === 1 ? diagnostic() : diagnostic({phase: 'compile', code: 'schema-invalid'});
  }});
  assert.deepEqual(toValidationIssues(input), [{message: 'Value does not satisfy the schema.', path: ''}]);
  assert.equal(reads, 1);
});
