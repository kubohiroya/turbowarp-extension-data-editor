import assert from 'node:assert/strict';
import {test} from 'node:test';
import {decodeSource, encodeSource, sameData} from '../dist/codec.js';

test('JSON and YAML round-trip the same JSON data model', () => {
  const data = {title: '日本語「春」 & "scene"', body: '一行目\n二行目\n',
    yes: 'yes', flag: false, nil: null, list: [1, '2', {key: 'value'}]};
  for (const format of ['json', 'yaml']) {
    assert.deepEqual(decodeSource(encodeSource(data, format), format), data);
  }
  assert.deepEqual(decodeSource('title: "日本語「春」 & \\"scene\\""\nbody: |\n  一行目\n  二行目\n', 'yaml'),
    {title: '日本語「春」 & "scene"', body: '一行目\n二行目\n'});
});

test('reject unsupported YAML values instead of silently coercing or deleting them', () => {
  for (const source of [
    'key: [unterminated', 'key: first\nkey: second', 'value: .nan', 'value: .inf',
    '1: numeric key', '? [complex, key]\n: value', 'value: !custom unsupported',
    'value: !!timestamp 2020-01-01', 'value: !!set {a: null}',
    'value: &cycle [*cycle]', 'first: 1\n---\nsecond: 2', '%YAML 1.1\n---\nyes: yes'
  ]) {
    assert.throws(() => decodeSource(source, 'yaml'), undefined, source);
  }
});

test('YAML 1.2 strings and string keys preserve their meaning', () => {
  assert.deepEqual(decodeSource('value: yes\ndate: 2020-01-01\n"1": one\n', 'yaml'),
    {value: 'yes', date: '2020-01-01', '1': 'one'});
  const data = decodeSource('__proto__: {polluted: true}', 'yaml');
  assert.equal(Object.getPrototypeOf(data), Object.prototype);
  assert.equal(Object.hasOwn(data, '__proto__'), true);
  assert.equal({}.polluted, undefined);
});

test('no-op comparison ignores object order but preserves types and array order', () => {
  assert.equal(sameData({a: 1, b: {c: null}}, {b: {c: null}, a: 1}), true);
  for (const [left, right] of [[1, '1'], [[1, 2], [2, 1]], [{a: null}, {}], [[], {}]]) {
    assert.equal(sameData(left, right), false);
  }
});
