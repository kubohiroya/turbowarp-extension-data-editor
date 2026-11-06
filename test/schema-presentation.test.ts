import assert from 'node:assert/strict';
import {test} from 'node:test';
import {presentationTypes, presentationInitial, presentationCondition} from '../dist/schema-presentation.js';

test('presentation type proof respects references, intersections, enums and unions independently of current data', () => {
  const types = schema => [...presentationTypes(schema)].sort();
  assert.deepEqual(types({type: 'integer'}), ['number']);
  assert.deepEqual(types({enum: ['a', 'b']}), ['string']);
  assert.deepEqual(types({const: true}), ['boolean']);
  assert.deepEqual(types({type: ['string', 'null']}), ['null', 'string']);
  assert.deepEqual(types({oneOf: [{type: 'number'}, {type: 'string'}]}), ['number', 'string']);
  assert.deepEqual(types({allOf: [{type: ['number', 'string']}, {type: 'number'}]}), ['number']);
  assert.deepEqual(types({allOf: [{type: 'string'}, {type: 'number'}]}), []);
  assert.equal(types(true).length, 6);assert.deepEqual(types(false), []);
  const target = {type: 'object', properties: {children: {$ref: '#node'}}};
  assert.deepEqual([...presentationTypes({$ref: '#node'}, () => target)], ['object']);
  const cycle = {$ref: '#cycle'};assert.equal(presentationTypes(cycle, () => cycle).size, 6);
});

test('explicit addition uses a typed empty value without applying schema defaults', () => {
  for (const [type, value] of [['string', ''], ['number', 0], ['integer', 0], ['boolean', false], ['object', {}], ['array', []]]) {
    assert.deepEqual(presentationInitial({type, default: 'ignored'}), value);
  }
  assert.equal(presentationInitial({type: ['string', 'null']}), null);
  assert.equal(presentationInitial({const: 'fixed'}), 'fixed');
});

test('conditional hints use supported schema constraints and remain unknown for unsupported conditions', () => {
  const test = (schema, value) => presentationCondition(schema, value, () => undefined);
  const schema = {type: 'object', required: ['model'], properties: {model: {const: 'none'}}};
  assert.equal(test(schema, {model: 'none'}), true);assert.equal(test(schema, {model: 'other'}), false);assert.equal(test(schema, {}), false);
  assert.equal(test({minimum: 10}, 3), undefined);
  assert.equal(test({allOf: [{type: 'integer'}, {enum: [1, 2]}]}, 2), true);
  assert.equal(test({oneOf: [{type: 'number'}, {type: 'integer'}]}, 2), false);
  assert.equal(test({anyOf: [{type: 'number'}, {minimum: 1}]}, 'unknown'), undefined);
  assert.equal(test({not: {const: null}}, false), true);
  assert.equal(test({const: {x: [1, 2], y: true}}, {y: true, x: [1, 2]}), true);
});
