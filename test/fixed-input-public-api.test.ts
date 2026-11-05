import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import * as rootAPI from '@kubohiroya/turbowarp-extension-data-editor';
import * as rjsf from '@kubohiroya/turbowarp-extension-data-editor/rjsf';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const packageName = '@kubohiroya/turbowarp-extension-data-editor';
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const fixedOptions = () => ({
  apiVersion: 1, extensionId: 'owner', editorId: 'fixed', opcodes: ['owner_number'],
  contractId: 'owner.numbers', contractRevision: '1', bindings: [{
    argument: 'VALUE', schemaBundle: {
      identity: {ownerId: 'owner', contractId: 'number', revision: '1', variantId: 'default'},
      dialect: 'draft-07', root: {retrievalUri: 'https://example.invalid/number',
        document: {type: 'number'}, artifact: {role: 'canonical-schema', source: {repository: 'owner', path: 'number.json'}}},
      resources: [], provenance: {canonicalSources: [{repository: 'owner', path: 'number.json'}], generatedFiles: [], referenceSchemas: [], generationSources: []}
    }, read: value => Number(value), encode: value => String(value), validateCandidate: () => []
  }], validationContext: () => ({consumerId: 'owner', nowMs: 0, settings: null})
});

test('fixed contracts preserve all eight exports, CSS build and webpack4 adapters', async () => {
  assert.deepEqual(Object.keys(manifest.exports).sort(), ['.', './rjsf', './react', './react/styles.css', './turbowarp', './webpack4', './build-info', './schema'].sort());
  assert.deepEqual(manifest.sideEffects, ['**/*.css']);
  assert.deepEqual(readFileSync(join(root, 'src/react.css')), readFileSync(join(root, 'dist/react.css')));
  for (const entry of ['', '/rjsf', '/react', '/turbowarp', '/schema']) assert.ok(await import(packageName + entry));
  const webpack = require(packageName + '/webpack4');
  assert.equal(typeof webpack.withBlockEditorWebpack4, 'function');
  const configured = webpack.withBlockEditorWebpack4({resolve: {alias: {existing: '/existing'}}}, {hostRoot: root});
  for (const entry of ['', '/rjsf', '/react', '/turbowarp', '/schema']) {
    assert.ok(existsSync(configured.resolve.alias[`${packageName}${entry}$`]));
  }
  assert.equal(configured.resolve.alias.existing, '/existing');
  assert.equal(configured.resolve.alias[`${packageName}/react/styles.css$`], join(root, 'dist/react.css'));
  assert.equal(rootAPI.EDITOR_API_VERSION, 1);
});

test('the default service remains source-only and explicit fixed registration requires a compatible host', () => {
  const old = rjsf.createBlockEditorService();
  assert.equal(Object.hasOwn(old.api, 'registerFixedInputEditor'), false);
  assert.equal(typeof old.api.registerSourceEditor, 'function');
  assert.equal(Object.hasOwn(rjsf.createBlockEditorService({fixedInputs: false}).api, 'registerFixedInputEditor'), false);
  const optedIn = rjsf.createBlockEditorService({fixedInputs: true});
  assert.equal(typeof optedIn.api.registerFixedInputEditor, 'function');
  const remove = optedIn.api.registerFixedInputEditor(fixedOptions());
  let commits = 0;
  const oldHost = {readBlock: () => ({targetId: 'sprite', blockId: 'block', opcode: 'owner_number', revision: '1',
    arguments: {VALUE: {kind: 'literal', value: '001'}}}), commit: () => {commits++;}};
  assert.equal(optedIn.registry.open({targetId: 'sprite', blockId: 'block'}, oldHost), undefined);
  assert.equal(commits, 0);
  remove(); remove();
  assert.equal(optedIn.registry.resolve('owner_number'), undefined);
});

test('new fixed public types compile with strict checking and skipLibCheck false', () => {
  const tsc = join(dirname(require.resolve('typescript/package.json')), 'bin/tsc');
  const result = spawnSync(process.execPath, [tsc, '--noEmit', '-p', 'test/types/tsconfig.fixed-pure.json'], {cwd: root, encoding: 'utf8'});
  assert.equal(result.status, 0, result.stdout + result.stderr || result.error?.message);
});

// Optional external type supply uses a real declaration file; this is never a stub or a skipLibCheck override.
// A GUI workspace can supply its existing @types/json-schema without installing or changing dependencies.
test('fixed registration types compile against actual vendor declarations with skipLibCheck false', t => {
  let jsonSchema;
  try {jsonSchema = require.resolve('@types/json-schema/index.d.ts');} catch {}
  if (!jsonSchema) jsonSchema = process.env.BLOCK_EDITOR_JSON_SCHEMA_TYPES;
  if (!jsonSchema) {t.skip('Actual @types/json-schema is absent; use BLOCK_EDITOR_JSON_SCHEMA_TYPES for the separate vendor check.'); return;}
  assert.ok(existsSync(jsonSchema));
  const directory = mkdtempSync(join(tmpdir(), 'block-editor-fixed-types-'));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  const config = {extends: join(root, 'test/types/tsconfig.fixed-api.json'), compilerOptions: {
    paths: {'json-schema': [jsonSchema]}, typeRoots: [join(root, 'node_modules/@types')]
  }};
  const path = join(directory, 'tsconfig.json');
  writeFileSync(path, JSON.stringify(config));
  const tsc = join(dirname(require.resolve('typescript/package.json')), 'bin/tsc');
  const result = spawnSync(process.execPath, [tsc, '--noEmit', '-p', path], {cwd: root, encoding: 'utf8'});
  assert.equal(result.status, 0, result.stdout + result.stderr || result.error?.message);
});

test('the GUI preserves service capabilities without adding fixed registration to the default service', async t => {
  const gui = process.env.BLOCK_EDITOR_GUI_ROOT;
  if (!gui) {t.skip('Set BLOCK_EDITOR_GUI_ROOT for the separate real GUI capability check.'); return;}
  const source = readFileSync(join(gui, 'src/lib/tw-block-editor-capabilities.js'), 'utf8');
  const {default: expose} = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  for (const sourceForms of [false, true]) {
    const service = rjsf.createBlockEditorService();
    const api = expose(service.api, sourceForms);
    assert.equal(Object.hasOwn(api, 'registerFixedInputEditor'), false);
    assert.equal(typeof api.register, 'function');
    // The current GUI has removed URL gating; service capabilities are preserved for either legacy argument.
    assert.equal(api.registerSourceEditor, service.api.registerSourceEditor);
    assert.equal(typeof api.registerSourceEditor, 'function');
    const fixedService = rjsf.createBlockEditorService({fixedInputs: true});
    assert.equal(expose(fixedService.api, sourceForms).registerFixedInputEditor, fixedService.api.registerFixedInputEditor);
  }
});
