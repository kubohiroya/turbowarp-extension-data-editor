import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {createRequire} from 'node:module';
import {JSDOM} from 'jsdom';
import {EditorRegistry} from '../dist/index.js';
import bindBlockEditorFieldErrors from '../dist/field-errors.js';
import {fieldErrors} from '../dist/schema-view.js';
const dom = new JSDOM('<!doctype html><html><body></body></html>', {url: 'http://localhost/'});
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'MutationObserver']) Object.defineProperty(globalThis, name, {value: dom.window[name], configurable: true});
Object.defineProperty(globalThis, 'MessageChannel', {value: undefined, configurable: true});
after(() => dom.window.close());
const {createSchemaBundleEditor, createBlockEditorService} = await import('../dist/rjsf.js');
const {act, Simulate} = createRequire(import.meta.url)('react-dom/test-utils');
const source = {repository: 'owner', path: 'shape.json'};
const other = {repository: 'owner', path: 'number.json'};
function bundle(dialect = 'draft-07') {
  return {identity: {ownerId: 'owner', contractId: 'shape', revision: '1', variantId: 'default'}, dialect,
    root: {retrievalUri: 'https://schema.invalid/shape', document: {$id: 'https://schema.invalid/shape', type: 'object',
      properties: {n: {$ref: 'number'}, children: {type: 'array', items: {$ref: '#'}}}, required: ['n']}, artifact: {role: 'canonical-schema', source}},
    resources: [{retrievalUri: 'https://schema.invalid/number', document: {type: 'number', minimum: 1, default: 3}, artifact: {role: 'canonical-schema', source: other}}],
    provenance: {canonicalSources: [source, other], generatedFiles: [], referenceSchemas: [], generationSources: []}};
}
const context = {consumerId: 'consumer', nowMs: 0, settings: null};
function fixture(options = {}, stored = '{"n":2}') {
  const definition = createSchemaBundleEditor({apiVersion: 1, extensionId: 'owner', editorId: 'bundle', opcodes: ['owner_data'], argument: 'JSON',
    schemaBundle: bundle(), validationContext: () => context, ...options});
  const registry = new EditorRegistry();registry.register(definition);let committed = 0;
  const block = {targetId: 'sprite', blockId: 'data', opcode: 'owner_data', revision: '1', arguments: {JSON: {kind: 'literal', value: stored}}};
  const session = registry.open(block, {readBlock: () => block, commit: request => {committed++;block.arguments.JSON.value = request.changes[0].value;}});
  return {session, block, committed: () => committed};
}

test('both dialects validate closed external/self refs without mounting or altering canonical data', async () => {
  for (const dialect of ['draft-07', '2020-12']) {
    const schemaBundle = bundle(dialect), before = JSON.stringify(schemaBundle);
    const f = fixture({schemaBundle});f.session.setDraft({data: {n: 0}});
    {const r = await f.session.save();assert.equal(r.status, 'invalid', String(r.error));}assert.equal(f.committed(), 0);
    f.session.setDraft({data: {n: 2, children: [{n: 3}]}});assert.equal((await f.session.save()).status, 'saved');
    assert.equal(JSON.stringify(schemaBundle), before);f.session.dispose();
  }
});

test('bundle read/remount does not insert defaults and retains exact YAML when unchanged', async t => {
  const f = fixture({format: 'yaml'}, '# original\nn: 2\n');
  assert.deepEqual(f.session.getDraft(), {data: {n: 2}});
  assert.equal((await f.session.save()).status, 'saved');assert.equal(f.block.arguments.JSON.value, '# original\nn: 2\n');
  f.session.dispose();
  const empty = fixture({}, '{}');const container = document.createElement('div');document.body.append(container);
  t.after(() => {empty.session.dispose();container.remove();});
  let unmount;await act(async () => {unmount = empty.session.mount(container);});
  assert.deepEqual(empty.session.getDraft(), {data: {}});assert.equal(empty.session.getState().canSave, false);
  await act(async () => {unmount();empty.session.mount(container);});assert.deepEqual(empty.session.getDraft(), {data: {}});
});

test('live and save share owner checks, fresh contexts, field feedback, correction and cleanup', async t => {
  let nowMs = 0, legacyCalls = 0, calls = 0;
  const f = fixture({validationContext: () => ({...context, nowMs}), ownerValidate: (data, c) => {
    calls++;return data.n > 5 || c.nowMs > 100 ? {kind: 'invalid', issues: [{dataPath: '/n', ruleId: 'maximum'}]} : {kind: 'valid', issues: []};
  }, validateData: async () => {legacyCalls++;return [];}});
  const container = document.createElement('div');document.body.append(container);const unbind = bindBlockEditorFieldErrors(container);
  t.after(() => {unbind();f.session.dispose();container.remove();});
  await act(async () => {f.session.mount(container);});assert.equal(legacyCalls, 0);
  const input = container.querySelector('input[type="number"]');assert.ok(input);
  await act(async () => {Simulate.change(input, {target: {value: '6'}});});
  assert.equal(f.session.getState().canSave, false);assert.equal(input.getAttribute('aria-invalid'), 'true');
  assert.ok(input.getAttribute('aria-describedby'));assert.equal((await f.session.save()).status, 'invalid');assert.equal(legacyCalls, 0);
  await act(async () => {Simulate.change(input, {target: {value: '3'}});});
  assert.equal(f.session.getState().canSave, true);assert.notEqual(input.getAttribute('aria-invalid'), 'true');
  nowMs = 101;assert.equal((await f.session.save()).status, 'invalid');nowMs = 0;
  await act(async () => {assert.equal((await f.session.save()).status, 'saved');});assert.equal(legacyCalls, 1);assert.ok(calls >= 5);
  assert.equal(container.childNodes.length, 0);
});

test('presentation supports anchors and reports unsupported form constructs before registration', () => {
  const s = bundle('2020-12');s.root.document.properties.n.$ref = 'number#n';s.resources[0].document.$anchor = 'n';
  const f = fixture({schemaBundle: s});f.session.dispose();
  const unsupported = bundle('2020-12');unsupported.root.document = {type: 'array', prefixItems: [{type: 'number'}]};
  assert.throws(() => fixture({schemaBundle: unsupported}), /Unsupported form schema keyword/);
  const recursive = bundle();recursive.root.document.properties.child = {$ref: '#'};
  assert.throws(() => fixture({schemaBundle: recursive}), /recursive object form/);
  const api = createBlockEditorService().api;const remove = api.registerSchemaBundle({apiVersion: 1, extensionId: 'owner', editorId: 'bundle', opcodes: ['owner_data'], argument: 'JSON', schemaBundle: bundle(), validationContext: () => context});remove();
});

test('pointer field paths preserve dots, slashes, tildes and prototype-like names', () => {
  const errors = fieldErrors([{path: '/a.b/~0key/a~1b/__proto__', message: 'bad'}, {path: '/__errors', message: 'reserved'}]);
  assert.deepEqual(errors['a.b']['~key']['a/b'].__proto__.__errors, ['bad']);assert.deepEqual(errors.__errors, ['reserved']);assert.equal({}.polluted, undefined);
});

test('provider failure and missing dialect block registration/save without leaking raw failures', async () => {
  const f = fixture({validationContext: () => {throw Error('credentials');}});assert.equal((await f.session.save()).status, 'invalid');
  assert.equal(f.committed(), 0);assert.equal(JSON.stringify(f.session.getState().issues).includes('credentials'), false);f.session.dispose();
  const rejections = [];const listener = value => rejections.push(value);process.on('unhandledRejection', listener);
  try {
    const rejected = fixture({validationContext: () => Promise.reject(Error('private context'))});
    assert.equal((await rejected.session.save()).status, 'invalid');rejected.session.dispose();
    await new Promise(resolve => setImmediate(resolve));assert.deepEqual(rejections, []);
  } finally {process.off('unhandledRejection', listener);}
  const s = bundle();delete s.dialect;assert.throws(() => fixture({schemaBundle: s}), /dialect-required/);
});

test('2020-12 resource forms mount, edit and save without cross-session context leakage', async t => {
  const first = fixture({schemaBundle: bundle('2020-12'), validationContext: () => ({...context, consumerId: 'first'}),
    ownerValidate: (_data, c) => c.consumerId === 'first' ? {kind: 'valid', issues: []} : {kind: 'invalid', issues: [{dataPath: '/n', ruleId: 'context'}]}});
  const second = fixture({schemaBundle: bundle('2020-12'), validationContext: () => ({...context, consumerId: 'second'}),
    ownerValidate: () => ({kind: 'invalid', issues: [{dataPath: '/n', ruleId: 'context'}]})});
  const containers = [document.createElement('div'), document.createElement('div')];containers.forEach(c => document.body.append(c));
  t.after(() => {first.session.dispose();second.session.dispose();containers.forEach(c => c.remove());});
  await act(async () => {first.session.mount(containers[0]);second.session.mount(containers[1]);});
  assert.equal(first.session.getState().canSave, true);assert.equal(second.session.getState().canSave, false);
  await act(async () => {Simulate.change(containers[0].querySelector('input[type="number"]'), {target: {value: '4'}});});
  await act(async () => {assert.equal((await first.session.save()).status, 'saved');});
  assert.equal(first.block.arguments.JSON.value, '{"n":4}');assert.equal(second.committed(), 0);
});

test('registration snapshots one bundle value for both canonical checks and form presentation', () => {
  let reads = 0;
  const alternate = bundle('2020-12');alternate.root.document = {type: 'array', prefixItems: [{type: 'string'}]};
  const options = {apiVersion: 1, extensionId: 'owner', editorId: 'snapshot', opcodes: ['owner_data'], argument: 'JSON', validationContext: () => context};
  Object.defineProperty(options, 'schemaBundle', {enumerable: true, get() {reads++;return reads === 1 ? bundle() : alternate;}});
  assert.doesNotThrow(() => createSchemaBundleEditor(options));assert.equal(reads, 1);
});
