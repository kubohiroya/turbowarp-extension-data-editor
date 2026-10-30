import * as React from 'react';
import {captureFeatureFlags} from './config/feature-flags.js';
import type {EditorFeatureFlags} from './config/feature-flags.js';
export type {EditorFeatureFlags} from './config/feature-flags.js';
export type {EditorLayout, EditorLayoutItem} from './layout.js';
import {LayoutHost} from './layout-view.js';
import {createSourceEditor} from './source-editor.js';
import {createFixedInputEditor} from './fixed-input-editor.js';
import {captureFixedInputMessages, resolveFixedInputMessages, mountFixedInputView} from './fixed-input-view.js';
import type {FixedInputMessageSource} from './fixed-input-view.js';
export type {FixedInputViewMessages, FixedInputMessageSource} from './fixed-input-view.js';
import type {FixedInputEditorOptions} from './fixed-input-editor.js';
export {createFixedInputEditor} from './fixed-input-editor.js';
export type {FixedInputEditorOptions, FixedInputBinding, FixedInputBranchPolicy} from './fixed-input-editor.js';
export type * from './fixed-input-types.js';
import type {SourceEditorOptions} from './source-types.js';
export {createSourceEditor} from './source-editor.js';
export type * from './source-types.js';
export type * from './prepared-types.js';
import * as ReactDOM from 'react-dom';
import * as RjsfCore from '@rjsf/core';
import * as RjsfUtils from '@rjsf/utils';
import * as RjsfAjv from '@rjsf/validator-ajv8';
import type {FormProps, IChangeEvent} from '@rjsf/core';
import type {RJSFSchema, UiSchema} from '@rjsf/utils';
import {Ajv2020} from 'ajv/dist/2020.js';
import {compileSchemaBundle, validateSchemaInput, toValidationIssues} from './schema.js';
import type {SchemaBundle, SchemaJsonObject, SchemaValidationContext, SyncOwnerValidator} from './schema-types.js';
import {schemaView, fieldErrors} from './schema-view.js';
import {snapshotJson} from './schema-json.js';
import {cloneJson} from './data.js';
import {decodeSource, encodeSource, sameData} from './codec.js';
import type {SourceFormat} from './codec.js';
import {EditorRegistry} from './registry.js';
import {EDITOR_API_VERSION} from './types.js';
import {AddItemButton, ArrayItem, ItemMenu, additionalItemTemplate, numberedObjectTemplate,
  valueFieldTemplate, layoutObjectTemplate, compactDescriptionTemplate, compactArrayTitleTemplate, compactArrayTemplate,
  compactCheckboxWidget} from './rjsf-templates.js';
import type {
  BlockPreviewDefinition, BlockSnapshot, EditorDefinition, JsonObject, JsonValue, ValidationIssue
} from './types.js';

// RJSF v5 exposes CommonJS to Node and ESM to browser bundlers.
function moduleExports<T>(namespace: T): T {
  const fallback = (namespace as {default?: unknown}).default;
  return fallback && typeof fallback === 'object' && '__esModule' in fallback
    ? fallback as T : namespace;
}
const Form = moduleExports(RjsfCore).default as unknown as React.ComponentType<FormProps<unknown>>;
const {getDefaultFormState, ADDITIONAL_PROPERTY_FLAG} = moduleExports(RjsfUtils);
const {customizeValidator} = moduleExports(RjsfAjv);
const defaultTemplates = moduleExports(RjsfCore).getDefaultRegistry().templates;
const ObjectItems = numberedObjectTemplate(layoutObjectTemplate(defaultTemplates.ObjectFieldTemplate), ADDITIONAL_PROPERTY_FLAG);
const AdditionalItem = additionalItemTemplate(ADDITIONAL_PROPERTY_FLAG);
const ValueField = valueFieldTemplate(defaultTemplates.FieldTemplate, ADDITIONAL_PROPERTY_FLAG);
const Description = compactDescriptionTemplate(defaultTemplates.DescriptionFieldTemplate);
const ArrayTitle = compactArrayTitleTemplate(defaultTemplates.ArrayFieldTitleTemplate);
const ArrayBody = compactArrayTemplate(defaultTemplates.ArrayFieldTemplate);
const Checkbox = compactCheckboxWidget(moduleExports(RjsfCore).getDefaultRegistry().widgets.CheckboxWidget!);
let nextViewId = 0;

export interface SchemaEditorOptions {
  readonly apiVersion: typeof EDITOR_API_VERSION;
  readonly extensionId: string;
  readonly editorId: string;
  readonly opcodes: readonly string[];
  /** The string argument that persists the JSON-compatible value. */
  readonly argument: string;
  /** Defaults to JSON for compatibility with existing registrations. */
  readonly format?: SourceFormat;
  readonly schema: RJSFSchema;
  readonly uiSchema?: SchemaJsonObject;
  /** Optional business validation, always run after schema validation when saving. */
  validateData?(
    data: JsonValue, snapshot: BlockSnapshot
  ): readonly ValidationIssue[] | Promise<readonly ValidationIssue[]>;
}

/** Explicit bundle opt-in; the provider supplies fresh immutable validation inputs per call. */
export interface SchemaBundleEditorOptions<C = null> extends Omit<SchemaEditorOptions, 'schema'> {
  readonly schemaBundle: SchemaBundle;
  readonly validationContext: () => SchemaValidationContext<C>;
  readonly ownerValidate?: SyncOwnerValidator<C>;
}

export function createSchemaBundleEditor<C>(options: SchemaBundleEditorOptions<C>, features: EditorFeatureFlags = {}): EditorDefinition {
  const {schemaBundle, validationContext: provider, ownerValidate, apiVersion, extensionId, editorId,
    opcodes, argument, format, uiSchema, validateData} = options;
  let bundle: SchemaBundle;
  try {bundle = snapshotJson(schemaBundle) as unknown as SchemaBundle;}
  catch {throw new TypeError('Invalid schema bundle.');}
  const result = compileSchemaBundle(bundle);
  if (result.kind !== 'compiled') throw new TypeError(`Schema bundle compilation failed: ${result.diagnostics[0].code}`);
  const schema = schemaView(bundle);
  const issuesFor = (data: JsonValue): readonly ValidationIssue[] => {
    let context: SchemaValidationContext<C>;
    try {
      context = provider();
      if (context && typeof context === 'object') {
        const prototype = Object.getPrototypeOf(context);
        if (prototype !== Object.prototype && prototype !== null) {
          // Drain rejected native/cross-realm promises from a malformed synchronous provider.
          try {void Promise.prototype.then.call(context as unknown as Promise<unknown>, () => undefined, () => undefined);}
          catch { /* The common context guard rejects other non-JSON instances below. */ }
        }
      }
    } catch {return [{message: 'Validation could not complete: owner-context-invalid.'}];}
    const validation = validateSchemaInput(result.validator, data, {context, ...(ownerValidate !== undefined ? {ownerValidate} : {})});
    if (validation.kind === 'valid') return [];
    if (validation.kind === 'execution-error') return validation.diagnostics.map(d => ({message: `Validation could not complete: ${d.code}.`}));
    return toValidationIssues(validation.diagnostics);
  };
  return createSchemaEditorImpl({apiVersion, extensionId, editorId, opcodes, argument, schema,
    ...(format === undefined ? {} : {format}), ...(uiSchema === undefined ? {} : {uiSchema}),
    ...(validateData === undefined ? {} : {validateData})}, {issuesFor, dialect: result.validator.dialect}, captureFeatureFlags(features));
}

export interface BlockEditorRegistrationAPI {
  readonly apiVersion: typeof EDITOR_API_VERSION;
  register(definition: EditorDefinition | SchemaEditorOptions): () => void;
  registerPreview?(definition: BlockPreviewDefinition): () => void;
  registerSchema(definition: SchemaEditorOptions): () => void;
  registerSchemaBundle?<C>(definition: SchemaBundleEditorOptions<C>): () => void;
  registerSourceEditor?<C = null>(definition: SourceEditorOptions<C>): () => void;
  registerFixedInputEditor?<C = null>(definition: FixedInputEditorOptions<C>): () => void;
}
/** Capability guaranteed by the service factory, optional on a legacy host-supplied API. */
export interface SchemaBundleBlockEditorRegistrationAPI extends BlockEditorRegistrationAPI {
  registerSchemaBundle<C>(definition: SchemaBundleEditorOptions<C>): () => void;
}
/** New prepared-source capability; existing bundle-only host implementations remain compatible. */
export interface SourceBlockEditorRegistrationAPI extends SchemaBundleBlockEditorRegistrationAPI {
  registerSourceEditor<C = null>(definition: SourceEditorOptions<C>): () => void;
}
export interface FixedBlockEditorRegistrationAPI extends SourceBlockEditorRegistrationAPI {
  registerFixedInputEditor<C = null>(definition: FixedInputEditorOptions<C>): () => void;
}
export interface BlockEditorService {
  readonly registry: EditorRegistry;
  readonly api: BlockEditorRegistrationAPI;
  subscribe(listener: () => void): () => void;
}

/** A host owns the service's lifetime; this module never stores VM or workspace instances. */
export function createBlockEditorService(options: EditorFeatureFlags & {readonly fixedInputs: true; readonly fixedInputMessages?: FixedInputMessageSource}): BlockEditorService & {readonly api: FixedBlockEditorRegistrationAPI};
export function createBlockEditorService(options?: EditorFeatureFlags & {readonly fixedInputs?: false; readonly fixedInputMessages?: FixedInputMessageSource}): BlockEditorService & {readonly api: SourceBlockEditorRegistrationAPI};
export function createBlockEditorService(options: EditorFeatureFlags & {readonly fixedInputs?: boolean; readonly fixedInputMessages?: FixedInputMessageSource}): BlockEditorService;
export function createBlockEditorService(options?: EditorFeatureFlags & {readonly fixedInputs?: boolean; readonly fixedInputMessages?: FixedInputMessageSource}): BlockEditorService {
  const features = captureFeatureFlags(options);
  if (options?.fixedInputs !== undefined && typeof options.fixedInputs !== 'boolean') throw new TypeError('Invalid fixed input capability option.');
  const messageSource = options?.fixedInputMessages;
  const fixedMessages = typeof messageSource === 'function' ? messageSource : captureFixedInputMessages(messageSource);
  const registry = new EditorRegistry();
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of [...listeners]) listener(); };
  const fixed = options?.fixedInputs === true ? {
    registerFixedInputEditor: <C,>(definition: FixedInputEditorOptions<C>) => {
      const fixedDefinition = createFixedInputEditor(definition);
      const remove = registry.registerFixed({...fixedDefinition, mount: (container, context) => mountFixedInputView(container, context, resolveFixedInputMessages(fixedMessages))});
      notify();
      let active = true;
      return () => {if (active) {active = false;remove();notify();}};
    }
  } : {};
  const api: SourceBlockEditorRegistrationAPI = Object.freeze({
    ...fixed,
    apiVersion: EDITOR_API_VERSION,
    registerPreview: (definition: BlockPreviewDefinition) => {
      const remove = registry.registerPreview(definition);
      notify();
      let active = true;
      return () => { if (active) { active = false; remove(); notify(); } };
    },
    register: (definition: EditorDefinition | SchemaEditorOptions) => {
      const custom = definition as EditorDefinition;
      const editor = !custom.mount && Object.hasOwn(definition, 'schema')
        ? createSchemaEditor(definition as SchemaEditorOptions, features) : custom;
      if (typeof editor.mount !== 'function') throw new TypeError('A block editor must provide mount().');
      const remove = registry.register(editor);
      notify();
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        remove();
        notify();
      };
    },
    registerSchema: (definition: SchemaEditorOptions) => api.register(createSchemaEditor(definition, features)),
    registerSchemaBundle: <C,>(definition: SchemaBundleEditorOptions<C>) => api.register(createSchemaBundleEditor(definition, features)),
    registerSourceEditor: <C,>(definition: SourceEditorOptions<C>) => {
      const remove = registry.registerPrepared(createSourceEditor(definition, features));
      notify();
      let active = true;
      return () => {if (active) {active = false;remove();notify();}};
    }
  });
  return {registry, api, subscribe: listener => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }};
}

/** Build an editor with JSON/YAML serialization, schema validation and the standard RJSF body. */
export function createSchemaEditor(options: SchemaEditorOptions, features: EditorFeatureFlags = {}): EditorDefinition {
  return createSchemaEditorImpl(options, undefined, captureFeatureFlags(features));
}
function createSchemaEditorImpl(options: SchemaEditorOptions, bundle?: {
  readonly issuesFor: (data: JsonValue) => readonly ValidationIssue[];
  readonly dialect: SchemaBundle['dialect'];
}, features = captureFeatureFlags()): EditorDefinition {
  if (options.apiVersion !== EDITOR_API_VERSION || typeof options.argument !== 'string' || !options.argument) {
    throw new TypeError('A supported API version and JSON argument name are required.');
  }
  const argument = options.argument;
  const format = options.format ?? 'json';
  if (format !== 'json' && format !== 'yaml') throw new TypeError('Unsupported source format.');
  const schema = cloneJson(options.schema as JsonObject) as RJSFSchema;
  const uiSchema = options.uiSchema ? snapshotJson(options.uiSchema) as UiSchema<unknown> : {};
  const validateData = options.validateData;
  const validator = customizeValidator<unknown>({
    ...(bundle?.dialect === '2020-12' ? {AjvClass: Ajv2020} : {}),
    ajvOptionsOverrides: {allErrors: true, coerceTypes: false, useDefaults: false, removeAdditional: false}
  });
  const compilation = validator.rawValidation(schema);
  if (compilation.validationError) {
    throw new TypeError(`Invalid or unsupported JSON Schema: ${compilation.validationError.message}`);
  }
  const issuesFor = bundle?.issuesFor ?? ((data: JsonValue): readonly ValidationIssue[] => {
    const result = validator.validateFormData(data, schema, undefined, undefined, uiSchema);
    return result.errors.map(error => ({
      message: error.stack || error.message || 'Invalid value.',
      ...(error.property === undefined ? {} : {path: error.property})
    }));
  });
  // RJSF uses undefined for cleared controls; persist these as omitted properties (or null at the root).
  const formValue = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value ?? null)) as JsonValue;
  const dataFor = (draft: JsonObject): JsonValue => {
    if (!Object.hasOwn(draft, 'data') || draft.data === undefined) throw new TypeError('Missing schema editor data.');
    return draft.data;
  };

  return {
    apiVersion: EDITOR_API_VERSION,
    extensionId: options.extensionId, editorId: options.editorId, opcodes: [...options.opcodes],
    editableArguments: [argument],
    read: snapshot => {
      const slot = snapshot.arguments[argument];
      if (!slot || slot.kind !== 'literal' || typeof slot.value !== 'string') {
        throw new TypeError('Schema editors require a literal JSON/YAML string argument.');
      }
      const data = decodeSource(slot.value, format);
      // Initialize the session draft once; remounting must not reset edits or errors.
      return {data: bundle ? data : formValue(getDefaultFormState<unknown>(validator, schema, data, schema))};
    },
    validate: (draft, snapshot) => {
      const data = dataFor(draft);
      const issues = issuesFor(data);
      return issues.length || !validateData ? issues : validateData(cloneJson(data), snapshot);
    },
    createPatch: (draft, snapshot) => {
      const data = dataFor(draft);
      const slot = snapshot.arguments[argument];
      if (!slot || slot.kind !== 'literal' || typeof slot.value !== 'string') {
        throw new TypeError('Missing source string.');
      }
      // A save without data changes preserves the exact source, comments and undo history.
      const value = sameData(data, decodeSource(slot.value, format))
        ? slot.value : encodeSource(data, format);
      return [{argument, value}];
    },
    mount: (container, context) => {
      let active = true;
      let scheduled = false;
      let unsubscribe = () => {};
      const idPrefix = `block-editor-${++nextViewId}`;
      if (context.getState().issues.length === 0) {
        context.setValidationIssues(issuesFor(dataFor(context.getDraft())));
      }
      const render = () => {
        if (!active) return;
        const state = context.getState();
        const props = {
          schema, uiSchema, validator, idPrefix,
          widgets: {CheckboxWidget: Checkbox},
          templates: {
            ArrayFieldItemTemplate: ArrayItem,
            ArrayFieldTitleTemplate: ArrayTitle,
            ArrayFieldTemplate: ArrayBody,
            ObjectFieldTemplate: ObjectItems,
            WrapIfAdditionalTemplate: AdditionalItem,
            FieldTemplate: ValueField,
            DescriptionFieldTemplate: Description,
            ButtonTemplates: {AddButton: AddItemButton, RemoveButton: ItemMenu}
          },
          formData: dataFor(context.getDraft()),
          // Defaults belong to read(), not subsequent renders or remounts.
          experimental_defaultFormStateBehavior: {
            emptyObjectFields: 'skipDefaults' as const,
            arrayMinItems: {populate: 'never' as const},
            constAsDefaults: 'never' as const
          },
          tagName: 'div' as const,
          liveValidate: !bundle,
          ...(bundle ? {noValidate: true, extraErrors: fieldErrors(state.issues)} : {}),
          showErrorList: false as const,
          disabled: state.status !== 'editing',
          onChange: (event: IChangeEvent<unknown>) => {
            if (!active || context.getState().status !== 'editing') return;
            const data = formValue(event.formData);
            context.setDraft({data});
            context.setValidationIssues(issuesFor(data));
          }
        };
        // Suppress RJSF's own submit control; the host's shared footer owns saving.
        ReactDOM.render(React.createElement(LayoutHost, {enabled: features.commonLayout, context, children:
          React.createElement(Form, props, React.createElement('span', {hidden: true}))}), container);
      };
      const schedule = () => {
        if (scheduled || !active) return;
        scheduled = true;
        void Promise.resolve().then(() => {
          scheduled = false;
          if (active) render();
        });
      };
      unsubscribe = context.subscribe(schedule);
      try { render(); } catch (error) {
        active = false;
        unsubscribe();
        ReactDOM.unmountComponentAtNode(container);
        throw error;
      }
      return () => {
        active = false;
        unsubscribe();
        ReactDOM.unmountComponentAtNode(container);
      };
    }
  };
}
