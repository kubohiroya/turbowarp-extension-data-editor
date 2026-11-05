import assert from 'node:assert/strict';
import {test} from 'node:test';
import {compileSchemaBundle} from '../dist/schema.js';
import {Ajv} from 'ajv';

const identity = {ownerId: 'test', contractId: 'fixed', revision: '1', variantId: 'default'};
const source = {repository: 'owner', path: 'schemas/fixed.json'};
const artifact = {role: 'canonical-schema', source};
const resource = (document, retrievalUri = 'https://schema.invalid/root.json') => ({document, retrievalUri, artifact});
const bundle = (document, extra = {}) => ({identity: {...identity}, dialect: 'draft-07', root: resource(document), resources: [],
  provenance: {canonicalSources: [source], generatedFiles: [], referenceSchemas: [], generationSources: []}, ...extra});
const freeze = value => { if (value && typeof value === 'object') {Object.values(value).forEach(freeze);Object.freeze(value);} return value; };
const validator = b => {const r = compileSchemaBundle(b);assert.equal(r.kind, 'compiled', JSON.stringify(r));return r.validator;};
const errorCode = b => {const r = compileSchemaBundle(b);assert.notEqual(r.kind, 'compiled');return r.diagnostics[0].code;};

test('both dialects, boolean schemas, scalar roots and draft-07 tuple semantics', () => {
  assert.equal(validator(bundle(true)).validate(null).kind, 'valid');
  assert.equal(validator(bundle(false)).validate(1).kind, 'invalid');
  const old = validator(bundle({type: 'array', items: [{type: 'string'}, {type: 'number'}], additionalItems: false}));
  assert.equal(old.validate(['a', 1]).kind, 'valid');assert.equal(old.validate(['a', 1, true]).kind, 'invalid');
  const modern = validator(bundle({$schema: 'https://json-schema.org/draft/2020-12/schema', type: 'array',
    prefixItems: [{type: 'string'}], items: false}, {dialect: '2020-12'}));
  assert.equal(modern.validate(['a']).kind, 'valid');assert.equal(modern.validate(['a', 1]).kind, 'invalid');
});

test('explicit dialect, known aliases, conflicts and meta-schema errors are distinguished', () => {
  assert.equal(errorCode({...bundle(true), dialect: undefined}), 'dialect-required');
  assert.equal(errorCode(bundle(true, {dialect: 'draft-04'})), 'dialect-unsupported');
  assert.equal(errorCode(bundle({$schema: 'https://json-schema.org/draft/2020-12/schema'})), 'dialect-conflict');
  assert.equal(errorCode(bundle({$schema: 'https://example.invalid/unknown'})), 'dialect-unsupported');
  assert.equal(validator(bundle({$schema: 'https://json-schema.org/draft-07/schema#', type: 'string'})).validate('a').kind, 'valid');
  assert.equal(errorCode(bundle({type: 123})), 'schema-invalid');
  assert.equal(errorCode(bundle({type: 'string', pattern: '['})), 'schema-invalid');
  assert.equal(errorCode(bundle({$async: true, type: 'string'})), 'schema-invalid');
});

test('relative/absolute refs and relative root IDs resolve from the retrieval URI', () => {
  const b = bundle({$id: 'root.json', type: 'object', properties: {a: {$ref: 'child.json'}, b: {$ref: 'https://schema.invalid/child.json'}}},
    {resources: [resource({type: 'number'}, 'https://schema.invalid/child.json')]});
  const v = validator(b);assert.equal(v.validate({a: 1, b: 2}).kind, 'valid');assert.equal(v.validate({a: 'x'}).kind, 'invalid');
  assert.equal(errorCode(bundle({$ref: 'missing.json'})), 'ref-unresolved');
});

test('self and mutual recursion use only the supplied resources without network access', () => {
  const oldFetch = globalThis.fetch;globalThis.fetch = () => {throw Error('network forbidden');};
  try {
    const self = validator(bundle({type: 'object', properties: {next: {$ref: '#'}}}));
    assert.equal(self.validate({next: {next: {}}}).kind, 'valid');assert.equal(self.validate({next: 1}).kind, 'invalid');
    const mutual = validator(bundle({type: 'object', properties: {b: {$ref: 'b.json'}}}, {resources: [
      resource({type: 'object', properties: {a: {$ref: 'root.json'}}}, 'https://schema.invalid/b.json')]}));
    assert.equal(mutual.validate({b: {a: {b: {}}}}).kind, 'valid');
    assert.equal(errorCode(bundle({$ref: 'https://elsewhere.invalid/private'})), 'ref-unresolved');
  } finally {globalThis.fetch = oldFetch;}
});

test('resource retrieval and nested effective IDs cannot collide across locations', () => {
  assert.equal(errorCode(bundle({}, {resources: [resource({}, 'https://schema.invalid/root.json')]})), 'resource-id-conflict');
  assert.equal(errorCode(bundle({$defs: {a: {$id: 'same.json'}, b: {$id: 'same.json'}}})), 'resource-id-conflict');
  assert.equal(errorCode(bundle({properties: {'a/properties/b': {$id: 'same.json'}, a: {properties: {b: {$id: 'same.json'}}}}})), 'resource-id-conflict');
  assert.equal(errorCode(bundle({$id: 'other.json'}, {resources: [resource({}, 'https://schema.invalid/other.json')]})), 'resource-id-conflict');
  assert.equal(errorCode(bundle({}, {resources: [resource({$schema: 'https://json-schema.org/draft/2020-12/schema'}, 'https://schema.invalid/other.json')]})), 'dialect-conflict');
});

test('instance annotations are data rather than nested schema resources', () => {
  const data = {$id: 'same.json', $schema: 'unknown', $async: true};
  const v = validator(bundle({const: data, default: data, examples: [data]}));
  assert.equal(v.validate(data).kind, 'valid');
});

test('bundle instances isolate equal IDs and remain independent of subsequent schema edits', () => {
  const a = bundle({$id: 'https://schema.invalid/shared', type: 'number'});
  const first = validator(a);const second = validator(bundle({$id: 'https://schema.invalid/shared', type: 'string'}));
  a.root.document.type = 'boolean';a.identity.revision = 'modified';
  assert.equal(first.validate(1).kind, 'valid');assert.equal(first.validate('1').kind, 'invalid');
  assert.equal(second.validate('1').kind, 'valid');assert.equal(second.validate(1).kind, 'invalid');
  assert.equal(first.identity.revision, '1');
});

test('validation never coerces, inserts defaults, removes properties or mutates frozen inputs', () => {
  const b = freeze(bundle({type: 'object', properties: {n: {type: 'number', default: 1}}, additionalProperties: false}));
  const before = JSON.stringify(b);const v = validator(b);const input = freeze({n: '1', extra: true});
  assert.equal(v.validate(input).kind, 'invalid');assert.deepEqual(input, {n: '1', extra: true});
  const absent = freeze({});assert.equal(v.validate(absent).kind, 'valid');assert.deepEqual(absent, {});assert.equal(JSON.stringify(b), before);
});

test('structural diagnostics use escaped child pointers and safe schema metadata only', () => {
  const v = validator(bundle({type: 'object', properties: {'a/b': {type: 'object', required: ['~key'], additionalProperties: false}}}));
  const result = v.validate({'a/b': {secret: 'credentials'}}, {consumerId: 'block'});
  assert.equal(result.kind, 'invalid');assert.deepEqual(result.diagnostics.map(x => x.dataPath), ['/a~1b/~0key', '/a~1b/secret']);
  for (const d of result.diagnostics) {assert.equal(d.phase, 'structure');assert.equal(d.scope.consumerId, 'block');assert.ok(d.schemaPath.startsWith('/'));}
  assert.equal(JSON.stringify(result).includes('credentials'), false);
  assert.equal(JSON.stringify(result).includes('allowedValues'), false);
});

test('non-JSON values, cycles, sparse arrays and throwing accessors fail without leaking values', () => {
  const v = validator(bundle(true));const cyclic = {};cyclic.next = cyclic;
  const getter = Object.defineProperty({}, 'secret', {enumerable: true, get() {throw Error('credentials');}});
  for (const input of [undefined, NaN, Infinity, 1n, new Date(), cyclic, new Array(1), getter]) {
    const r = v.validate(input);assert.equal(r.kind, 'invalid');assert.equal(r.diagnostics[0].code, 'input-not-json');
    assert.equal(JSON.stringify(r).includes('credentials'), false);
  }
  const ownProto = JSON.parse('{"__proto__": {"value": 1}}');assert.equal(v.validate(ownProto).kind, 'valid');
});

test('declared provenance roles are checked without reading referenced paths or URLs', () => {
  const generated = {repository: 'owner', path: 'generated.json'};
  const b = bundle(true);b.provenance.generatedFiles.push(generated);b.root.artifact = {role: 'generated-schema', source: generated, generatedFrom: [source]};
  assert.equal(validator(b).validate(1).kind, 'valid');
  b.root.artifact.generatedFrom = [];assert.equal(errorCode(b), 'artifact-role-invalid');
  assert.equal(errorCode(bundle(true, {root: {...resource(true), artifact: {role: 'reference-schema', source}}})), 'artifact-role-invalid');
  const overlap = bundle(true);overlap.provenance.referenceSchemas.push(source);assert.equal(errorCode(overlap), 'artifact-role-invalid');
  assert.equal(errorCode(bundle(true, {root: {...resource(true), artifact: {role: 'canonical-schema', source: generated}}})), 'artifact-role-invalid');
});

test('bounded traversal returns execution diagnostics rather than truncating the validation input', () => {
  const v = validator(bundle(true));let value = null;for (let i = 0; i < 140; i++) value = [value];
  const r = v.validate(value);assert.equal(r.kind, 'execution-error');assert.equal(r.diagnostics[0].code, 'limit-exceeded');
  const schema = {};schema.default = value;const c = compileSchemaBundle(bundle(schema));assert.equal(c.kind, 'execution-error');assert.equal(c.diagnostics[0].operation, 'compile');
  assert.equal(v.validate(Array(99_999).fill(null)).kind, 'valid');
  const wide = v.validate(Array(100_000).fill(null));assert.equal(wide.kind, 'execution-error');assert.equal(wide.diagnostics[0].code, 'limit-exceeded');
});

test('URN resources and URI-encoded schema fragments retain actual JSON Pointer keys', () => {
  const b = bundle({type: 'object', properties: {'a b': {type: 'number'}, '50%': {type: 'number'}, '%2F': {type: 'number'}}});
  b.root.retrievalUri = 'urn:example:root';
  const r = validator(b).validate({'a b': 'x', '50%': 'x', '%2F': 'x'});
  assert.equal(r.kind, 'invalid');
  assert.deepEqual(r.diagnostics.map(d => d.schemaPath), ['/properties/a b/type', '/properties/50%/type', '/properties/%2F/type']);
  assert.ok(r.diagnostics.every(d => d.resourceUri === 'urn:example:root'));
});

test('unexpected engine errors become execution diagnostics without raw exception messages', () => {
  const original = Ajv.prototype.getSchema;
  try {
    Ajv.prototype.getSchema = () => {throw Error('private-engine-credentials');};
    const r = compileSchemaBundle(bundle(true));
    assert.equal(r.kind, 'execution-error');assert.equal(r.diagnostics[0].code, 'engine-failed');
    assert.equal(JSON.stringify(r).includes('private-engine-credentials'), false);
  } finally {Ajv.prototype.getSchema = original;}
});
