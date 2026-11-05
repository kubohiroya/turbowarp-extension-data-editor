import assert from 'node:assert/strict';
import test from 'node:test';
import {EditorRegistry} from '../dist/index.js';
import {createFixedInputEditor, createBlockEditorService} from '../dist/rjsf.js';
import {captureFixedPreparedSave} from '../dist/fixed-input-editor.js';

const canonical = {repository: 'owner', path: 'fixed.schema.json'};
function bundle(document = {type: 'number'}) {
  return {identity: {ownerId: 'owner', contractId: 'fixed', revision: '1', variantId: 'number'}, dialect: 'draft-07',
    root: {retrievalUri: 'https://schema.invalid/fixed', document, artifact: {role: 'canonical-schema', source: canonical}}, resources: [],
    provenance: {canonicalSources: [canonical], generatedFiles: [], referenceSchemas: [], generationSources: []}};
}
function binding(overrides = {}) {
  return {argument: 'VALUE', schemaBundle: bundle(), read: value => value,
    encode: value => value, validateCandidate: () => [], ...overrides};
}
function options(overrides = {}) {
  return {apiVersion: 1, extensionId: 'owner', editorId: 'fixed', opcodes: ['owner_fixed'], contractId: 'owner.fixed', contractRevision: '1',
    readOnlyArguments: ['CONDITION'], bindings: [binding()], validationContext: () => ({consumerId: 'consumer', nowMs: 1, settings: null}), ...overrides};
}
function block(value = 10) {
  return {targetId: 'sprite', blockId: 'root', opcode: 'owner_fixed', revision: 'r1', arguments: {VALUE: {kind: 'literal', value}, CONDITION: {kind: 'literal', value: 'ready'}},
    fixedContext: {contractId: 'owner.fixed', contractRevision: '1', generation: 'g1', readOnlyArguments: ['CONDITION'], dependencies: [], inputs: {
      VALUE: {role: 'editable', source: 'shadow', identity: 'value:1', field: {blockId: 'shadow', name: 'NUM', type: 'math_number'}},
      CONDITION: {role: 'readonly', source: 'shadow', identity: 'condition:1', field: {blockId: 'condition', name: 'TEXT', type: 'text'}}
    }}};
}
function fixture(editorOptions = {}, value = 10, definitionOverride, configure = () => {}) {
  const definition = definitionOverride ?? createFixedInputEditor(options(editorOptions));
  const registry = new EditorRegistry();
  const remove = registry.registerFixed(definition);
  const live = block(value);configure(live);
  const requests = [];
  const port = {capability: 'fixed-inputs-v1', readBlock: (_reference, declaration) => {
    assert.equal(declaration.contractId, 'owner.fixed');return live;
  }, commit: request => {requests.push(request);}};
  const host = {readBlock: () => live, commit: () => {throw new Error('legacy commit must not run');}, fixedInputs: port};
  const session = registry.open(live, host);
  return {definition, registry, remove, live, requests, port, host, session};
}
function edit(session, value, extras = {}) {
  const draft = session.getDraft();draft.inputs.VALUE = {value, changed: true, ...extras};session.setDraft(draft);
}

test('fixed registration is explicit and service capability defaults off', () => {
  const definition = createFixedInputEditor(options());
  const registry = new EditorRegistry();
  assert.throws(() => registry.register(definition), /registerFixed/);
  assert.throws(() => registry.registerPrepared(definition));
  assert.throws(() => definition.read(block()), /compatible host/);
  assert.throws(() => definition.createPatch({}, block()), /compatible host/);
  assert.match(definition.validate({}, block())[0].message, /fixed-host-required/);
  assert.equal(Object.hasOwn(createBlockEditorService().api, 'registerFixedInputEditor'), false);
  assert.equal(Object.hasOwn(createBlockEditorService({fixedInputs: false}).api, 'registerFixedInputEditor'), false);
  const service = createBlockEditorService({fixedInputs: true});
  let notifications = 0;service.subscribe(() => notifications++);
  const remove = service.api.registerFixedInputEditor(options());
  assert.equal(service.registry.resolve('owner_fixed').editorId, 'fixed');remove();remove();
  assert.equal(service.registry.resolve('owner_fixed'), undefined);assert.equal(notifications, 2);
});

test('old host cannot open a fixed definition', () => {
  const f = fixture();delete f.host.fixedInputs;
  assert.equal(f.registry.open(f.live, f.host), undefined);
  f.host.fixedInputs = {...f.port, capability: 'legacy'};
  assert.equal(f.registry.open(f.live, f.host), undefined);
});

test('unchanged aliases and unrepresentable raw remain exact without owner calls', async () => {
  for (const value of [' OLD ', NaN, Infinity, -Infinity]) {
    let encodes = 0;let validations = 0;
    const f = fixture({bindings: [binding({read: raw => typeof raw === 'string' ? raw.trim() : raw,
      encode: value => {encodes++;return value;}, validateCandidate: () => {validations++;return [];}})]}, value);
    const result = await f.session.save();
    assert.deepEqual(result, {status: 'saved', changed: false});
    assert.equal(f.requests.length, 0);assert.equal(encodes, 0);assert.equal(validations, 0);
    assert.ok(Object.is(f.live.arguments.VALUE.value, value));
  }
});

test('the exact candidate is constructed and owner-validated once before fixed commit', async () => {
  let encodes = 0;let validations = 0;let candidate;
  const f = fixture({bindings: [binding({encode: value => {encodes++;candidate = value + 1;return candidate;}, validateCandidate: value => {validations++;assert.equal(value, candidate);return [];}})]});
  edit(f.session, 20);
  assert.deepEqual(await f.session.save(), {status: 'saved', changed: true});
  assert.equal(encodes, 1);assert.equal(validations, 1);assert.equal(f.requests[0].changes[0].value, candidate);
  assert.ok(Object.isFrozen(f.requests[0]));assert.ok(Object.isFrozen(f.requests[0].context));
  assert.equal(f.requests[0].expected.fixedContext.inputs.CONDITION.role, 'readonly');
});

test('schema validates the exact encoded candidate projection, not an earlier form value', async () => {
  const f = fixture({bindings: [binding({schemaBundle: bundle({type: 'number', minimum: 10}), encode: () => 9})]});
  edit(f.session, 20);assert.equal((await f.session.save()).status, 'invalid');assert.equal(f.requests.length, 0);
});

test('changing a value without the change flag is rejected as a whole', async () => {
  const f = fixture();edit(f.session, 20, {changed: false});
  assert.equal((await f.session.save()).status, 'invalid');assert.equal(f.requests.length, 0);
});

test('edit then revert preserves an alias raw literal without normalization', async () => {
  let encodes = 0;
  const f = fixture({bindings: [binding({read: value => String(value).trim(), encode: value => {encodes++;return value;}})]}, ' old ');
  edit(f.session, 'old');
  assert.deepEqual(await f.session.save(), {status: 'saved', changed: false});assert.equal(encodes, 0);
});

test('new negative zero is distinct from the existing positive zero', async () => {
  const f = fixture({}, 0);edit(f.session, -0);
  assert.deepEqual(await f.session.save(), {status: 'saved', changed: true});assert.ok(Object.is(f.requests[0].changes[0].value, -0));
});

test('nonfinite new candidates never reach owner validation or commit', async () => {
  for (const bad of [NaN, Infinity, -Infinity]) {
    let ownerCalls = 0;
    const f = fixture({bindings: [binding({encode: () => bad, validateCandidate: () => {ownerCalls++;return [];}})]});
    edit(f.session, 20);assert.equal((await f.session.save()).status, 'invalid');assert.equal(ownerCalls, 0);assert.equal(f.requests.length, 0);
  }
});

test('unrepresentable existing raw allows only explicit finite repair of a literal field', async () => {
  const f = fixture({}, Infinity);edit(f.session, 20, {repair: true});
  assert.deepEqual(await f.session.save(), {status: 'saved', changed: true});assert.equal(f.requests[0].changes[0].value, 20);
  const implicit = fixture({}, Infinity);edit(implicit.session, 20);
  assert.equal((await implicit.session.save()).status, 'invalid');assert.equal(implicit.requests.length, 0);
});

test('reporters stay readonly even when a repair draft is forged', async () => {
  const f = fixture();f.session.dispose();
  f.live.arguments.VALUE = {kind: 'reporter'};
  f.live.fixedContext.inputs.VALUE = {role: 'editable', source: 'reporter', identity: 'reporter:1'};
  const session = f.registry.open(f.live, f.host);edit(session, 20, {repair: true});
  assert.equal((await session.save()).status, 'invalid');assert.equal(f.requests.length, 0);
});

test('owner diagnostic content is replaced with safe contract and argument diagnostics', async () => {
  const f = fixture({bindings: [binding({validateCandidate: () => [{message: 'SECRET raw source', path: '/secret'}]})]});
  edit(f.session, 20);const result = await f.session.save();
  assert.equal(result.status, 'invalid');assert.match(result.issues[0].message, /owner\.fixed/);assert.match(result.issues[0].message, /VALUE/);
  assert.equal(result.issues[0].path, '/VALUE');assert.doesNotMatch(result.issues[0].message, /SECRET|secret/);
});

test('synchronous callback contracts reject promises and accessors without reading them', async () => {
  let reads = 0;
  const f = fixture({bindings: [binding({validateCandidate: () => [Object.defineProperty({}, 'message', {enumerable: true, get() {reads++;throw new Error('SECRET');}})]})]});
  edit(f.session, 20);assert.equal((await f.session.save()).status, 'invalid');assert.equal(reads, 0);assert.equal(f.requests.length, 0);
  const asynchronous = fixture({validationContext: async () => {throw new Error('context rejected');}});
  edit(asynchronous.session, 20);assert.equal((await asynchronous.session.save()).status, 'invalid');
  await new Promise(resolve => setImmediate(resolve));
});

test('prepared output capture rejects custom iterators rather than skipping writes', () => {
  const definition = createFixedInputEditor(options());let iteratorCalls = 0;
  const changes = [{argument: 'VALUE', value: 20}];changes[Symbol.iterator] = function* () {iteratorCalls++;};
  assert.throws(() => captureFixedPreparedSave({...definition, prepareFixedSave: () => ({kind: 'ready', changes, context: {consumerId: 'x', nowMs: 1, settings: null}})}, {}, block()));
  assert.equal(iteratorCalls, 0);
});

test('forged prepared readonly patch rejects all changes and never commits the legal part', async () => {
  const original = createFixedInputEditor(options());
  const f = fixture({}, 10, {...original, prepareFixedSave: () => ({kind: 'ready', changes: [{argument: 'VALUE', value: 20}, {argument: 'CONDITION', value: 'forged'}], context: {consumerId: 'x', nowMs: 1, settings: null}})});
  edit(f.session, 20);assert.equal((await f.session.save()).status, 'failed');assert.equal(f.requests.length, 0);
});

test('unregistering during preparation invalidates the complete save', async () => {
  let remove;
  const f = fixture({validationContext: () => {remove();return {consumerId: 'x', nowMs: 1, settings: null};}});remove = f.remove;
  edit(f.session, 20);assert.equal((await f.session.save()).status, 'conflict');assert.equal(f.requests.length, 0);
});

test('read-only identity or value changes cause a fixed snapshot conflict', async () => {
  for (const mutate of [live => {live.arguments.CONDITION.value = 'changed';}, live => {live.fixedContext.inputs.CONDITION.identity = 'new';}]) {
    const f = fixture();edit(f.session, 20);mutate(f.live);
    assert.equal((await f.session.save()).status, 'conflict');assert.equal(f.requests.length, 0);
  }
});

test('fresh context is immutable and separated from the mutable owner source', async () => {
  const context = {consumerId: 'x', nowMs: 1, settings: {mode: 'safe'}};
  const f = fixture({validationContext: () => context, bindings: [binding({validateCandidate: (_candidate, captured) => {
    assert.ok(Object.isFrozen(captured.settings));assert.throws(() => {captured.settings.mode = 'changed';});return [];
  }})]});edit(f.session, 20);
  assert.equal((await f.session.save()).status, 'saved');assert.equal(context.settings.mode, 'safe');assert.notEqual(f.requests[0].context, context);
});

test('incomplete numeric buffers cannot hide behind an unchanged projection', async () => {
  const f = fixture();edit(f.session, 10, {buffer: '1e'});
  assert.equal((await f.session.save()).status, 'invalid');assert.equal(f.requests.length, 0);
});

test('a valid numeric buffer commits the exact validated token once', async () => {
  let encodes = 0;let candidate;
  const f = fixture({bindings: [binding({read: raw => Number(raw), encode: value => {encodes++;candidate = value;return value;}, validateCandidate: value => {assert.equal(value, '2e1');return [];}})]}, '10');
  edit(f.session, 20, {buffer: '2e1'});
  assert.deepEqual(await f.session.save(), {status: 'saved', changed: true});
  assert.equal(f.requests[0].changes[0].value, '2e1');assert.equal(candidate, '2e1');assert.equal(encodes, 1);
});

test('numeric buffer value mismatch, hidden buffer, or codec rewrite rejects the whole save', async () => {
  for (const [value, extras, overrides] of [
    [21, {buffer: '20'}, {}], [20, {buffer: '20', changed: false}, {}],
    [20, {buffer: '2e1'}, {encode: value => Number(value)}]
  ]) {
    const f = fixture({bindings: [binding({read: raw => Number(raw), ...overrides})]}, '10');edit(f.session, value, extras);
    assert.equal((await f.session.save()).status, 'invalid');assert.equal(f.requests.length, 0);
  }
});

test('invalid attempted save retains the numeric buffer until a terminal session action', async () => {
  const f = fixture();edit(f.session, 10, {buffer: '1e'});
  assert.equal((await f.session.save()).status, 'invalid');assert.equal(f.session.getDraft().inputs.VALUE.buffer, '1e');
  assert.equal(f.session.cancel(), true);assert.throws(() => f.session.getDraft(), /closed/);
});

test('mock fixed contract preserves an unsupported selector group while saving an independent literal', async () => {
  // S3-1 contract-only coverage: this is not an execution of owner BC11/BC14 fixtures.
  const definition = createFixedInputEditor(options({
    bindings: [binding({argument: 'SELECTOR', schemaBundle: bundle({type: 'string'})}), binding(), binding({argument: 'INDEPENDENT'})],
    dependencies: [{selector: 'SELECTOR', dependents: ['VALUE']}]
  }));
  const registry = new EditorRegistry();registry.registerFixed(definition);
  const live = block();live.arguments.SELECTOR = {kind: 'literal', value: ' UNKNOWN raw '};
  live.arguments.INDEPENDENT = {kind: 'literal', value: 1};
  live.fixedContext.dependencies = [{selector: 'SELECTOR', dependents: ['VALUE']}];
  live.fixedContext.inputs.SELECTOR = {role: 'editable', source: 'unsupported', identity: 'unsupported-selector:1', reason: 'Unapproved custom field'};
  live.fixedContext.inputs.INDEPENDENT = {role: 'editable', source: 'field', identity: 'independent:1', field: {blockId: 'root', name: 'INDEPENDENT', type: 'FieldNumber'}};
  const requests = [];
  const host = {readBlock: () => live, commit() {throw new Error('legacy write');}, fixedInputs: {
    capability: 'fixed-inputs-v1', readBlock: () => live, commit: request => {requests.push(request);}
  }};
  const session = registry.open(live, host);
  const draft = session.getDraft();assert.deepEqual(draft.inputs.SELECTOR, {readOnly: true});
  draft.inputs.INDEPENDENT = {value: 2, changed: true};session.setDraft(draft);
  assert.deepEqual(await session.save(), {status: 'saved', changed: true});
  assert.deepEqual(requests[0].changes, [{argument: 'INDEPENDENT', value: 2}]);
  assert.equal(requests[0].expected.arguments.SELECTOR.value, ' UNKNOWN raw ');
  assert.equal(requests[0].expected.arguments.VALUE.value, 10);
  const repair = registry.open(live, host);const forged = repair.getDraft();
  forged.inputs.SELECTOR = {value: 'known', changed: true, repair: true};repair.setDraft(forged);
  assert.equal((await repair.save()).status, 'invalid');assert.equal(requests.length, 1);
});

test('owner candidate validation receives the captured immutable related raw snapshot', async () => {
  const f = fixture({bindings: [binding({validateCandidate: (_candidate, _context, snapshot) => {
    assert.equal(snapshot.arguments.CONDITION.value, 'ready');assert.ok(Object.isFrozen(snapshot));
    assert.ok(Object.isFrozen(snapshot.fixedContext.inputs.CONDITION));return [];
  }})]});edit(f.session, 20);
  assert.equal((await f.session.save()).status, 'saved');
});

function dependentOptions() {
  return options({bindings: [binding(), binding({argument: 'OTHER'})], dependencies: [{selector: 'VALUE', dependents: ['OTHER']}]});
}
function addDependent(live) {
  live.arguments.OTHER = {kind: 'literal', value: 30};
  live.fixedContext.dependencies = [{selector: 'VALUE', dependents: ['OTHER']}];
  live.fixedContext.inputs.OTHER = {role: 'editable', source: 'field', identity: 'other:1', field: {blockId: 'root', name: 'OTHER', type: 'FieldNumber'}};
}
test('declared dependency group edits fail closed until branch validation is implemented', async () => {
  for (const argument of ['VALUE', 'OTHER']) {
    const f = fixture(dependentOptions(), 10, undefined, addDependent);
    const draft = f.session.getDraft();draft.inputs[argument] = {value: 40, changed: true};f.session.setDraft(draft);
    const result = await f.session.save();assert.equal(result.status, 'invalid');
    assert.match(result.issues[0].message, /fixed-dependency-validation-unavailable/);assert.equal(f.requests.length, 0);
  }
});

test('a handcrafted prepared patch cannot bypass the dependency group gate', async () => {
  const definition = {...createFixedInputEditor(dependentOptions()), prepareFixedSave: () => ({kind: 'ready', changes: [{argument: 'VALUE', value: 20}], context: {consumerId: 'x', nowMs: 1, settings: null}})};
  const f = fixture({}, 10, definition, addDependent);edit(f.session, 20);
  assert.equal((await f.session.save()).status, 'failed');assert.equal(f.requests.length, 0);
});

test('unregistering during a deferred commit aborts the port before any write', async () => {
  const f = fixture();let resume;let request;let writes = 0;
  f.port.commit = async captured => {request = captured;await new Promise(resolve => {resume = resolve;});if (captured.signal.aborted) throw captured.signal.reason;writes++;};
  edit(f.session, 20);const saving = f.session.save();
  assert.equal(f.session.getState().status, 'saving');assert.equal(f.session.cancel(), false);assert.equal(f.session.dispose(), false);
  f.remove();assert.equal(request.signal.aborted, true);resume();
  assert.equal((await saving).status, 'conflict');assert.equal(writes, 0);
});

test('registration commit subscriptions are released after success or failure', async () => {
  for (const fail of [false, true]) {
    const f = fixture();let signal;
    f.port.commit = request => {signal = request.signal;if (fail) throw new Error('host failed');};
    edit(f.session, 20);assert.equal((await f.session.save()).status, fail ? 'failed' : 'saved');
    if (fail) assert.equal(f.session.cancel(), true);
    f.session.dispose();f.remove();assert.equal(signal.aborted, false);
  }
});

test('fixed registration rejects declaration accessors without executing or replacing callbacks', () => {
  const original = createFixedInputEditor(options());let reads = 0;
  for (const key of ['apiVersion', 'extensionId', 'editorId', 'saveContract', 'opcodes', 'editableArguments',
    'readOnlyArguments', 'dependencies', 'contractId', 'contractRevision', 'read', 'validate', 'createPatch', 'readFixed', 'prepareFixedSave', 'mount']) {
    const definition = {...original};
    Object.defineProperty(definition, key, {enumerable: true, get() {reads++;return original[key];}});
    const registry = new EditorRegistry();assert.throws(() => registry.registerFixed(definition), TypeError);
    assert.equal(registry.resolve('owner_fixed'), undefined);
  }
  assert.equal(reads, 0);
});

test('fixed registration rejects input array iterators and indexed getters without running them', () => {
  const original = createFixedInputEditor(options());let calls = 0;
  for (const key of ['opcodes', 'editableArguments', 'readOnlyArguments', 'dependencies']) {
    const array = [...original[key]];
    array[Symbol.iterator] = function* () {calls++;yield 'foreign_opcode';};
    const registry = new EditorRegistry();assert.throws(() => registry.registerFixed({...original, [key]: array}), TypeError);
    assert.equal(registry.resolve('foreign_opcode'), undefined);assert.equal(registry.resolve('owner_fixed'), undefined);
  }
  const opcodes = ['owner_fixed'];Object.defineProperty(opcodes, 0, {get() {calls++;return 'owner_fixed';}});
  assert.throws(() => new EditorRegistry().registerFixed({...original, opcodes}), TypeError);
  assert.equal(calls, 0);
});

test('fixed factory captures only own data options and bindings without invoking accessors', () => {
  let reads = 0;
  for (const key of ['apiVersion', 'extensionId', 'editorId', 'opcodes', 'contractId', 'contractRevision', 'bindings', 'validationContext', 'readOnlyArguments', 'dependencies']) {
    const original = options();const input = {...original};
    Object.defineProperty(input, key, {enumerable: true, get() {reads++;return original[key];}});
    assert.throws(() => createFixedInputEditor(input), TypeError);
  }
  for (const key of ['argument', 'schemaBundle', 'read', 'encode', 'validateCandidate']) {
    const original = binding();const input = {...original};
    Object.defineProperty(input, key, {enumerable: true, get() {reads++;return original[key];}});
    assert.throws(() => createFixedInputEditor(options({bindings: [input]})), TypeError);
  }
  assert.equal(reads, 0);
});

test('fixed factory rejects opcode or binding iterators and indexed getters without executing them', () => {
  let calls = 0;
  const opcodes = ['owner_fixed'];opcodes[Symbol.iterator] = function* () {calls++;yield 'foreign_opcode';};
  assert.throws(() => createFixedInputEditor(options({opcodes})), TypeError);
  const bindings = [binding()];bindings[Symbol.iterator] = function* () {calls++;yield binding();};
  assert.throws(() => createFixedInputEditor(options({bindings})), TypeError);
  const indexed = [binding()];Object.defineProperty(indexed, 0, {get() {calls++;return binding();}});
  assert.throws(() => createFixedInputEditor(options({bindings: indexed})), TypeError);
  assert.equal(calls, 0);
});

test('fixed registration captures the checked callback and opcode data independently of later mutations', async () => {
  const original = createFixedInputEditor(options());const definition = {...original, opcodes: ['owner_fixed']};
  const registry = new EditorRegistry();registry.registerFixed(definition);
  definition.opcodes[0] = 'foreign_opcode';definition.readFixed = () => {throw new Error('changed callback must not run');};
  const live = block();const requests = [];
  const host = {readBlock: () => live, commit() {}, fixedInputs: {capability: 'fixed-inputs-v1', readBlock: () => live, commit: request => {requests.push(request);}}};
  assert.equal(registry.resolve('foreign_opcode'), undefined);assert.equal(registry.resolve('owner_fixed').editorId, 'fixed');
  const session = registry.open(live, host);edit(session, 20);
  assert.equal((await session.save()).status, 'saved');assert.equal(requests[0].changes[0].value, 20);
});
