import assert from 'node:assert/strict';
import {createBlockEditorService} from '../../dist/rjsf.js';
import {createFixedInputEditor} from '../../dist/fixed-input-editor.js';
import {validateFixedBranchChanges} from '../../dist/fixed-input-branches.js';
import {sameFixedSnapshot} from '../../dist/fixed-input-snapshot.js';
import {BlockEditorConflictError} from '../../dist/types.js';

const source = {repository: 'turbowarp-extension-data-editor', path: 'test/fixtures/fixed-form-fixture.ts'};
export function bundle(document = {type: 'string'}, variant = 'plain') {
  return {identity: {ownerId: 'common-fixture', contractId: 'fixed-ui', revision: '1', variantId: variant}, dialect: 'draft-07',
    root: {retrievalUri: `https://common-fixtures.invalid/${encodeURIComponent(variant)}`, document,
      artifact: {role: 'canonical-schema', source}}, resources: [],
    provenance: {canonicalSources: [source], generatedFiles: [], referenceSchemas: [], generationSources: []}};
}
export const choices = values => values.map(value => ({value, label: value}));
export function binding(argument, control = {kind: 'text'}, document = {type: 'string'}, extra = {}) {
  return {argument, control, schemaBundle: bundle(document, `${argument}-${control.kind}`),
    read: value => value, encode: value => value, validateCandidate: () => [], ...extra};
}
export const numeric = (argument = 'TIMEOUT') => binding(argument, {kind: 'number'}, {type: 'number', exclusiveMinimum: 0}, {
  read: value => {const parsed = Number(value);if (typeof value !== 'string' || !Number.isFinite(parsed)) throw new TypeError();return parsed;},
  encode: value => String(value)
});
export function policyOptions(policy = 'CP-bubble-close') {
  const shell = {apiVersion: 1, extensionId: 'commonfixture', editorId: 'fixed', opcodes: ['commonfixture_fixed'],
    contractId: `common-fixture.${policy}`, contractRevision: '1',
    validationContext: () => ({consumerId: 'common-fixture', nowMs: 0, settings: null})};
  if (policy === 'common-only') return {...shell, bindings: [binding('SELECTOR', {kind: 'enum', choices: choices(['known'])}), binding('DEPENDENT'), binding('INDEPENDENT')],
    dependencies: [{selector: 'SELECTOR', dependents: ['DEPENDENT']}],
    branchPolicies: [{selector: 'SELECTOR', cases: [{values: ['known'], activeDependents: ['DEPENDENT']}]}]};
  if (policy === 'CP-bubble-close') return {...shell,
    bindings: [binding('TRIGGER', {kind: 'enum', choices: choices(['condition', 'timeout', 'condition-or-timeout'])}), numeric()],
    readOnlyArguments: ['CONDITION'], dependencies: [{selector: 'TRIGGER', dependents: ['TIMEOUT']}],
    branchPolicies: [{selector: 'TRIGGER', cases: [
      {values: ['condition'], activeDependents: [], requireOnSelectorChange: [{argument: 'CONDITION', rule: 'nonempty-string'}]},
      {values: ['timeout'], activeDependents: ['TIMEOUT']},
      {values: ['condition-or-timeout'], activeDependents: ['TIMEOUT'], requireOnSelectorChange: [{argument: 'CONDITION', rule: 'nonempty-string'}]}
    ]}]};
  assert.ok(policy === 'CP-asset-cache' || policy === 'CP-asset-manager');
  const reset = '';
  const variants = [
    ['animation', binding('VALUE', {kind: 'enum', choices: choices(['', 'none', 'type', 'rainbow', 'zoom', 'shake']), reset}, {type: 'string', enum: ['', 'none', 'type', 'rainbow', 'zoom', 'shake']})],
    ['font', binding('VALUE', {kind: 'text', reset})],
    ['color', binding('VALUE', {kind: 'color', reset}, {type: 'string', pattern: '^(?:|#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6})$'})],
    ['width', binding('VALUE', {kind: 'number', reset}, {type: 'string', anyOf: [{const: ''}, {pattern: '^\\s*-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?\\s*$'}]}, {
      validateCandidate: value => value === '' || (typeof value === 'string' && Number.isFinite(Number(value)) && Number(value) > 0) ? [] : [{message: 'Invalid fixture width.'}]
    })],
    ['align', binding('VALUE', {kind: 'enum', choices: choices(['', 'left', 'center', 'right']), reset}, {type: 'string', enum: ['', 'left', 'center', 'right']})]
  ];
  return {...shell, bindings: [binding('PROPERTY', {kind: 'enum', choices: choices(variants.map(([name]) => name))}), binding('VALUE')],
    dependencies: [{selector: 'PROPERTY', dependents: ['VALUE']}], branchPolicies: [{selector: 'PROPERTY', normalize: {trim: true, lowercase: true},
      cases: variants.map(([name, item]) => ({values: [name], activeDependents: ['VALUE'], bindings: [item]}))}]};
}

/** Common-only mock port: actual native VM/field transactions have their separate integration suite. */
export function formFixture(policy, seed, configure = {}) {
  const options = configure.options ?? policyOptions(policy);
  const service = createBlockEditorService({fixedInputs: true, ...(configure.messages ? {fixedInputMessages: configure.messages} : {})});
  const remove = configure.definition
    ? service.registry.registerFixed(configure.definition(createFixedInputEditor(options)))
    : service.api.registerFixedInputEditor(options);
  const declaration = service.registry.resolveFixed(options.opcodes[0]);
  const raw = Object.fromEntries(Object.entries(seed).filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value)));
  const live = {targetId: 'sprite', blockId: 'fixed', opcode: options.opcodes[0], revision: 'r1', arguments: {},
    fixedContext: {contractId: options.contractId, contractRevision: options.contractRevision, generation: 'g1',
      readOnlyArguments: options.readOnlyArguments ?? [], dependencies: options.dependencies ?? [], inputs: {}}};
  for (const argument of new Set([...options.bindings.map(item => item.argument), ...(options.readOnlyArguments ?? []), ...Object.keys(raw)])) {
    const spec = raw[argument] ?? {state: 'missing'};
    const role = options.readOnlyArguments?.includes(argument) ? 'readonly' : 'editable';
    const identity = spec.reporter?.identity ?? `${argument}:1`;
    const declared = options.bindings.some(item => item.argument === argument) || options.readOnlyArguments?.includes(argument);
    if (!declared) {
      if (spec.reporter) live.arguments[argument] = {kind: 'reporter'};
      else if (Object.hasOwn(spec, 'literal')) live.arguments[argument] = {kind: 'literal', value: spec.literal};
      continue;
    }
    if (spec.reporter) {
      live.arguments[argument] = {kind: 'reporter'};
      live.fixedContext.inputs[argument] = {role, source: 'reporter', identity};
    } else if (Object.hasOwn(spec, 'literal')) {
      live.arguments[argument] = {kind: 'literal', value: spec.literal};
      live.fixedContext.inputs[argument] = {role, source: 'shadow', identity, field: {blockId: `${argument}-shadow`, name: 'TEXT', type: 'text'}};
    } else if (spec.state === 'unsupported-field') {
      live.arguments[argument] = {kind: 'literal', value: 'unavailable'};
      live.fixedContext.inputs[argument] = {role, source: 'unsupported', identity, reason: 'Unsupported common fixture field.'};
    } else live.fixedContext.inputs[argument] = {role, source: 'missing', identity, reason: 'Missing common fixture input.'};
  }
  const requests = []; const invalidation = new Set();
  const port = {capability: 'fixed-inputs-v1', readBlock: () => live,
    subscribeInvalidation: (_reference, _declaration, listener) => {invalidation.add(listener);return () => invalidation.delete(listener);},
    commit: request => {
      if (!sameFixedSnapshot(request.expected, live)) throw new BlockEditorConflictError('Fixture changed.');
      if (validateFixedBranchChanges(declaration, live, request.changes).length) throw new TypeError('Invalid fixed fixture changes.');
      if (configure.failCommit) throw new TypeError('Fixture commit rejected.');
      for (const change of request.changes) live.arguments[change.argument] = {kind: 'literal', value: change.value};
      requests.push(request);live.revision = `r${requests.length + 1}`;
    }};
  const host = {readBlock: () => live, commit: () => {throw new Error('Legacy commit must not run.');}, fixedInputs: port};
  const session = service.registry.open(live, host);
  assert.ok(session);
  return {service, options, declaration, remove, live, requests, host, port, session,
    invalidate: () => {for (const listener of [...invalidation]) listener();},
    close: () => {session.dispose();remove();}};
}
