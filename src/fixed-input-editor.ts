import {compileSchemaBundle} from './schema-engine.js';
import {isJsonRecord, snapshotJson} from './schema-json.js';
import {isLiteral} from './data.js';
import {parseFixedNumberInput} from './fixed-input-schema.js';
import {fitsBasicJsonSchema} from './json-schema-authoring.js';
import {captureFixedInputDeclaration, captureFixedSnapshot} from './fixed-input-snapshot.js';
import {resolveFixedBranches, validateFixedBranchChanges} from './fixed-input-branches.js';
import type {FixedBlockSnapshot, FixedInputBranchRule, FixedInputControl, FixedInputDeclaration, FixedInputEditorDefinition,
  FixedInputViewDescription, FixedInputViewInput, FixedPreparedSave} from './fixed-input-types.js';
import type {CompiledSchema, SchemaBundle, SchemaValidationContext} from './schema-types.js';
import type {EditorDefinition, JsonObject, JsonValue, LiteralArgumentChange, LiteralValue, ValidationIssue} from './types.js';

export interface FixedInputBinding<C = null> {
  readonly argument: string;
  readonly schemaBundle: SchemaBundle;
  readonly control?: FixedInputControl;
  /** Produce a JSON editing projection. Throw to retain the raw literal as readonly. */
  read(value: LiteralValue): JsonValue;
  /** Construct the exact literal candidate once. A numeric buffer supplies its validated string token, which must be returned unchanged. Neither this nor validation may be asynchronous. */
  encode(value: JsonValue, context: SchemaValidationContext<C>): LiteralValue;
  /** Check the exact candidate. Messages from this callback are never rendered verbatim. */
  validateCandidate(candidate: LiteralValue, context: SchemaValidationContext<C>, snapshot: FixedBlockSnapshot): readonly ValidationIssue[];
  /**
   * For a `json` control: the names a user may pick (for example defined schema names). Called once
   * per block revision while the dialog is open; the list is copied, never kept live.
   */
  listNames?(snapshot: FixedBlockSnapshot): readonly string[];
}
export interface FixedInputBranchPolicy<C = null> extends Omit<FixedInputBranchRule, 'cases'> {
  readonly cases: readonly (FixedInputBranchRule['cases'][number] & {readonly bindings?: readonly FixedInputBinding<C>[]})[];
}
export interface FixedInputEditorOptions<C = null> {
  readonly apiVersion: 1;
  readonly extensionId: string;
  readonly editorId: string;
  readonly opcodes: readonly string[];
  readonly contractId: string;
  readonly contractRevision: string;
  readonly readOnlyArguments?: readonly string[];
  readonly dependencies?: FixedInputDeclaration['dependencies'];
  readonly branchPolicies?: readonly FixedInputBranchPolicy<C>[];
  readonly bindings: readonly FixedInputBinding<C>[];
  readonly validationContext: () => SchemaValidationContext<C>;
}
function fixedDeclarationError(): never {throw new TypeError('Invalid fixed editor declaration.');}
function plainDeclaration(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) ||
      Object.getOwnPropertySymbols(value).length) fixedDeclarationError();
}
/** Callback-bearing declarations cannot be JSON-copied as a whole. Read own data only. */
function ownData(value: unknown, key: string, optional = false): unknown {
  if (!value || typeof value !== 'object') return fixedDeclarationError();
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) {if (optional) return undefined;return fixedDeclarationError();}
  if (!('value' in descriptor)) return fixedDeclarationError();
  return descriptor.value;
}
function declarationText(value: unknown): string {
  if (typeof value !== 'string' || !value) return fixedDeclarationError();
  return value;
}
/** Capture callback-bearing array elements by index, without running input iterators. */
function declarationArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || Object.getOwnPropertySymbols(value).length) return fixedDeclarationError();
  const length = ownData(value, 'length');
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0 || length > 100_000) return fixedDeclarationError();
  for (const key of Object.getOwnPropertyNames(value)) {
    if (key !== 'length' && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length)) return fixedDeclarationError();
  }
  const items: unknown[] = [];
  for (let i = 0; i < length; i++) items.push(ownData(value, String(i)));
  return Object.freeze(items);
}
function declarationJson(value: unknown): ReturnType<typeof snapshotJson> {
  try {return snapshotJson(value);} catch {return fixedDeclarationError();}
}
function fixedDeclaration(value: FixedInputDeclaration): FixedInputDeclaration {
  try {return captureFixedInputDeclaration(value);} catch {return fixedDeclarationError();}
}
function captureOpcodes(value: unknown, extensionId: string): readonly string[] {
  const items = declarationJson(value);
  if (!Array.isArray(items) || !items.length || items.some(opcode => typeof opcode !== 'string' ||
      !opcode.startsWith(`${extensionId}_`) || opcode === `${extensionId}_`) || new Set(items).size !== items.length) return fixedDeclarationError();
  return Object.freeze(items as string[]);
}
/** Capture exactly the callbacks and declaration values subsequently registered. */
export function captureFixedInputEditorDefinition<C = null>(value: FixedInputEditorDefinition<C>): FixedInputEditorDefinition<C> {
  plainDeclaration(value);
  const apiVersion = ownData(value, 'apiVersion');
  const extensionId = declarationText(ownData(value, 'extensionId'));
  const editorId = declarationText(ownData(value, 'editorId'));
  const saveContract = ownData(value, 'saveContract');
  if (apiVersion !== 1 || saveContract !== 'prepared-fixed-v1') return fixedDeclarationError();
  const opcodes = captureOpcodes(ownData(value, 'opcodes'), extensionId);
  const branchRules = ownData(value, 'branchRules', true);
  const declaration = fixedDeclaration({
    contractId: declarationText(ownData(value, 'contractId')), contractRevision: declarationText(ownData(value, 'contractRevision')),
    editableArguments: ownData(value, 'editableArguments') as readonly string[],
    readOnlyArguments: ownData(value, 'readOnlyArguments') as readonly string[],
    dependencies: ownData(value, 'dependencies') as FixedInputDeclaration['dependencies'],
    ...(branchRules === undefined ? {} : {branchRules: branchRules as readonly FixedInputBranchRule[]})
  });
  const read = ownData(value, 'read');
  const validate = ownData(value, 'validate');
  const createPatch = ownData(value, 'createPatch');
  const readFixed = ownData(value, 'readFixed');
  const prepareFixedSave = ownData(value, 'prepareFixedSave');
  const mount = ownData(value, 'mount', true);
  const describeFixed = ownData(value, 'describeFixed', true);
  if (typeof read !== 'function' || typeof validate !== 'function' || typeof createPatch !== 'function' ||
      typeof readFixed !== 'function' || typeof prepareFixedSave !== 'function' ||
      (mount !== undefined && typeof mount !== 'function') ||
      (describeFixed !== undefined && typeof describeFixed !== 'function')) return fixedDeclarationError();
  return Object.freeze({apiVersion, extensionId, editorId, opcodes, saveContract, ...declaration,
    read: read as EditorDefinition['read'], validate: validate as EditorDefinition['validate'], createPatch: createPatch as EditorDefinition['createPatch'],
    readFixed: readFixed as FixedInputEditorDefinition<C>['readFixed'], prepareFixedSave: prepareFixedSave as FixedInputEditorDefinition<C>['prepareFixedSave'],
    ...(describeFixed === undefined ? {} : {describeFixed: describeFixed as NonNullable<FixedInputEditorDefinition<C>['describeFixed']>}),
    ...(mount === undefined ? {} : {mount: mount as NonNullable<EditorDefinition['mount']>})});
}
function drain(value: unknown): void {
  try {void Promise.prototype.then.call(value as Promise<unknown>, () => undefined, () => undefined);}
  catch { /* Reject arbitrary thenables without invoking then. */ }
}
function copySync(value: unknown): ReturnType<typeof snapshotJson> {
  try {return snapshotJson(value);} catch (error) {drain(value);throw error;}
}
function freeze(value: unknown): void {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);Object.freeze(value);
  }
}
function sameProjection(left: JsonValue, right: JsonValue): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => sameProjection(value, right[index]!));
  }
  const names = Object.keys(left);
  return names.length === Object.keys(right).length && names.every(name => Object.hasOwn(right, name) && sameProjection(left[name]!, right[name]!));
}
const pointer = (name: string): string => `/${name.replace(/~/g, '~0').replace(/\//g, '~1')}`;
export function isFixedInputEditor(definition: EditorDefinition): definition is FixedInputEditorDefinition<unknown> {
  return (definition as Partial<FixedInputEditorDefinition<unknown>>).saveContract === 'prepared-fixed-v1';
}
/** Capture a synchronous callback result without invoking getters, iterators, or toJSON. */
export function captureFixedPreparedSave<C = null>(definition: FixedInputEditorDefinition<C>, draft: JsonObject,
  snapshot: FixedBlockSnapshot): FixedPreparedSave<C> {
  const value = copySync(definition.prepareFixedSave(draft, snapshot));
  if (!isJsonRecord(value)) throw new TypeError('Invalid fixed prepared save.');
  if (value.kind === 'invalid' && Array.isArray(value.issues) && value.issues.length > 0) {
    const issues: ValidationIssue[] = [];
    for (let i = 0; i < value.issues.length; i++) {
      const issue = value.issues[i];
      if (!isJsonRecord(issue) || typeof issue.message !== 'string' || (issue.path !== undefined && typeof issue.path !== 'string')) throw new TypeError('Invalid fixed issue.');
      issues.push(Object.freeze({message: issue.message, ...(issue.path === undefined ? {} : {path: issue.path})}));
    }
    return Object.freeze({kind: 'invalid', issues: Object.freeze(issues)});
  }
  if (value.kind !== 'ready' || !Array.isArray(value.changes) || !isJsonRecord(value.context) ||
      typeof value.context.consumerId !== 'string' || !value.context.consumerId ||
      typeof value.context.nowMs !== 'number' || !Number.isFinite(value.context.nowMs) || !Object.hasOwn(value.context, 'settings')) throw new TypeError('Invalid fixed prepared save.');
  const changes: LiteralArgumentChange[] = [];
  for (let i = 0; i < value.changes.length; i++) {
    const change = value.changes[i];
    if (!isJsonRecord(change) || typeof change.argument !== 'string' || !isLiteral(change.value)) throw new TypeError('Invalid fixed change.');
    changes.push(Object.freeze({argument: change.argument, value: change.value}));
  }
  freeze(value.context);
  return Object.freeze({kind: 'ready', changes: Object.freeze(changes), context: value.context as unknown as SchemaValidationContext<C>});
}

/** Fixed inputs are additive: legacy callbacks cannot accidentally save their drafts. */
export function createFixedInputEditor<C = null>(options: FixedInputEditorOptions<C>): FixedInputEditorDefinition<C> {
  plainDeclaration(options);
  const apiVersion = ownData(options, 'apiVersion');
  const extensionId = declarationText(ownData(options, 'extensionId'));
  const editorId = declarationText(ownData(options, 'editorId'));
  const contractId = declarationText(ownData(options, 'contractId'));
  const contractRevision = declarationText(ownData(options, 'contractRevision'));
  const contextProvider = ownData(options, 'validationContext');
  const opcodes = captureOpcodes(ownData(options, 'opcodes'), extensionId);
  const inputBindings = declarationArray(ownData(options, 'bindings'));
  const readOnlyArguments = ownData(options, 'readOnlyArguments', true);
  const dependencies = ownData(options, 'dependencies', true);
  const branchPolicies = ownData(options, 'branchPolicies', true);
  if (apiVersion !== 1 || !inputBindings.length || typeof contextProvider !== 'function') throw new TypeError('Invalid fixed editor options.');
  const provider = contextProvider as FixedInputEditorOptions<C>['validationContext'];
  type Binding = {argument: string; read: FixedInputBinding<C>['read']; encode: FixedInputBinding<C>['encode'];
    validateCandidate: FixedInputBinding<C>['validateCandidate']; validator: CompiledSchema; schemaBundle: SchemaBundle; control?: FixedInputControl;
    listNames?: NonNullable<FixedInputBinding<C>['listNames']>};
  const compileBinding = (binding: unknown): Binding => {
    plainDeclaration(binding);
    const argument = declarationText(ownData(binding, 'argument'));
    const read = ownData(binding, 'read');
    const encode = ownData(binding, 'encode');
    const validateCandidate = ownData(binding, 'validateCandidate');
    const schemaBundle = declarationJson(ownData(binding, 'schemaBundle')) as unknown as SchemaBundle;
    const inputControl = ownData(binding, 'control', true);
    const listNames = ownData(binding, 'listNames', true);
    let control: FixedInputControl | undefined;
    if (inputControl !== undefined) {
      const item = declarationJson(inputControl);
      if (!isJsonRecord(item) || !['text', 'number', 'enum', 'color', 'json'].includes(item.kind as string) ||
          (item.basic !== undefined && (item.kind !== 'json' || item.basic !== 'json-schema')) ||
          (item.label !== undefined && typeof item.label !== 'string') ||
          (item.choices !== undefined && (!Array.isArray(item.choices) || item.choices.some(choice =>
            !isJsonRecord(choice) || !Object.hasOwn(choice, 'value') || (choice.label !== undefined && typeof choice.label !== 'string'))))) return fixedDeclarationError();
      freeze(item);control = item as unknown as FixedInputControl;
    }
    if (typeof read !== 'function' || typeof encode !== 'function' || typeof validateCandidate !== 'function' ||
        (listNames !== undefined && (typeof listNames !== 'function' || control?.kind !== 'json'))) throw new TypeError('Invalid fixed binding callbacks.');
    const result = compileSchemaBundle(schemaBundle);
    if (result.kind !== 'compiled') throw new TypeError('Invalid fixed input schema.');
    freeze(schemaBundle);
    return Object.freeze({argument, read: read as FixedInputBinding<C>['read'], encode: encode as FixedInputBinding<C>['encode'],
      validateCandidate: validateCandidate as FixedInputBinding<C>['validateCandidate'], validator: result.validator, schemaBundle,
      ...(control === undefined ? {} : {control}),
      ...(listNames === undefined ? {} : {listNames: listNames as NonNullable<FixedInputBinding<C>['listNames']>})});
  };
  // Owner names are read once per block revision, not on every render.
  const nameCache = new Map<string, readonly string[] | undefined>();
  const namesFor = (binding: Binding, snapshot: FixedBlockSnapshot): readonly string[] | undefined => {
    if (!binding.listNames) return undefined;
    const key = JSON.stringify([snapshot.revision, binding.argument]);
    if (!nameCache.has(key)) {
      if (nameCache.size > 32) nameCache.clear();
      let names: readonly string[] | undefined;
      try {
        const value = copySync(binding.listNames(snapshot));
        names = Array.isArray(value) && value.every(name => typeof name === 'string') ? Object.freeze([...new Set(value as string[])]) : undefined;
      } catch {names = undefined;}
      nameCache.set(key, names);
    }
    return nameCache.get(key);
  };
  const bindings = inputBindings.map(compileBinding);
  const policyBindings: (readonly (readonly Binding[])[])[] = [];
  const policyRules: FixedInputBranchRule[] = [];
  if (branchPolicies !== undefined) {
    for (const input of declarationArray(branchPolicies)) {
      plainDeclaration(input);
      const selector = declarationText(ownData(input, 'selector'));
      const normalization = ownData(input, 'normalize', true);
      const cases: FixedInputBranchRule['cases'][number][] = [];
      const variants: (readonly Binding[])[] = [];
      for (const caseInput of declarationArray(ownData(input, 'cases'))) {
        plainDeclaration(caseInput);
        const requirements = ownData(caseInput, 'requireOnSelectorChange', true);
        const overrides = ownData(caseInput, 'bindings', true);
        cases.push({values: declarationJson(ownData(caseInput, 'values')) as unknown as readonly string[],
          activeDependents: declarationJson(ownData(caseInput, 'activeDependents')) as unknown as readonly string[],
          ...(requirements === undefined ? {} : {requireOnSelectorChange: declarationJson(requirements) as unknown as NonNullable<FixedInputBranchRule['cases'][number]['requireOnSelectorChange']>})});
        variants.push(overrides === undefined ? [] : declarationArray(overrides).map(compileBinding));
      }
      policyRules.push({selector, cases, ...(normalization === undefined ? {} : {normalize: declarationJson(normalization) as unknown as NonNullable<FixedInputBranchRule['normalize']>})});
      policyBindings.push(variants);
    }
  }
  const declaration = fixedDeclaration({contractId, contractRevision,
    editableArguments: bindings.map(binding => binding.argument), readOnlyArguments: (readOnlyArguments ?? []) as readonly string[],
    dependencies: (dependencies ?? []) as FixedInputDeclaration['dependencies'],
    ...(branchPolicies === undefined ? {} : {branchRules: policyRules})});
  for (const [index, rule] of (declaration.branchRules ?? []).entries()) {
    const group = declaration.dependencies.find(item => item.selector === rule.selector)!;
    for (const variants of policyBindings[index]!) {
      if (new Set(variants.map(binding => binding.argument)).size !== variants.length ||
          variants.some(binding => !group.dependents.includes(binding.argument))) return fixedDeclarationError();
    }
  }
  const diagnostic = (code: string, argument?: string): ValidationIssue => Object.freeze({
    message: `Fixed input validation failed: ${code}; contract=${JSON.stringify(contractId)}${argument === undefined ? '' : `; argument=${JSON.stringify(argument)}`}.`,
    ...(argument === undefined ? {} : {path: pointer(argument)})
  });
  const literal = (snapshot: FixedBlockSnapshot, argument: string): boolean => {
    const metadata = snapshot.fixedContext.inputs[argument];
    return snapshot.arguments[argument]?.kind === 'literal' && metadata?.role === 'editable' &&
      (metadata.source === 'field' || metadata.source === 'shadow');
  };
  const project = (binding: Binding, snapshot: FixedBlockSnapshot): JsonObject => {
    const slot = snapshot.arguments[binding.argument];
    if (slot?.kind !== 'literal' || !literal(snapshot, binding.argument)) return {readOnly: true};
    try {return {value: copySync(binding.read(slot.value)) as JsonValue, changed: false};}
    catch {return {readOnly: true};}
  };
  const entryFor = (draft: JsonObject, argument: string): JsonObject | undefined => {
    const entry = isJsonRecord(draft.inputs) && Object.hasOwn(draft.inputs, argument) ? draft.inputs[argument] : undefined;
    return isJsonRecord(entry) ? entry as JsonObject : undefined;
  };
  const selection = (snapshot: FixedBlockSnapshot, draft?: JsonObject) => {
    const arguments_ = {...snapshot.arguments};
    if (draft) for (const rule of declaration.branchRules ?? []) {
      const entry = entryFor(draft, rule.selector);
      if (entry?.changed === true && Object.hasOwn(entry, 'value') && isLiteral(entry.value)) {
        Object.defineProperty(arguments_, rule.selector, {value: {kind: 'literal', value: entry.value}, enumerable: true});
      }
    }
    const branches = resolveFixedBranches(declaration, snapshot, arguments_);
    const selected = new Map(bindings.map(binding => [binding.argument, binding]));
    const states = new Map<string, 'readonly' | 'hidden'>();
    const unruled = new Set<string>();
    for (const group of declaration.dependencies) {
      if (branches.some(branch => branch.selector === group.selector)) continue;
      for (const argument of [group.selector, ...group.dependents]) {
        states.set(argument, 'readonly');unruled.add(argument);
      }
    }
    for (const [policyIndex, branch] of branches.entries()) {
      const group = declaration.dependencies.find(item => item.selector === branch.selector)!;
      if (!branch.selected) {for (const argument of group.dependents) states.set(argument, 'readonly');continue;}
      for (const argument of group.dependents) if (!branch.selected.activeDependents.includes(argument)) states.set(argument, 'hidden');
      const caseIndex = branch.rule.cases.indexOf(branch.selected);
      for (const binding of policyBindings[policyIndex]![caseIndex]!) selected.set(binding.argument, binding);
    }
    return {branches, bindings: [...selected.values()], states, unruled};
  };
  const initialProjection = (argument: string, snapshot: FixedBlockSnapshot): JsonObject => {
    const binding = selection(snapshot).bindings.find(item => item.argument === argument)!;
    return project(binding, snapshot);
  };
  const parseEntry = (_binding: Binding, entry: JsonObject, original: JsonObject): {changed: boolean; value: JsonValue; token?: string} => {
    if (original.readOnly === true) {
      if (sameProjection(original, entry)) return {changed: false, value: null};
      if (entry.repair !== true) throw new TypeError();
    }
    if (!Object.hasOwn(entry, 'value') || typeof entry.changed !== 'boolean' || entry.readOnly === true) throw new TypeError();
    let value = copySync(entry.value) as JsonValue;
    let token: string | undefined;
    if (Object.hasOwn(entry, 'buffer') && _binding.control?.kind === 'json') {
      // The expert text must parse to exactly the value it claims; unparsable text is not saved.
      if (!entry.changed || typeof entry.buffer !== 'string') throw new TypeError();
      let parsed: JsonValue;
      try {parsed = copySync(JSON.parse(entry.buffer)) as JsonValue;} catch {throw new TypeError();}
      if (!sameProjection(parsed, value)) throw new TypeError();
    } else if (Object.hasOwn(entry, 'buffer')) {
      if (!entry.changed || typeof entry.buffer !== 'string') throw new TypeError();
      const parsed = parseFixedNumberInput(entry.buffer);
      if (parsed.kind !== 'valid' || typeof value !== 'number' || !Object.is(parsed.value, value)) throw new TypeError();
      token = parsed.token;value = token;
    }
    if (token === undefined && original.readOnly !== true && sameProjection(original.value!, value)) return {changed: false, value};
    if (!entry.changed) throw new TypeError();
    return {changed: true, value, ...(token === undefined ? {} : {token})};
  };
  const validateExact = (binding: Binding, candidate: LiteralValue, context: SchemaValidationContext<C>, snapshot: FixedBlockSnapshot): ValidationIssue | undefined => {
    const projectedCandidate = copySync(binding.read(candidate));
    if (binding.validator.validate(projectedCandidate, {consumerId: context.consumerId}).kind !== 'valid') return diagnostic('schema-data-invalid', binding.argument);
    const owner = copySync(binding.validateCandidate(candidate, context, snapshot));
    if (!Array.isArray(owner)) throw new TypeError();
    for (const issue of owner) {
      if (!isJsonRecord(issue) || typeof issue.message !== 'string' || (issue.path !== undefined && typeof issue.path !== 'string')) throw new TypeError();
    }
    return owner.length ? diagnostic('owner-input-invalid', binding.argument) : undefined;
  };
  const jsonPresentation = (binding: Binding, snapshot: FixedBlockSnapshot, value: JsonValue | undefined) => {
    const names = namesFor(binding, snapshot);
    const basic = binding.control?.basic;
    return {...(names === undefined ? {} : {names}),
      ...(basic === undefined ? {} : {basic, basicFits: value !== undefined && fitsBasicJsonSchema(value)})};
  };
  const description = (draft: JsonObject, snapshot: FixedBlockSnapshot): FixedInputViewDescription => {
    const current = selection(snapshot, draft);
    const inputs: Record<string, FixedInputViewInput> = Object.create(null) as Record<string, FixedInputViewInput>;
    const issues: ValidationIssue[] = [];
    const changes: LiteralArgumentChange[] = [];
    const describe = (argument: string, binding?: Binding): void => {
      const metadata = snapshot.fixedContext.inputs[argument];
      const slot = snapshot.arguments[argument];
      const entry = entryFor(draft, argument);
      const projected = binding ? project(binding, snapshot) : undefined;
      const schema = binding?.schemaBundle.root.document;
      const schemaType = schema && typeof schema === 'object' && !Array.isArray(schema) ? (schema as {type?: unknown}).type : undefined;
      const value = entry?.value ?? projected?.value;
      const valueType = schemaType === 'number' || schemaType === 'integer' ? 'number' :
        schemaType === 'string' ? 'string' : typeof value === 'number' ? 'number' : 'string';
      const explicit = binding?.control;
      const state = current.states.get(argument) ?? (binding && literal(snapshot, argument) ? 'editable' : 'readonly');
      const schemaEnum = schema && typeof schema === 'object' && !Array.isArray(schema) ? (schema as {enum?: unknown}).enum : undefined;
      const choices = explicit?.choices ?? (Array.isArray(schemaEnum) ? schemaEnum.map(value => ({value: value as JsonValue})) : undefined);
      const control = explicit?.kind ?? (choices ? 'enum' : valueType === 'number' ? 'number' : 'text');
      const rawDisplay = slot?.kind === 'literal' ? String(slot.value) : undefined;
      const reason = state === 'hidden' ? 'Inactive branch; its draft is retained and is not saved.' :
        current.states.get(argument) === 'readonly' ? 'The selector is unavailable; the dependent input is read-only.' :
        state === 'readonly' ? 'This input is read-only; connected expressions are not evaluated.' : undefined;
      inputs[argument] = Object.freeze({state, control, valueType,
        ...(rawDisplay === undefined ? {} : {rawDisplay}),
        ...(explicit?.label === undefined ? {} : {label: explicit.label}), ...(choices === undefined ? {} : {choices}),
        ...(explicit && Object.hasOwn(explicit, 'reset') ? {reset: explicit.reset!} : {}),
        ...(reason === undefined ? {} : {reason}), ...(metadata?.source === 'reporter' ? {unverified: true as const} : {}),
        ...(control === 'json' && binding ? jsonPresentation(binding, snapshot, value) : {})});
      if (!binding || state !== 'editable' || !entry) return;
      try {
        const parsed = parseEntry(binding, entry, initialProjection(argument, snapshot));
        if (!parsed.changed) return;
        const projection = parsed.token === undefined ? parsed.value : parseFixedNumberInput(parsed.token);
        const data = typeof projection === 'object' && projection !== null && 'kind' in projection && projection.kind === 'valid' ? projection.value : projection;
        if (binding.validator.validate(data, {consumerId: contractId}).kind !== 'valid') issues.push(diagnostic('schema-data-invalid', argument));
        if (isLiteral(parsed.value)) changes.push({argument, value: parsed.value});
      } catch {issues.push(diagnostic('fixed-input-invalid', argument));}
    };
    for (const binding of current.bindings) describe(binding.argument, binding);
    for (const argument of declaration.readOnlyArguments) describe(argument);
    issues.push(...validateFixedBranchChanges(declaration, snapshot, changes));
    for (const branch of current.branches) {
      if (!branch.selected || !changes.some(change => change.argument === branch.selector)) continue;
      for (const argument of branch.selected.activeDependents) {
        if (changes.some(change => change.argument === argument)) continue;
        const binding = current.bindings.find(binding => binding.argument === argument)!;
        const slot = snapshot.arguments[argument];
        if (slot?.kind !== 'literal') continue;
        try {
          const projected = copySync(binding.read(slot.value));
          if (binding.validator.validate(projected, {consumerId: contractId}).kind !== 'valid') issues.push(diagnostic('schema-data-invalid', argument));
        } catch {issues.push(diagnostic('fixed-input-invalid', argument));}
      }
    }
    return Object.freeze({inputs: Object.freeze(inputs), issues: Object.freeze(issues), branches: Object.freeze(current.branches.map(({selector, status, value}) =>
      Object.freeze({selector, status, ...(value === undefined ? {} : {value})})))});
  };
  return Object.freeze({
    apiVersion, extensionId, editorId, opcodes, ...declaration,
    saveContract: 'prepared-fixed-v1' as const,
    read: () => {throw new TypeError('Fixed editors require a compatible host.');},
    validate: () => [diagnostic('fixed-host-required')],
    createPatch: () => {throw new TypeError('Fixed editors require a compatible host.');},
    readFixed: (snapshot: FixedBlockSnapshot) => {
      const inputs: JsonObject = {};
      for (const binding of selection(snapshot).bindings) Object.defineProperty(inputs, binding.argument, {value: project(binding, snapshot), enumerable: true});
      return {inputs};
    },
    describeFixed: description,
    prepareFixedSave: (draft: JsonObject, snapshot: FixedBlockSnapshot): FixedPreparedSave<C> => {
      const issues: ValidationIssue[] = [];
      const changes: LiteralArgumentChange[] = [];
      let context: SchemaValidationContext<C>;
      try {
        const value = copySync(provider());
        if (!isJsonRecord(value) || typeof value.consumerId !== 'string' || !value.consumerId || typeof value.nowMs !== 'number' || !Number.isFinite(value.nowMs) || !Object.hasOwn(value, 'settings')) throw new TypeError();
        freeze(value);context = value as unknown as SchemaValidationContext<C>;
      } catch {return {kind: 'invalid', issues: [diagnostic('owner-context-invalid')]};}
      const current = selection(snapshot, draft);
      const candidates = new Map<string, LiteralValue>();
      const finalArguments = {...snapshot.arguments};
      for (const binding of current.bindings) {
        const {argument} = binding;
        try {
          const entry = entryFor(draft, argument);
          if (!entry) throw new TypeError();
          if (current.states.get(argument) === 'hidden') continue;
          if (current.states.get(argument) === 'readonly') {
            if (sameProjection(project(binding, snapshot), entry)) continue;
            if (current.unruled.has(argument)) {
              issues.push(diagnostic('fixed-dependency-validation-unavailable', argument));continue;
            }
            throw new TypeError();
          }
          const original = initialProjection(argument, snapshot);
          if (!literal(snapshot, argument)) {
            if (sameProjection(original, entry)) continue;
            throw new TypeError();
          }
          const parsed = parseEntry(binding, entry, original);
          if (!parsed.changed) continue;
          const raw: unknown = binding.encode(parsed.value, context);
          if (!isLiteral(raw)) {drain(raw);throw new TypeError();}
          if (parsed.token !== undefined && raw !== parsed.token) throw new TypeError();
          candidates.set(argument, raw);
          Object.defineProperty(finalArguments, argument, {value: {kind: 'literal', value: raw}, enumerable: true, configurable: true});
          const slot = snapshot.arguments[argument];
          if (slot?.kind === 'literal' && !Object.is(raw, slot.value)) changes.push(Object.freeze({argument, value: raw}));
        } catch {issues.push(diagnostic('fixed-input-invalid', argument));}
      }
      issues.push(...validateFixedBranchChanges(declaration, snapshot, changes));
      const finalBranches = resolveFixedBranches(declaration, snapshot, finalArguments);
      // Encoding a selector must not silently choose a different codec from the displayed finite branch.
      for (let index = 0; index < current.branches.length; index++) {
        if (current.branches[index]!.selected !== finalBranches[index]!.selected) issues.push(diagnostic('selector-codec-mismatch', current.branches[index]!.selector));
      }
      const validateNames = new Set(candidates.keys());
      for (const branch of finalBranches) if (branch.selected && changes.some(change => change.argument === branch.selector)) {
        for (const argument of branch.selected.activeDependents) validateNames.add(argument);
      }
      const finalSnapshot = captureFixedSnapshot({...snapshot, arguments: finalArguments}, snapshot, declaration);
      for (const argument of validateNames) {
        const binding = current.bindings.find(binding => binding.argument === argument)!;
        const slot = finalArguments[argument];
        if (slot?.kind !== 'literal') continue;
        try {
          const issue = validateExact(binding, slot.value, context, finalSnapshot);
          if (issue) issues.push(issue);
        } catch {issues.push(diagnostic('fixed-input-invalid', argument));}
      }
      return issues.length ? {kind: 'invalid', issues} : {kind: 'ready', changes, context};
    }
  });
}
