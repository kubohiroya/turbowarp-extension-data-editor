import type {SchemaBundle, SchemaJsonObject} from './schema-types.js';

/**
 * A schema for writing a JSON Schema in a form: the "basic" mode of a JSON Schema input.
 *
 * The JSON Schema meta-schema itself cannot drive a form (recursion, `$dynamicRef`, boolean schemas,
 * `type` arrays). This covers what a simple object schema needs, the same range as the
 * `define schema` blocks of turbowarp-named-functions: an object whose properties have a scalar,
 * object, or array type, with `required`, `enum`, numeric and length limits, and a description.
 * `fitsBasicJsonSchema` tells whether a value can be shown in this form without losing anything.
 */

const SCALAR_TYPES = ['string', 'number', 'integer', 'boolean', 'null'] as const;
const ITEM_TYPES = [...SCALAR_TYPES, 'object'] as const;
const PROPERTY_TYPES = [...ITEM_TYPES, 'array'] as const;
const VALUE_LIMITS = ['minimum', 'maximum'] as const;
const LENGTH_LIMITS = ['minLength', 'maxLength'] as const;
const ARRAY_LIMITS = ['minItems', 'maxItems'] as const;

const enumSchema: SchemaJsonObject = {
  type: 'array', title: 'Allowed values', minItems: 1, uniqueItems: true,
  items: {type: 'string'}
};
const limitSchemas = (names: readonly string[], type: 'number' | 'integer'): SchemaJsonObject =>
  Object.fromEntries(names.map(name => [name, type === 'integer' ? {type, minimum: 0} : {type}]));

const itemSchema: SchemaJsonObject = {
  type: 'object', title: 'Each item',
  properties: {
    type: {type: 'string', title: 'Type', enum: [...ITEM_TYPES]},
    enum: enumSchema,
    ...limitSchemas(VALUE_LIMITS, 'number'),
    ...limitSchemas(LENGTH_LIMITS, 'integer')
  },
  required: ['type'],
  additionalProperties: false
};

const propertySchema: SchemaJsonObject = {
  type: 'object',
  properties: {
    type: {type: 'string', title: 'Type', enum: [...PROPERTY_TYPES]},
    description: {type: 'string', title: 'Description'},
    enum: enumSchema,
    ...limitSchemas(VALUE_LIMITS, 'number'),
    ...limitSchemas(LENGTH_LIMITS, 'integer'),
    ...limitSchemas(ARRAY_LIMITS, 'integer'),
    items: {$ref: '#/$defs/item'}
  },
  required: ['type'],
  additionalProperties: false
};

export const basicJsonSchemaAuthoringSchema: SchemaJsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  title: 'Object schema',
  properties: {
    $schema: {const: 'https://json-schema.org/draft/2020-12/schema'},
    type: {const: 'object', default: 'object'},
    description: {type: 'string', title: 'Description'},
    properties: {type: 'object', title: 'Properties', additionalProperties: {$ref: '#/$defs/property'}},
    required: {type: 'array', title: 'Required properties', uniqueItems: true, items: {type: 'string'}},
    additionalProperties: {type: 'boolean', title: 'Allow other properties'}
  },
  required: ['type'],
  additionalProperties: false,
  $defs: {property: propertySchema, item: itemSchema}
};

const source = {repository: 'https://github.com/kubohiroya/turbowarp-extension-data-editor',
  path: 'src/json-schema-authoring.ts', symbol: 'basicJsonSchemaAuthoringSchema'} as const;
export const basicJsonSchemaAuthoringBundle: SchemaBundle = Object.freeze<SchemaBundle>({
  identity: {ownerId: '@kubohiroya/turbowarp-extension-data-editor', contractId: 'json-schema-authoring-basic',
    revision: '1', variantId: 'basic'},
  dialect: '2020-12',
  root: {retrievalUri: 'https://kubohiroya.github.io/turbowarp-extension-data-editor/schemas/json-schema-authoring-basic',
    document: basicJsonSchemaAuthoringSchema, artifact: {role: 'canonical-schema', source}},
  resources: [],
  provenance: {canonicalSources: [source], generatedFiles: [], referenceSchemas: [], generationSources: []}
});

type Json = null | boolean | number | string | readonly Json[] | {readonly [key: string]: Json};
const isObject = (value: unknown): value is Record<string, Json> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const only = (value: Record<string, Json>, keys: readonly string[]): boolean =>
  Object.keys(value).every(key => keys.includes(key));
const isLimit = (value: Json | undefined, integer: boolean): boolean =>
  value === undefined || (typeof value === 'number' && Number.isFinite(value) &&
    (!integer || (Number.isInteger(value) && value >= 0)));
const isStringList = (value: Json | undefined, nonEmpty: boolean): boolean =>
  value === undefined || (Array.isArray(value) && (!nonEmpty || value.length > 0) &&
    value.every(entry => typeof entry === 'string') && new Set(value).size === value.length);
const limitsFit = (value: Record<string, Json>, names: readonly string[], integer: boolean): boolean =>
  names.every(name => isLimit(value[name], integer));

function itemFits(value: Json | undefined): boolean {
  if (!isObject(value) || !only(value, ['type', 'enum', ...VALUE_LIMITS, ...LENGTH_LIMITS])) return false;
  return (ITEM_TYPES as readonly Json[]).includes(value.type ?? null) && isStringList(value.enum, true) &&
    limitsFit(value, VALUE_LIMITS, false) && limitsFit(value, LENGTH_LIMITS, true);
}

function propertyFits(value: Json): boolean {
  if (!isObject(value) || !only(value, ['type', 'description', 'enum', 'items',
    ...VALUE_LIMITS, ...LENGTH_LIMITS, ...ARRAY_LIMITS])) return false;
  if (!(PROPERTY_TYPES as readonly Json[]).includes(value.type ?? null)) return false;
  if (value.description !== undefined && typeof value.description !== 'string') return false;
  if (value.items !== undefined && (value.type !== 'array' || !itemFits(value.items))) return false;
  return isStringList(value.enum, true) && limitsFit(value, VALUE_LIMITS, false) &&
    limitsFit(value, LENGTH_LIMITS, true) && limitsFit(value, ARRAY_LIMITS, true);
}

/** True when the value can be edited in the basic form without dropping any keyword. */
export function fitsBasicJsonSchema(value: unknown): boolean {
  if (!isObject(value) || !only(value, ['$schema', 'type', 'description', 'properties', 'required', 'additionalProperties'])) {
    return false;
  }
  if (value.$schema !== undefined && value.$schema !== basicJsonSchemaAuthoringSchema.$schema) return false;
  if (value.type !== 'object') return false;
  if (value.description !== undefined && typeof value.description !== 'string') return false;
  if (value.additionalProperties !== undefined && typeof value.additionalProperties !== 'boolean') return false;
  if (value.properties !== undefined && (!isObject(value.properties) || !Object.values(value.properties).every(propertyFits))) {
    return false;
  }
  return isStringList(value.required, false);
}
