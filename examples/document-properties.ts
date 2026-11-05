// Optional teaching code; extensions own their actual blocks and data contracts.
const source = {repository: 'turbowarp-extension-data-editor', path: 'examples/document-properties.ts'};

export const documentSchemaBundle = {
  identity: {ownerId: 'editor-example', contractId: 'document-example', revision: '1', variantId: 'document'},
  dialect: 'draft-07',
  root: {
    retrievalUri: 'https://example.invalid/editor/document.schema.json',
    document: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {text: {type: 'string'}, enabled: {type: 'boolean'}}, additionalProperties: true
    },
    artifact: {role: 'canonical-schema', source}
  },
  resources: [],
  provenance: {canonicalSources: [source], generatedFiles: [], referenceSchemas: [], generationSources: []}
};

export const documentEditorDefinitions = ['json', 'yaml'].map(format => ({
  apiVersion: 1, extensionId: 'example', editorId: `document-${format}`,
  opcodes: [`example_document${format === 'json' ? 'Json' : 'Yaml'}`],
  argument: 'SOURCE', format, schemaBundle: documentSchemaBundle,
  validationContext: () => ({consumerId: 'document-example', nowMs: 0, settings: null})
}));

/** Importing this example never registers or executes blocks. */
export function registerDocumentEditors(api) {
  if (!api || api.apiVersion !== 1 || typeof api.registerSchemaBundle !== 'function') return () => {};
  const removers = [];
  const dispose = () => {
    const failures = [];
    for (const remove of removers.splice(0).reverse()) {
      try { remove(); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, 'Example editor cleanup failed.');
  };
  try {
    for (const definition of documentEditorDefinitions) removers.push(api.registerSchemaBundle(definition));
  } catch (registrationError) {
    try { dispose(); } catch (cleanupError) {
      throw new AggregateError([registrationError, cleanupError], 'Example registration rollback failed.');
    }
    throw registrationError;
  }
  return dispose;
}
