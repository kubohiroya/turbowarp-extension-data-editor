import assert from 'node:assert/strict';
import {test} from 'node:test';
import {basicJsonSchemaAuthoringBundle, compileSchemaBundle, fitsBasicJsonSchema} from '../dist/schema.js';

const compiled = compileSchemaBundle(basicJsonSchemaAuthoringBundle);

// What turbowarp-named-functions' `define schema` blocks produce.
const BASIC = [
  {type: 'object'},
  {type: 'object', properties: {a: {type: 'number'}, b: {type: 'number'}}, required: ['a', 'b']},
  {type: 'object', properties: {points: {type: 'number', minimum: 0}}, required: ['points']},
  {type: 'object', properties: {color: {type: 'string', enum: ['red', 'green']}}, additionalProperties: false},
  {type: 'object', properties: {tags: {type: 'array', items: {type: 'string', maxLength: 8}, maxItems: 3}}},
  {type: 'object', description: 'A player', properties: {name: {type: 'string', description: 'Shown name', minLength: 1}}},
  {$schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', properties: {}}
];

const NOT_BASIC = [
  {type: 'string'},
  'Scored',
  {type: 'object', properties: {a: {oneOf: [{type: 'string'}, {type: 'number'}]}}},
  {type: 'object', properties: {a: {$ref: '#/$defs/x'}}},
  {type: 'object', properties: {a: {type: ['string', 'null']}}},
  {type: 'object', properties: {a: {type: 'object', properties: {b: {type: 'string'}}}}},
  {type: 'object', properties: {a: {type: 'string', pattern: '^x'}}},
  {type: 'object', properties: {a: {type: 'string', items: {type: 'string'}}}},
  {type: 'object', properties: {a: {type: 'array', items: {type: 'array'}}}},
  {type: 'object', properties: {a: {type: 'number', enum: [1, 2]}}},
  {type: 'object', properties: {a: {type: 'string', minLength: 1.5}}},
  {type: 'object', required: ['a', 'a']},
  {type: 'object', $schema: 'http://json-schema.org/draft-07/schema#'}
];

test('the authoring schema compiles', () => {
  assert.equal(compiled.kind, 'compiled', JSON.stringify(compiled));
});

test('schemas from the define schema blocks fit and validate', () => {
  for (const value of BASIC) {
    assert.equal(fitsBasicJsonSchema(value), true, JSON.stringify(value));
    assert.equal(compiled.validator.validate(value).kind, 'valid', JSON.stringify(value));
  }
});

test('anything the form would drop does not fit', () => {
  for (const value of NOT_BASIC) assert.equal(fitsBasicJsonSchema(value), false, JSON.stringify(value));
});

test('a value that fits is always valid against the authoring schema', () => {
  // fits must never accept what the form cannot hold, or the form would drop it on save.
  for (const value of [...BASIC, ...NOT_BASIC]) {
    if (fitsBasicJsonSchema(value)) assert.equal(compiled.validator.validate(value).kind, 'valid', JSON.stringify(value));
  }
});
