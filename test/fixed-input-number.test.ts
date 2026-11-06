import assert from 'node:assert/strict';
import test from 'node:test';
import {parseFixedNumberInput} from '../dist/schema.js';

test('new number input preserves validated tokens and finite Number semantics', () => {
  for (const token of ['0', '-0', '-0.5', '1', '1000', '1.00', '1e3', '1E+3', '1e-9999', '9007199254740993']) {
    const result = parseFixedNumberInput(` \t${token}\n`);
    assert.equal(result.kind, 'valid');
    assert.equal(result.token, token);
    assert(Object.is(result.value, Number(token)));
    assert(Object.isFrozen(result));
  }
  for (const value of [0, -0, -0.5, 1e100, Number.MIN_VALUE, Number.MAX_VALUE]) {
    const result = parseFixedNumberInput(value);
    assert.equal(result.kind, 'valid');
    assert(Object.is(result.value, value));
    assert.equal(result.token, Object.is(value, -0) ? '-0' : String(value));
  }
});

test('new invalid and incomplete number buffers never become zero or a fallback', () => {
  for (const input of ['', ' ', 'NaN', 'Infinity', '-Infinity', '1e9999', '1e', '-', '+1', '.5', '01', '0x10', '1.',
    NaN, Infinity, -Infinity, null, undefined, true, false, [], {}]) {
    assert.deepEqual(parseFixedNumberInput(input), {kind: 'invalid', code: 'fixed-number-input-invalid'});
  }
  let calls = 0;
  const hostile = {toString() {calls++; throw new Error('private input');}, valueOf() {calls++; return 1;}};
  assert.equal(parseFixedNumberInput(hostile).kind, 'invalid');
  assert.equal(calls, 0);
});

test('numeric parser does not add owner bounds, integer constraints or precision promises', () => {
  for (const value of ['-1', '-0.5', '-100', '0', '0.5', '1001', '9007199254740992']) {
    assert.equal(parseFixedNumberInput(value).kind, 'valid');
  }
  assert.equal(parseFixedNumberInput('9007199254740993').token, '9007199254740993');
  assert.equal(parseFixedNumberInput('9007199254740993').value, Number('9007199254740993'));
});
