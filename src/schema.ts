import type {InputDiagnostic, ValidationIssue} from './schema-types.js';

export type * from './schema-types.js';
export {compileSchemaBundle} from './schema-engine.js';
export {validateSchemaInput} from './schema-compose.js';

const messages = {
  'input-format-invalid': 'Input format is invalid.',
  'variant-unrecognized': 'Input variant is not recognized.',
  'input-not-json': 'Input must be a JSON-compatible value.',
  'schema-data-invalid': 'Value does not satisfy the schema.',
  'owner-input-invalid': 'Value does not satisfy the owner input rules.'
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPointer(value: unknown): value is string {
  return typeof value === 'string' && (value === '' || value.startsWith('/')) && !/~(?:[^01]|$)/u.test(value);
}

function readValidationIssue(value: unknown): ValidationIssue {
  if (!isRecord(value)) throw new TypeError();
  const scope = value.scope;
  if (!isRecord(scope)) throw new TypeError();
  const identity = scope.identity;
  if (!isRecord(identity)) throw new TypeError();
  if (['ownerId', 'contractId', 'revision', 'variantId'].some(key => typeof identity[key] !== 'string')) {
    throw new TypeError();
  }
  if ('consumerId' in scope && typeof scope.consumerId !== 'string') throw new TypeError();
  if ('resourceUri' in value && typeof value.resourceUri !== 'string') throw new TypeError();
  if ('schemaPath' in value && !isPointer(value.schemaPath)) throw new TypeError();
  // Keep primitives locally so accessors cannot change them between validation and conversion.
  const dataPath = value.dataPath;
  const phase = value.phase;
  const code = value.code;
  if (!isPointer(dataPath)) throw new TypeError();
  switch (phase) {
    case 'decode':
      if (code !== 'input-format-invalid' && code !== 'variant-unrecognized') throw new TypeError();
      break;
    case 'structure':
      if (code !== 'input-not-json' && code !== 'schema-data-invalid') throw new TypeError();
      if ('keyword' in value && typeof value.keyword !== 'string') throw new TypeError();
      break;
    case 'semantic':
      if (code !== 'owner-input-invalid' || typeof value.ruleId !== 'string') throw new TypeError();
      break;
    default:
      throw new TypeError();
  }
  return Object.freeze({message: messages[code], path: dataPath});
}

/** Convert input diagnostics without copying raw data or changing JSON Pointer paths. */
export function toValidationIssues(diagnostics: readonly InputDiagnostic[]): readonly ValidationIssue[] {
  try {
    if (!Array.isArray(diagnostics)) throw new TypeError();
    const length = diagnostics.length;
    if (!Number.isSafeInteger(length) || length < 0) throw new TypeError();
    // Snapshot indexed elements before invoking diagnostic getters. Ignore input iterators.
    const snapshot: unknown[] = [];
    for (let index = 0; index < length; index++) {
      if (!Object.hasOwn(diagnostics, index)) throw new TypeError();
      snapshot.push(diagnostics[index]);
    }
    const issues: ValidationIssue[] = [];
    for (let index = 0; index < length; index++) {
      issues.push(readValidationIssue(snapshot[index]));
    }
    return Object.freeze(issues);
  } catch {
    // Never expose an external value or a getter's exception through this boundary.
    throw new TypeError('Invalid input diagnostic.');
  }
}
export type * from './source-types.js';
export {jsonValueSchema, jsonValueSchemaBundle} from './json-value.js';
export {parseFixedNumberInput} from './fixed-input-schema.js';
export type {FixedNumberInputResult} from './fixed-input-schema.js';
export {basicJsonSchemaAuthoringBundle, basicJsonSchemaAuthoringSchema, fitsBasicJsonSchema} from './json-schema-authoring.js';
