import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {EditorRegistry, EditorSession} from '../dist/webpack4/index.js';
import {createBlockEditorService} from '../dist/webpack4/rjsf.js';
import {compileSchemaBundle, validateSchemaInput} from '../dist/webpack4/schema.js';
const require = createRequire(import.meta.url);
const {withBlockEditorWebpack4} = require('../webpack4.cjs');
const root = fileURLToPath(new URL('../', import.meta.url));

test('webpack 4 entries share registry and session identities across bundled subpaths', () => {
  const service = createBlockEditorService();
  assert.ok(service.registry instanceof EditorRegistry);
  service.api.registerSchema({apiVersion: 1, extensionId: 'story', editorId: 'scene',
    opcodes: ['story_scene'], argument: 'DATA', schema: {type: 'object'}});
  const block = {targetId: 'sprite', blockId: 'scene', opcode: 'story_scene', revision: '1',
    arguments: {DATA: {kind: 'literal', value: '{}'}}};
  const session = service.registry.open(block, {readBlock: () => block, commit: () => {}});
  assert.ok(session instanceof EditorSession);
  session.cancel();
});

test('webpack helper preserves host aliases and loaders without mutating single or multiple configs', () => {
  const config = {resolve: {alias: {'upstream$': '/host/upstream'}, extensions: ['.js']},
    module: {rules: [{test: /\.js$/, loader: 'host-loader'}]}};
  const [first, second] = withBlockEditorWebpack4([config, config], {hostRoot: root});
  assert.notEqual(first, config);
  assert.notEqual(first.resolve, config.resolve);
  assert.deepEqual(config.resolve.alias, {'upstream$': '/host/upstream'});
  assert.equal(first.module, config.module);
  assert.equal(first.resolve.alias['upstream$'], '/host/upstream');
  assert.equal(first.resolve.alias['react$'], require.resolve('react'));
  assert.equal(first.resolve.alias['react-dom$'], require.resolve('react-dom'));
  assert.match(first.resolve.alias['@kubohiroya/turbowarp-extension-data-editor$'], /dist\/webpack4\/index.js$/);
  assert.match(first.resolve.alias['@kubohiroya/turbowarp-extension-data-editor/schema$'], /dist\/webpack4\/schema.js$/);
  assert.deepEqual(first, second);
  assert.deepEqual(withBlockEditorWebpack4(first, {hostRoot: root}), first);
  assert.throws(() => withBlockEditorWebpack4(config, {hostRoot: 'relative'}), /absolute/);
});

test('webpack 4 root graph stays React-free and optional entries externalize only host React', async () => {
  const meta = JSON.parse(await readFile(new URL('../dist/webpack4/metafile.json', import.meta.url)));
  const visit = (output, seen = new Set()) => {
    if (seen.has(output)) return [];
    seen.add(output);
    return meta.outputs[output].imports.flatMap(item => item.external ? [item.path] : visit(item.path, seen));
  };
  assert.deepEqual(visit('dist/webpack4/index.js'), []);
  assert.deepEqual(visit('dist/webpack4/schema.js'), []);
  assert.deepEqual(new Set(visit('dist/webpack4/rjsf.js')), new Set(['react', 'react-dom', 'react/jsx-runtime.js']));
  assert.deepEqual(new Set(visit('dist/webpack4/react.js')), new Set(['react']));
});

test('webpack 4 schema entry validates offline without a React or DOM import', () => {
  const source = {repository: 'fixture', path: 'value.json'};
  const compiled = compileSchemaBundle({identity: {ownerId: 'fixture', contractId: 'value', revision: '1', variantId: 'default'},
    dialect: 'draft-07', root: {retrievalUri: 'urn:fixture:value', document: {type: 'number'}, artifact: {role: 'canonical-schema', source}},
    resources: [], provenance: {canonicalSources: [source], generatedFiles: [], referenceSchemas: [], generationSources: []}});
  assert.equal(compiled.kind, 'compiled');
  assert.equal(validateSchemaInput(compiled.validator, 2, {context: {consumerId: 'webpack4', nowMs: 0, settings: null}}).kind, 'valid');
  assert.equal(validateSchemaInput(compiled.validator, '2', {context: {consumerId: 'webpack4', nowMs: 0, settings: null}}).kind, 'invalid');
});
