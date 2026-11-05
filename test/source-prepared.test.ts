import assert from 'node:assert/strict';
import test from 'node:test';
import {parseDocument} from 'yaml';
import {EditorRegistry, DESCENDANT_EDITING_CAPABILITY} from '../dist/index.js';
import {createSourceEditor, createBlockEditorService} from '../dist/rjsf.js';
import {capturePreparedSave} from '../dist/prepared-save.js';

const context = {consumerId: 'consumer', nowMs: 1, settings: null};
const canonical = {repository: 'owner', path: 'document.schema.json'};
function bundle(variantId = 'document', document = {type: 'object', properties: {n: {type: 'number', minimum: 0, default: 9}}, required: ['n']}) {
  return {identity: {ownerId: 'owner', contractId: 'document', revision: '1', variantId}, dialect: 'draft-07',
    root: {retrievalUri: 'https://schema.invalid/source-document', document,
      artifact: {role: 'canonical-schema', source: canonical}}, resources: [],
    provenance: {canonicalSources: [canonical], generatedFiles: [], referenceSchemas: [], generationSources: []}};
}
function binding(argument = 'SOURCE', overrides = {}) {
  return {argument, variants: [{variantId: 'document', format: 'json', schemaBundle: bundle()},
    {variantId: 'document', format: 'yaml', schemaBundle: bundle()}],
    decode(source) {
      const format = source.trimStart().startsWith('{') ? 'json' : 'yaml';
      const data = format === 'json' ? JSON.parse(source) : parseDocument(source[0] === '\uFEFF' ? source.slice(1) : source).toJS();
      return {source, format, variantId: 'document', data};
    },
    validateSource(source) {return {source, result: {kind: 'valid', diagnostics: []}};}, ...overrides};
}
function options(overrides = {}) {
  return {apiVersion: 1, extensionId: 'owner', editorId: 'source', opcodes: ['owner_source'],
    bindings: [binding()], validationContext: () => context, ...overrides};
}
function block(sources = {SOURCE: '{"n":1}'}, blockId = 'root') {
  return {targetId: 'sprite', blockId, opcode: 'owner_source', revision: '1',
    arguments: Object.fromEntries(Object.entries(sources).map(([name, value]) => [name, {kind: 'literal', value}]))};
}
function fixture(editorOptions = {}, sources = {SOURCE: '{"n":1}'}, definitionOverride) {
  const definition = definitionOverride ?? createSourceEditor(options(editorOptions));
  const registry = new EditorRegistry();
  const remove = registry.registerPrepared(definition);
  const live = block(sources);
  const requests = [];
  const host = {readBlock: () => live, commit: request => {
    requests.push(request);
    for (const change of request.changes) live.arguments[change.argument].value = change.value;
  }};
  const session = registry.open(live, host);
  return {definition, registry, live, host, requests, session, remove};
}
function form(session, data, argument = 'SOURCE') {
  const draft = session.getDraft();
  draft.sources[argument].mode = 'form';
  draft.sources[argument].data = data;
  session.setDraft(draft);
}
function raw(session, source, argument = 'SOURCE') {
  const draft = session.getDraft();
  draft.sources[argument] = {mode: 'source', source};
  session.setDraft(draft);
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('prepared source editors require explicit registration and refuse legacy callbacks', () => {
  const definition = createSourceEditor(options());
  const registry = new EditorRegistry();
  assert.throws(() => registry.register(definition), /registerPrepared/);
  assert.throws(() => registry.registerPrepared({...definition, saveContract: undefined}));
  assert.throws(() => createBlockEditorService().api.register(definition), /registerPrepared/);
  assert.ok(definition.validate({}, block())[0].message.includes('prepared-host-required'));
  assert.throws(() => definition.createPatch({}, block()), /compatible host/);
  const service = createBlockEditorService();
  let notifications = 0;
  const unsubscribe = service.subscribe(() => notifications++);
  const remove = service.api.registerSourceEditor(options());
  assert.equal(service.registry.resolve('owner_source').editorId, 'source');
  remove();remove();unsubscribe();
  assert.equal(service.registry.resolve('owner_source'), undefined);
  assert.equal(notifications, 2);
});

test('raw no-op and form edit/revert keep bytes and perform no host commit', async () => {
  for (const source of [' { "n" : 1e0, "unknown": [1,1,2] }\r\n', '# top\nn: 1 # note\nunknown: [1, 1, 2]\n']) {
    let ownerCalls = 0;
    const f = fixture({bindings: [binding('SOURCE', {validateSource: candidate => {
      ownerCalls++;assert.equal(candidate, source);return {source: candidate, result: {kind: 'valid', diagnostics: []}};
    }})]}, {SOURCE: source});
    const initial = f.session.getDraft();
    assert.equal(initial.sources.SOURCE.mode, 'form');
    const draft = structuredClone(initial);
    draft.sources.SOURCE.data.n = 2;
    draft.sources.SOURCE.data.n = 1;
    f.session.setDraft(draft);
    assert.deepEqual(await f.session.save(), {status: 'saved', changed: false});
    assert.equal(ownerCalls, 1);assert.equal(f.requests.length, 0);
    assert.equal(f.live.arguments.SOURCE.value, source);
  }
});

test('invalid raw opens for explicit source repair without defaults or speculative serialization', async () => {
  const f = fixture({}, {SOURCE: '{bad'});
  assert.deepEqual(f.session.getDraft(), {sources: {SOURCE: {mode: 'source', source: '{bad'}}});
  raw(f.session, '{ "n" : 2, "unknown": true }');
  assert.deepEqual(await f.session.save(), {status: 'saved', changed: true});
  assert.equal(f.live.arguments.SOURCE.value, '{ "n" : 2, "unknown": true }');
  const empty = fixture({}, {SOURCE: '{}'});
  assert.deepEqual(empty.session.getDraft().sources.SOURCE.data, {});
  assert.equal((await empty.session.save()).status, 'invalid');
  assert.equal(empty.requests.length, 0);
  empty.session.dispose();
});

test('form patch uses existing format and validates the exact candidate committed once', async () => {
  const source = '\uFEFF# source\r\nn: 1 # keep\r\nunknown: [1, 1, 2]\r\n';
  const candidates = [];
  const f = fixture({bindings: [binding('SOURCE', {validateSource: candidate => {
    candidates.push(candidate);return {source: candidate, result: {kind: 'valid', diagnostics: []}};
  }})]}, {SOURCE: source});
  form(f.session, {n: 2, unknown: [1, 1, 2]});
  assert.equal((await f.session.save()).status, 'saved');
  assert.deepEqual(candidates, [source.replace('n: 1', 'n: 2')]);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].changes[0].value, candidates[0]);
  assert.equal(f.live.arguments.SOURCE.value, candidates[0]);
});

test('owner context is fresh once per save, frozen and shared across all bindings', async () => {
  let now = 1;let providerCalls = 0;
  const contexts = [];
  const validateSource = (source, captured) => {
    contexts.push(captured);assert.equal(Object.isFrozen(captured), true);assert.equal(Object.isFrozen(captured.settings), true);
    return {source, result: captured.nowMs > 5 ? {kind: 'invalid', diagnostics: [{code: 'expired'}]} : {kind: 'valid', diagnostics: []}};
  };
  const f = fixture({bindings: [binding('A', {validateSource}), binding('B', {validateSource})],
    validationContext: () => {providerCalls++;return {...context, nowMs: now, settings: {enabled: true}};}
  }, {A: '{"n":1}', B: '{"n":2}'});
  assert.equal(providerCalls, 0);
  now = 10;
  assert.equal((await f.session.save()).status, 'invalid');
  assert.equal(providerCalls, 1);assert.equal(contexts[0], contexts[1]);
  assert.equal(contexts[0].nowMs, 10);assert.equal(f.requests.length, 0);
  now = 2;
  assert.equal((await f.session.save()).status, 'saved');
  assert.equal(providerCalls, 2);assert.equal(contexts[2], contexts[3]);
  assert.notEqual(contexts[0], contexts[2]);
  assert.equal(contexts[2].nowMs, 2);
});

test('two bindings capture changes atomically and reject all when one owner or schema fails', async () => {
  let rejectB = true;
  const f = fixture({bindings: [binding('A'), binding('B', {validateSource: source => ({source,
    result: rejectB ? {kind: 'invalid', diagnostics: [{code: 'owner-rejected'}]} : {kind: 'valid', diagnostics: []}})})]},
  {A: '{"n":1}', B: '{"n":2}'});
  form(f.session, {n: 3}, 'A');form(f.session, {n: 4}, 'B');
  assert.equal((await f.session.save()).status, 'invalid');assert.equal(f.requests.length, 0);
  assert.equal(f.live.arguments.A.value, '{"n":1}');assert.equal(f.live.arguments.B.value, '{"n":2}');
  rejectB = false;
  form(f.session, {n: -1}, 'B');
  assert.equal((await f.session.save()).status, 'invalid');assert.equal(f.requests.length, 0);
  form(f.session, {n: 4}, 'B');
  assert.equal((await f.session.save()).status, 'saved');
  assert.equal(f.requests.length, 1);assert.equal(f.requests[0].changes.length, 2);
  assert.equal(f.live.arguments.A.value, '{"n":3}');assert.equal(f.live.arguments.B.value, '{"n":4}');
});

test('owner result is bound to the exact candidate, failures stay generic', async () => {
  for (const output of [source => ({source: source + ' ', result: {kind: 'valid', diagnostics: []}}),
    source => ({source, result: {kind: 'valid', diagnostics: [{code: 'unexpected'}]}}),
    source => ({source, result: {kind: 'future-kind', diagnostics: []}}),
    () => {throw Error('private credentials');}]) {
    const f = fixture({bindings: [binding('SOURCE', {validateSource: output})]});
    form(f.session, {n: 2});
    assert.equal((await f.session.save()).status, 'invalid');assert.equal(f.requests.length, 0);
    assert.equal(JSON.stringify(f.session.getState().issues).includes('private credentials'), false);
    f.session.dispose();
  }
});

test('owner, context and decoder accessors/iterators never supply data or writes', async () => {
  let reads = 0;
  const accessor = () => Object.defineProperty({}, 'source', {enumerable: true, get() {reads++;return 'unsafe';}});
  const customArray = () => {
    const diagnostics = [];
    diagnostics[Symbol.iterator] = function* () {reads++;};
    return diagnostics;
  };
  const cases = [
    {bindings: [binding('SOURCE', {validateSource: accessor})]},
    {bindings: [binding('SOURCE', {validateSource: source => ({source, result: {kind: 'valid', diagnostics: customArray()}})})]},
    {bindings: [binding('SOURCE', {decode: accessor})]},
    {validationContext: () => Object.defineProperty({}, 'consumerId', {enumerable: true, get() {reads++;return 'consumer';}})}
  ];
  for (const editorOptions of cases) {
    const f = fixture(editorOptions);
    raw(f.session, '{"n":2}');
    assert.equal((await f.session.save()).status, 'invalid');assert.equal(f.requests.length, 0);
    f.session.dispose();
  }
  assert.equal(reads, 0);
});

test('rejected native promises from synchronous callbacks are drained and cannot write', async () => {
  const rejections = [];
  const listener = error => rejections.push(error);
  process.on('unhandledRejection', listener);
  try {
    for (const editorOptions of [
      {validationContext: () => Promise.reject(Error('private context'))},
      {bindings: [binding('SOURCE', {validateSource: () => Promise.reject(Error('private owner'))})]},
      {bindings: [binding('SOURCE', {decode: () => Promise.reject(Error('private decoder'))})]}
    ]) {
      const f = fixture(editorOptions);
      raw(f.session, '{"n":2}');
      assert.equal((await f.session.save()).status, 'invalid');assert.equal(f.requests.length, 0);
      f.session.dispose();
    }
    await tick();assert.deepEqual(rejections, []);
  } finally {process.off('unhandledRejection', listener);}
});

test('capturePreparedSave rejects accessor, iterator, thenable and malformed output without invoking them', () => {
  let reads = 0;
  const outputs = [Object.defineProperty({}, 'kind', {enumerable: true, get() {reads++;return 'ready';}}),
    {kind: 'ready', changes: Object.assign([], {[Symbol.iterator]: () => {reads++;return [][Symbol.iterator]();}})},
    Object.defineProperty({}, 'then', {enumerable: true, get() {reads++;return () => {};}}),
    {kind: 'ready', changes: [{argument: 'SOURCE', value: Infinity}]},
    {kind: 'invalid', issues: []}, {kind: 'future', changes: []}];
  for (const output of outputs) assert.throws(() => capturePreparedSave({prepareSave: () => output}, {}, block()));
  assert.equal(reads, 0);
});

test('capturePreparedSave snapshots one result and does not follow later mutations', () => {
  const output = {kind: 'ready', changes: [{argument: 'SOURCE', value: 'first'}]};
  let calls = 0;
  const result = capturePreparedSave({prepareSave: () => {calls++;return output;}}, {}, block());
  output.changes[0].value = 'later';output.changes.push({argument: 'SOURCE', value: 'unexpected'});
  assert.equal(calls, 1);assert.deepEqual(result, {kind: 'ready', changes: [{argument: 'SOURCE', value: 'first'}]});
  assert.equal(Object.isFrozen(result.changes), true);assert.equal(Object.isFrozen(result.changes[0]), true);
});

test('prepared single sessions call preparation once and never legacy validate/createPatch', async () => {
  let prepares = 0;let legacyCalls = 0;
  const definition = createSourceEditor(options());
  const f = fixture({}, undefined, {...definition,
    validate() {legacyCalls++;throw Error('legacy validate');}, createPatch() {legacyCalls++;throw Error('legacy patch');},
    prepareSave(draft, snapshot) {prepares++;return definition.prepareSave(draft, snapshot);}});
  form(f.session, {n: 2});
  assert.equal((await f.session.save()).status, 'saved');assert.equal(prepares, 1);assert.equal(legacyCalls, 0);
});

function descendants(prepared) {
  const registry = new EditorRegistry();registry.registerPrepared(prepared);
  const root = block({SOURCE: '{"n":1}'}, 'root');
  const child = block({SOURCE: '{"n":2}'}, 'child');
  const scope = {targetId: 'sprite', blockId: 'root', generation: 'generation-1', nodes: [
    {block: root, branches: [{input: 'SUBSTACK', blockIds: ['child']}]}, {block: child, branches: []}]};
  const requests = [];
  const host = {readBlock: ref => scope.nodes.find(node => node.block.blockId === ref.blockId)?.block,
    commit: () => {throw Error('single host must not commit descendants');},
    descendants: {capability: DESCENDANT_EDITING_CAPABILITY, readSubtree: () => scope,
      commitSubtree: request => {requests.push(request);}}};
  return {registry, requests, session: registry.openDescendants(root, host), scope};
}

test('descendant sessions prepare each source once and commit all nodes atomically without legacy calls', async () => {
  let prepares = 0;let legacyCalls = 0;
  const definition = createSourceEditor(options());
  const f = descendants({...definition, validate() {legacyCalls++;throw Error('legacy');},
    createPatch() {legacyCalls++;throw Error('legacy');},
    prepareSave(draft, snapshot) {prepares++;return definition.prepareSave(draft, snapshot);}});
  form(f.session.getEditor('root'), {n: 3});form(f.session.getEditor('child'), {n: 4});
  assert.equal((await f.session.save()).status, 'saved');
  assert.equal(prepares, 2);assert.equal(legacyCalls, 0);assert.equal(f.requests.length, 1);
  assert.deepEqual(f.requests[0].changes, [
    {blockId: 'root', argument: 'SOURCE', value: '{"n":3}'},
    {blockId: 'child', argument: 'SOURCE', value: '{"n":4}'}]);
});

test('one invalid descendant blocks every prepared write and attaches the right node', async () => {
  const f = descendants(createSourceEditor(options()));
  form(f.session.getEditor('root'), {n: 3});form(f.session.getEditor('child'), {n: -1});
  const result = await f.session.save();
  assert.equal(result.status, 'invalid');assert.equal(f.requests.length, 0);
  assert.equal(result.issues[0].reference.blockId, 'child');
  assert.equal(f.scope.nodes[0].block.arguments.SOURCE.value, '{"n":1}');
  f.session.dispose();
});

test('malformed prepared writes are rejected at single and descendant host boundaries', async () => {
  const base = createSourceEditor(options());
  for (const changes of [
    [{argument: 'SOURCE', value: 'first'}, {argument: 'SOURCE', value: 'second'}],
    [{argument: 'UNDECLARED', value: 'unexpected'}],
    [{argument: 'SOURCE', value: NaN}],
    [{argument: 'SOURCE', value: {nested: true}}]
  ]) {
    const definition = {...base, prepareSave: () => ({kind: 'ready', changes})};
    const f = fixture({}, undefined, definition);
    assert.equal((await f.session.save()).status, 'failed');assert.equal(f.requests.length, 0);
    assert.equal(f.live.arguments.SOURCE.value, '{"n":1}');f.session.dispose();
    const aggregate = descendants(definition);
    assert.equal((await aggregate.session.save()).status, 'failed');assert.equal(aggregate.requests.length, 0);
    aggregate.session.dispose();
  }
});
test('native rejected prepareSave promises are drained in both host paths', async () => {
  const rejections = [];
  const listener = error => rejections.push(error);
  process.on('unhandledRejection', listener);
  try {
    const definition = {...createSourceEditor(options()), prepareSave: () => Promise.reject(Error('private prepare'))};
    const f = fixture({}, undefined, definition);
    assert.equal((await f.session.save()).status, 'failed');assert.equal(f.requests.length, 0);f.session.dispose();
    const aggregate = descendants(definition);
    assert.equal((await aggregate.session.save()).status, 'failed');assert.equal(aggregate.requests.length, 0);aggregate.session.dispose();
    await tick();assert.deepEqual(rejections, []);
  } finally {process.off('unhandledRejection', listener);}
});
test('foreign thenables are rejected without reading then or invoking iterators', async () => {
  let calls = 0;
  const thenable = Object.defineProperty({}, 'then', {enumerable: true, get() {calls++;return () => {calls++;};}});
  for (const editorOptions of [
    {validationContext: () => thenable},
    {bindings: [binding('SOURCE', {decode: () => thenable})]},
    {bindings: [binding('SOURCE', {validateSource: () => thenable})]}
  ]) {
    const f = fixture(editorOptions);
    raw(f.session, '{"n":2}');assert.equal((await f.session.save()).status, 'invalid');assert.equal(f.requests.length, 0);f.session.dispose();
  }
  assert.equal(calls, 0);
});
test('unknown variants are source-only and cannot silently select a form schema', async () => {
  const decode = source => ({source, format: 'json', variantId: 'unknown', data: JSON.parse(source)});
  const f = fixture({bindings: [binding('SOURCE', {decode})]});
  assert.equal(f.session.getDraft().sources.SOURCE.mode, 'source');
  assert.equal((await f.session.save()).status, 'saved');assert.equal(f.requests.length, 0);
  const changed = fixture({bindings: [binding('SOURCE', {decode})]});
  raw(changed.session, '{"n":2}');assert.equal((await changed.session.save()).status, 'invalid');assert.equal(changed.requests.length, 0);
  changed.session.dispose();
});
test('source callback capabilities, duplicate arguments and malformed variants fail registration', () => {
  for (const editorOptions of [
    {bindings: []}, {bindings: [binding(), binding()]},
    {bindings: [binding('SOURCE', {decode: undefined})]},
    {bindings: [binding('SOURCE', {validateSource: undefined})]},
    {bindings: [binding('SOURCE', {variants: []})]},
    {bindings: [binding('SOURCE', {variants: [{variantId: 'document', format: 'jsonc', schemaBundle: bundle()}]})]},
    {bindings: [binding('SOURCE', {variants: [{variantId: 'document', format: 'json', schemaBundle: bundle()},
      {variantId: 'document', format: 'json', schemaBundle: bundle()}]})]}
  ]) assert.throws(() => createSourceEditor(options(editorOptions)));
});

test('owner-accepted JSON trim whitespace is retained around the exact prepared candidate', async () => {
  const source = '\uFEFF \t{ "n": 1, "unknown": [1,1,2] }\r\n\uFEFF';
  const candidates = [];
  const f = fixture({bindings: [binding('SOURCE', {
    decode: source => ({source, format: 'json', variantId: 'document', data: JSON.parse(source.trim())}),
    validateSource: candidate => {
      candidates.push(candidate);
      JSON.parse(candidate.trim());
      return {source: candidate, result: {kind: 'valid', diagnostics: []}};
    }
  })]}, {SOURCE: source});
  form(f.session, {n: 2, unknown: [1, 1, 2]});
  assert.equal((await f.session.save()).status, 'saved');
  assert.deepEqual(candidates, [source.replace('"n": 1', '"n": 2')]);
  assert.equal(f.requests[0].changes[0].value, candidates[0]);
});

test('removed or replaced prepared registration cannot commit an already opened session', async () => {
  for (const replace of [false, true]) {
    let ownerCalls = 0;
    const f = fixture({bindings: [binding('SOURCE', {validateSource: source => {
      ownerCalls++;return {source, result: {kind: 'valid', diagnostics: []}};
    }})]});
    form(f.session, {n: 2});
    f.remove();
    if (replace) f.registry.registerPrepared(createSourceEditor(options()));
    assert.equal((await f.session.save()).status, 'conflict');
    assert.equal(ownerCalls, 0);assert.equal(f.requests.length, 0);
    assert.equal(f.live.arguments.SOURCE.value, '{"n":1}');
    f.session.dispose();
  }
});
test('registration removed during owner preparation is checked again before commit', async () => {
  let remove;
  const f = fixture({bindings: [binding('SOURCE', {validateSource: source => {
    remove();return {source, result: {kind: 'valid', diagnostics: []}};
  }})]});
  remove = f.remove;
  form(f.session, {n: 2});
  assert.equal((await f.session.save()).status, 'conflict');assert.equal(f.requests.length, 0);f.session.dispose();
});
function autoFormatBinding() {
  return binding('SOURCE', {
    variants: ['json', 'yaml'].map(format => ({variantId: 'document', format, schemaBundle: bundle('document', true)})),
    decode(source) {
      try {return {source, format: 'json', variantId: 'document', data: JSON.parse(source)};}
      catch {
        const doc = parseDocument(source[0] === '\uFEFF' ? source.slice(1) : source);
        if (doc.errors.length) throw new TypeError('Malformed source.');
        return {source, format: 'yaml', variantId: 'document', data: doc.toJS()};
      }
    }
  });
}
test('auto-detected YAML collection emptied in Form retains YAML format and owner exact validation', async () => {
  const accepted = [];
  const original = '- 1 # first\n- 2 # last\n';
  const sourceBinding = autoFormatBinding();
  sourceBinding.validateSource = source => {
    accepted.push(source);return {source, result: {kind: 'valid', diagnostics: []}};
  };
  const f = fixture({bindings: [sourceBinding]}, {SOURCE: original});
  assert.equal(sourceBinding.decode(original).format, 'yaml');
  form(f.session, []);
  assert.equal((await f.session.save()).status, 'saved');
  assert.equal(sourceBinding.decode(f.live.arguments.SOURCE.value).format, 'yaml');
  assert.deepEqual(sourceBinding.decode(f.live.arguments.SOURCE.value).data, []);
  assert.equal(f.live.arguments.SOURCE.value, accepted[0]);
  assert.ok(f.live.arguments.SOURCE.value.includes('# first'));
  assert.ok(f.live.arguments.SOURCE.value.includes('# last'));
});
test('explicit creation selects the requested JSON/YAML format without implicit variant choice', async () => {
  for (const format of ['json', 'yaml']) for (const data of [null, [], {}]) {
    const sourceBinding = autoFormatBinding();
    const f = fixture({bindings: [sourceBinding]}, {SOURCE: '{broken'});
    f.session.setDraft({sources: {SOURCE: {mode: 'form', source: '{broken', sourceEdited: true,
      creating: {format, variantId: 'document'}, data}}});
    assert.equal((await f.session.save()).status, 'saved', `${format}/${JSON.stringify(data)}`);
    const output = sourceBinding.decode(f.live.arguments.SOURCE.value);
    assert.equal(output.format, format);assert.equal(output.variantId, 'document');assert.deepEqual(output.data, data);
  }
  const f = fixture({bindings: [autoFormatBinding()]}, {SOURCE: '{broken'});
  f.session.setDraft({sources: {SOURCE: {mode: 'form', source: '{broken', sourceEdited: true,
    creating: {format: 'yaml', variantId: 'missing'}, data: {}}}});
  assert.equal((await f.session.save()).status, 'invalid');assert.equal(f.requests.length, 0);f.session.dispose();
});

test('registration removed by the final host read is rejected before any prepared commit', async () => {
  const f = fixture();
  form(f.session, {n: 2});
  f.host.readBlock = () => {f.remove();return f.live;};
  assert.equal((await f.session.save()).status, 'conflict');assert.equal(f.requests.length, 0);f.session.dispose();
});
test('Form does not silently change variants; explicit Source repair may select another registered variant', async () => {
  const sourceBinding = binding('SOURCE', {
    variants: ['document', 'other'].map(variantId => ({variantId, format: 'json', schemaBundle: bundle(variantId)})),
    decode: source => {
      const data = JSON.parse(source);
      return {source, format: 'json', variantId: data.n === 2 ? 'other' : 'document', data};
    }
  });
  const implicit = fixture({bindings: [sourceBinding]});
  form(implicit.session, {n: 2});
  assert.equal((await implicit.session.save()).status, 'invalid');assert.equal(implicit.requests.length, 0);implicit.session.dispose();
  const explicit = fixture({bindings: [sourceBinding]});
  raw(explicit.session, '{"n":2}');
  assert.equal((await explicit.session.save()).status, 'saved');assert.equal(explicit.requests.length, 1);
});


test('explicit owner-defined source-only variants allow repairing a source to an empty no-op', async () => {
  const b = binding('SOURCE');const originalDecode = b.decode;
  const f = fixture({bindings: [{...b, sourceOnlyVariants:[{format:'yaml',variantId:'empty'}],
    decode: source => source.trim() ? originalDecode(source) : {source,format:'yaml',variantId:'empty',data:null},
    validateSource: source => ({source,result:{kind:'valid',diagnostics:[]}})}]});
  raw(f.session, '  \n');assert.equal((await f.session.save()).status,'saved');
  assert.equal(f.requests[0].changes[0].value,'  \n');
});

test('prepared sessions keep separate drafts and a second session conflicts after the first commit', async () => {
  const f = fixture();const second = f.registry.open(f.live, f.host);
  form(f.session, {n:2});form(second, {n:3});
  assert.equal((await f.session.save()).status,'saved');
  assert.equal(second.getDraft().sources.SOURCE.data.n,3);
  assert.equal((await second.save()).status,'conflict');
  assert.equal(f.requests.length,1);assert.equal(JSON.parse(f.live.arguments.SOURCE.value).n,2);second.dispose();
});

test('a pending prepared commit blocks double Save and edits without preparing a second candidate', async () => {
  let ownerCalls=0;const f=fixture({bindings:[binding('SOURCE',{validateSource: source => {
    ownerCalls++;return {source,result:{kind:'valid',diagnostics:[]}};
  }})]});
  let release;const original=f.host.commit;f.host.commit=async request => {await new Promise(resolve=>{release=resolve;});original(request);};
  form(f.session,{n:2});const saving=f.session.save();
  assert.equal((await f.session.save()).status,'busy');assert.equal(ownerCalls,1);
  assert.throws(()=>form(f.session,{n:3}),/editable/);assert.equal(f.session.cancel(),false);
  release();assert.equal((await saving).status,'saved');assert.equal(f.requests.length,1);assert.equal(ownerCalls,1);
});
