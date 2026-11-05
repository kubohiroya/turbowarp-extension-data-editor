// Both standard RJSF and SourceVariant.uiSchema accept this JSON-only declaration.
export const layoutSchema = {type: 'object', title: 'カメラ設定', properties: {
  name: {type: 'string', title: '名前', minLength: 1},
  width: {type: 'number', title: '幅', minimum: 1},
  height: {type: 'number', title: '高さ', minimum: 1}
}, required: ['name', 'width', 'height'], additionalProperties: {type: 'string'}};

export const layoutUiSchema = {'ui:options': {extensionDataLayout: {version: 1, items: [{tabs: [
  {label: '基本', items: [{group: '識別', items: [{field: 'name'}]}]},
  {label: '画像', items: [{group: '解像度', items: [{grid: 2, items: [{field: 'width'}, {field: 'height'}]}]}]}
]}]}}};

const source = {repository: 'fixture', path: 'examples/common-layout.ts'};
export const layoutSchemaBundle = {identity: {ownerId: 'fixture', contractId: 'layout', revision: '1', variantId: 'default'}, dialect: 'draft-07',
  root: {retrievalUri: 'https://fixture.invalid/layout', document: layoutSchema, artifact: {role: 'canonical-schema', source}},
  resources: [], provenance: {canonicalSources: [source], generatedFiles: [], referenceSchemas: [], generationSources: []}};
