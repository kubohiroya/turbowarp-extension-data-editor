import {snapshotJson} from './schema-json.js';
import {captureDefaults} from './data.js';
import {captureFixedBranchRules} from './fixed-input-branches.js';
import type {FixedBlockSnapshot, FixedInputDeclaration, FixedInputDependency, FixedInputMetadata} from './fixed-input-types.js';
import type {ArgumentSlot, BlockReference, LiteralValue} from './types.js';

function fail(): never {throw new TypeError('Invalid fixed-input contract or snapshot.');}

/** Read each own data property once; accessors and prototype values cannot supply data. */
function own(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') return fail();
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !('value' in descriptor)) return fail();
  return descriptor.value;
}

function text(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) return fail();
  return value;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return fail();
  if (Object.getOwnPropertySymbols(value).length) return fail();
  return value as Record<string, unknown>;
}

function names(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return fail();
  const items: string[] = [];
  for (let i = 0; i < value.length; i++) items.push(text(own(value, String(i))));
  if (new Set(items).size !== items.length) return fail();
  return Object.freeze(items);
}

function dependencies(value: unknown, editable: ReadonlySet<string>): readonly FixedInputDependency[] {
  if (!Array.isArray(value)) return fail();
  const selectors = new Set<string>();
  const result: FixedInputDependency[] = [];
  for (let i = 0; i < value.length; i++) {
    const item = record(own(value, String(i)));
    const selector = text(own(item, 'selector'));
    const dependents = names(own(item, 'dependents'));
    if (!editable.has(selector) || selectors.has(selector) || dependents.length === 0 ||
        dependents.some(name => name === selector || !editable.has(name))) return fail();
    selectors.add(selector);
    result.push(Object.freeze({selector, dependents}));
  }
  return Object.freeze(result);
}

export function captureFixedInputDeclaration(value: FixedInputDeclaration): FixedInputDeclaration {
  const policy = Object.getOwnPropertyDescriptor(value, 'branchRules');
  if (policy && !('value' in policy)) return fail();
  const captured = record(snapshotJson({
    contractId: own(value, 'contractId'), contractRevision: own(value, 'contractRevision'),
    editableArguments: own(value, 'editableArguments'), readOnlyArguments: own(value, 'readOnlyArguments'),
    dependencies: own(value, 'dependencies')
  }));
  const editableArguments = names(captured.editableArguments);
  const readOnlyArguments = names(captured.readOnlyArguments);
  const editable = new Set(editableArguments);
  if (editable.size === 0 || readOnlyArguments.some(name => editable.has(name))) return fail();
  const groups = dependencies(captured.dependencies, editable);
  const branchRules = captureFixedBranchRules(policy?.value, groups, readOnlyArguments);
  return Object.freeze({
    contractId: text(captured.contractId), contractRevision: text(captured.contractRevision),
    editableArguments, readOnlyArguments, dependencies: groups,
    ...(policy?.value === undefined ? {} : {branchRules})
  });
}

export const validateFixedInputDeclaration = captureFixedInputDeclaration;

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const item = value as Record<string, unknown>;
  return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${canonical(item[key])}`).join(',')}}`;
}

function sameNames(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every(name => right.includes(name));
}

/** Preserve raw literals with Object.is semantics while copying metadata as finite JSON. */
export function captureFixedSnapshot(
  value: FixedBlockSnapshot, reference?: BlockReference, declaration?: FixedInputDeclaration
): FixedBlockSnapshot {
  record(value);
  const targetId = text(own(value, 'targetId'));
  const blockId = text(own(value, 'blockId'));
  if (reference && (targetId !== own(reference, 'targetId') || blockId !== own(reference, 'blockId'))) return fail();
  const opcode = text(own(value, 'opcode'));
  const revision = text(own(value, 'revision'));
  const inputArguments = record(own(value, 'arguments'));
  const argumentsCopy: Record<string, ArgumentSlot> = Object.create(null) as Record<string, ArgumentSlot>;
  for (const name of Object.keys(inputArguments)) {
    const item = record(own(inputArguments, name));
    const kind = own(item, 'kind');
    if (kind === 'reporter') argumentsCopy[name] = Object.freeze({kind});
    else if (kind === 'literal') {
      const raw = own(item, 'value');
      if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') return fail();
      argumentsCopy[name] = Object.freeze({kind, value: raw});
    } else return fail();
  }
  const context = record(snapshotJson(own(value, 'fixedContext')));
  const contractId = text(context.contractId);
  const contractRevision = text(context.contractRevision);
  const generation = text(context.generation);
  const readOnlyArguments = names(context.readOnlyArguments);
  const inputMetadata = record(context.inputs);
  const editable = new Set<string>();
  const inputs: Record<string, FixedInputMetadata> = Object.create(null) as Record<string, FixedInputMetadata>;
  for (const name of Object.keys(inputMetadata)) {
    const item = record(inputMetadata[name]);
    if (item.role !== 'editable' && item.role !== 'readonly') return fail();
    const role = item.role;
    if ((role === 'readonly') !== readOnlyArguments.includes(name)) return fail();
    if (role === 'editable') editable.add(name);
    const source = item.source;
    if (source !== 'shadow' && source !== 'field' && source !== 'reporter' && source !== 'unsupported' && source !== 'missing') return fail();
    const slot = argumentsCopy[name];
    if ((source === 'shadow' || source === 'field') && slot?.kind !== 'literal') return fail();
    if (source === 'reporter' && slot?.kind !== 'reporter') return fail();
    if (source === 'missing' && slot?.kind === 'literal') return fail();
    let field: FixedInputMetadata['field'];
    if (source === 'shadow' || source === 'field') {
      const capturedField = record(item.field);
      field = Object.freeze({blockId: text(capturedField.blockId), name: text(capturedField.name), type: text(capturedField.type)});
    } else if (item.field !== undefined) return fail();
    if (item.reason !== undefined && typeof item.reason !== 'string') return fail();
    if ((source === 'unsupported' || source === 'missing') && !item.reason) return fail();
    inputs[name] = Object.freeze({role, source, identity: text(item.identity),
      ...(field ? {field} : {}), ...(item.reason === undefined ? {} : {reason: item.reason})});
  }
  if (readOnlyArguments.some(name => !Object.hasOwn(inputs, name))) return fail();
  const capturedDependencies = dependencies(context.dependencies, editable);
  let defaults: Readonly<Record<string, LiteralValue>> | undefined;
  try {
    defaults = captureDefaults(value && typeof value === 'object' && Object.hasOwn(value, 'defaults') ? own(value, 'defaults') : undefined);
  } catch {return fail();}
  if (declaration) {
    const expected = captureFixedInputDeclaration(declaration);
    if (contractId !== expected.contractId || contractRevision !== expected.contractRevision ||
        !sameNames([...editable], expected.editableArguments) || !sameNames(readOnlyArguments, expected.readOnlyArguments) ||
        canonical(capturedDependencies) !== canonical(expected.dependencies)) return fail();
  }
  return Object.freeze({targetId, blockId, opcode, revision, arguments: Object.freeze(argumentsCopy), ...(defaults ? {defaults} : {}),
    fixedContext: Object.freeze({contractId, contractRevision, generation, readOnlyArguments,
      dependencies: capturedDependencies, inputs: Object.freeze(inputs)})});
}

export function sameFixedSnapshot(left: FixedBlockSnapshot, right: FixedBlockSnapshot): boolean {
  const a = captureFixedSnapshot(left);
  const b = captureFixedSnapshot(right);
  const keys = Object.keys(a.arguments);
  return a.targetId === b.targetId && a.blockId === b.blockId && a.opcode === b.opcode && a.revision === b.revision &&
    canonical(a.fixedContext) === canonical(b.fixedContext) && keys.length === Object.keys(b.arguments).length &&
    keys.every(name => {
      const x = a.arguments[name]!;
      const y = b.arguments[name];
      return !!y && x.kind === y.kind && (x.kind === 'reporter' || (y.kind === 'literal' && Object.is(x.value, y.value)));
    });
}
