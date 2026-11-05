import assert from 'node:assert/strict';
import {test} from 'node:test';
import vm from 'node:vm';
import {compileSchemaBundle, validateSchemaInput} from '../dist/schema.js';

const source = {repository: 'owner', path: 'schema.json'};
const compiled = compileSchemaBundle({identity: {ownerId: 'owner', contractId: 'shape', revision: '1', variantId: 'default'},
  dialect: 'draft-07', root: {retrievalUri: 'https://schema.invalid/owner', document: {type: 'object', properties: {n: {type: 'number'}}, required: ['n']},
    artifact: {role: 'canonical-schema', source}}, resources: [], provenance: {canonicalSources: [source], generatedFiles: [], referenceSchemas: [], generationSources: []}});
assert.equal(compiled.kind, 'compiled');
const context = {consumerId: 'consumer', nowMs: 123, settings: {maximum: 4}};
const valid = () => ({kind: 'valid', issues: []});

test('context is checked before structural validation and owner runs only after structural success', () => {
  let called = 0;const ownerValidate = () => {called++;return valid();};
  assert.equal(validateSchemaInput(compiled.validator, {n: 'x'}, {context, ownerValidate}).kind, 'invalid');assert.equal(called, 0);
  assert.equal(validateSchemaInput(compiled.validator, {n: 2}, {context, ownerValidate}).kind, 'valid');assert.equal(called, 1);
  for (const bad of [undefined, {}, {...context, nowMs: NaN}, {...context, settings: undefined}, {...context, settings: new Date()},
    {...context, settings: {f() {}}}, {...context, settings: {n: Infinity}}]) {
    const r = validateSchemaInput(compiled.validator, {n: 2}, {context: bad, ownerValidate});
    assert.equal(r.kind, 'execution-error');assert.equal(r.diagnostics[0].code, 'owner-context-invalid');
  }
  assert.equal(called, 1);
});

test('owner receives protected data/context snapshots and fixed identity/consumer diagnostics', () => {
  const data = {n: 8};let called = 0;
  const r = validateSchemaInput(compiled.validator, data, {context, ownerValidate: (candidate, ctx) => {
    called++;assert.notEqual(candidate, data);assert.notEqual(ctx, context);assert.ok(Object.isFrozen(candidate));assert.ok(Object.isFrozen(ctx.settings));
    return {kind: 'invalid', issues: [{dataPath: '/n', ruleId: 'maximum'}]};
  }});
  assert.equal(called, 1);assert.equal(r.kind, 'invalid');assert.equal(r.diagnostics[0].phase, 'semantic');
  assert.equal(r.diagnostics[0].scope.consumerId, 'consumer');assert.equal(r.diagnostics[0].scope.identity.ownerId, 'owner');
  assert.deepEqual(data, {n: 8});assert.deepEqual(context.settings, {maximum: 4});assert.ok(Object.isFrozen(r.diagnostics));
});

test('owner mutations, exceptions, malformed results and pointer syntax fail without leaking messages', () => {
  for (const ownerValidate of [() => {throw Error('credentials');}, d => {d.n = 7;return valid();}]) {
    const r = validateSchemaInput(compiled.validator, {n: 2}, {context, ownerValidate});assert.equal(r.diagnostics[0].code, 'owner-validation-failed');assert.equal(JSON.stringify(r).includes('credentials'), false);
  }
  for (const result of [undefined, {kind: 'valid', issues: [{dataPath: '/n', ruleId: 'x'}]}, {kind: 'invalid', issues: []},
    {kind: 'invalid', issues: [{dataPath: '/~2', ruleId: 'x'}]}, {kind: 'invalid', issues: [{dataPath: '/n'}]}]) {
    assert.equal(validateSchemaInput(compiled.validator, {n: 2}, {context, ownerValidate: () => result}).diagnostics[0].code, 'owner-result-invalid');
  }
});

test('native, cross-realm and rejected promises plus thenables are rejected synchronously and handled', async () => {
  const unhandled = [];const listen = value => unhandled.push(value);process.on('unhandledRejection', listen);
  try {
    const throwingThen = Object.defineProperty({}, 'then', {get() {throw Error('credentials');}});
    for (const result of [Promise.resolve(valid()), Promise.reject(Error('credentials')), vm.runInNewContext('Promise.reject(new Error("private"))'), {then() {}}, Object.assign(() => {}, {then() {}}), throwingThen]) {
      const r = validateSchemaInput(compiled.validator, {n: 2}, {context, ownerValidate: () => result});
      assert.equal(r.kind, 'execution-error');assert.equal(r.diagnostics[0].code, 'async-owner-unsupported');assert.equal(JSON.stringify(r).includes('credentials'), false);
    }
    await new Promise(resolve => setImmediate(resolve));assert.deepEqual(unhandled, []);
  } finally {process.off('unhandledRejection', listen);}
});

test('injected time/settings are per call and input is never replaced with an owner result', () => {
  const ownerValidate = (data, ctx) => data.n > ctx.settings.maximum || ctx.nowMs > 200 ? {kind: 'invalid', issues: [{dataPath: '/n', ruleId: 'fixed'}]} : valid();
  const before = {n: 2};assert.equal(validateSchemaInput(compiled.validator, before, {context, ownerValidate}).kind, 'valid');
  assert.equal(validateSchemaInput(compiled.validator, before, {context: {...context, nowMs: 201}, ownerValidate}).kind, 'invalid');
  assert.deepEqual(before, {n: 2});
});
