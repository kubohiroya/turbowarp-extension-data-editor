import assert from 'node:assert/strict';
import {test} from 'node:test';
import {cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import * as schema from '@kubohiroya/turbowarp-extension-data-editor/schema';

const root = fileURLToPath(new URL('../', import.meta.url));
const packageName = '@kubohiroya/turbowarp-extension-data-editor';
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

test('built JavaScript and declarations match source emission hashes', () => {
  const require = createRequire(join(root, 'package.json'));
  const ts = require('typescript');
  const config = ts.readConfigFile(join(root, 'tsconfig.json'), ts.sys.readFile);
  assert.equal(config.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  assert.deepEqual(parsed.errors, []);
  const host = ts.createCompilerHost(parsed.options);
  const outputs = [];
  // Capture emit in memory: this test must never repair stale artifacts by writing them.
  host.writeFile = (file, text) => outputs.push({file, text});
  const program = ts.createProgram(parsed.fileNames, parsed.options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, host));
  const result = program.emit();
  assert.equal(result.emitSkipped, false);
  assert.deepEqual(result.diagnostics, []);
  assert.ok(outputs.length > 0);
  const hash = value => createHash('sha256').update(value).digest('hex');
  for (const {file, text} of outputs) {
    assert.equal(hash(readFileSync(file)), hash(text), `Stale build artifact: ${file}`);
  }
});

test('exports the pure engine, synchronous composition and diagnostic bridge', () => {
  assert.deepEqual(Object.keys(schema), ['compileSchemaBundle', 'jsonValueSchema', 'jsonValueSchemaBundle', 'parseFixedNumberInput', 'toValidationIssues', 'validateSchemaInput']);
  assert.deepEqual(schema.toValidationIssues([]), []);
});

test('preserves the eight existing exports, CSS side effects and the copy build', async () => {
  const expected = {
    '.': {types: './dist/index.d.ts', import: './dist/index.js'},
    './rjsf': {types: './dist/rjsf.d.ts', import: './dist/rjsf.js'},
    './react': {types: './dist/react.d.ts', import: './dist/react.js'},
    './react/styles.css': './dist/react.css',
    './turbowarp': {types: './dist/turbowarp.d.ts', import: './dist/turbowarp.js'},
    './schema': {types: './dist/schema.d.ts', import: './dist/schema.js'},
    './webpack4': {require: './webpack4.cjs'},
    './build-info': './dist/build-info.json'
  };
  assert.deepEqual(manifest.exports, expected);
  assert.deepEqual(manifest.sideEffects, ['**/*.css']);
  assert.equal(manifest.scripts.build, 'tsc --project tsconfig.json && node scripts/copy-react-css.mjs && node scripts/build-webpack4.mjs && node scripts/write-third-party-licenses.mjs && node scripts/write-build-info.mjs');
  assert.equal(manifest.main, './dist/index.js');
  assert.equal(manifest.module, './dist/index.js');
  assert.equal(manifest.types, './dist/index.d.ts');
  assert.ok(manifest.files.includes('dist'));
  for (const target of Object.values(expected)) {
    for (const path of typeof target === 'string' ? [target] : Object.values(target)) {
      assert.ok(existsSync(join(root, path)), path);
    }
  }
  assert.deepEqual(readFileSync(join(root, 'src/react.css')), readFileSync(join(root, 'dist/react.css')));
  for (const entry of ['', '/rjsf', '/react', '/turbowarp']) {
    assert.ok(await import(`${packageName}${entry}`));
  }
  const rootAPI = await import(packageName);
  assert.equal(rootAPI.EDITOR_API_VERSION, 1);
  assert.equal('toValidationIssues' in rootAPI, false);
  assert.equal('compileSchemaBundle' in rootAPI, false);
});

test('the schema JS and declarations work in an isolated package with no peers or DOM', t => {
  const isolated = realpathSync(mkdtempSync(join(tmpdir(), 'block-editor-schema-')));
  t.after(() => rmSync(isolated, {recursive: true, force: true}));
  const packagePath = join(isolated, 'node_modules', '@kubohiroya', 'turbowarp-extension-data-editor');
  mkdirSync(packagePath, {recursive: true});
  cpSync(join(root, 'dist'), join(packagePath, 'dist'), {recursive: true});
  cpSync(join(root, 'package.json'), join(packagePath, 'package.json'));
  const copied = new Set();
  const copyRuntimeDependency = (name, from) => {
    if (copied.has(name)) return;
    const location = createRequire(from).resolve(`${name}/package.json`);
    const definition = JSON.parse(readFileSync(location, 'utf8'));
    copied.add(name);
    cpSync(dirname(location), join(isolated, 'node_modules', name), {recursive: true, dereference: true});
    for (const child of Object.keys(definition.dependencies ?? {})) copyRuntimeDependency(child, location);
  };
  for (const name of ['ajv', 'ajv-formats', 'fast-uri']) copyRuntimeDependency(name, join(root, 'package.json'));
  writeFileSync(join(isolated, 'package.json'), JSON.stringify({private: true, type: 'module'}));
  cpSync(join(root, 'test/types/schema-pure-consumer.ts'), join(isolated, 'schema-pure-consumer.ts'));
  cpSync(join(root, 'test/types/tsconfig.schema-pure.json'), join(isolated, 'tsconfig.json'));

  // Install the pure engine's dependencies, excluding UI packages and peer dependencies.
  assert.equal(existsSync(join(packagePath, 'node_modules')), false);
  assert.equal(existsSync(join(isolated, 'node_modules', 'react')), false);
  assert.equal(existsSync(join(isolated, 'node_modules', '@rjsf')), false);
  writeFileSync(join(isolated, 'consumer.mjs'), `
    import assert from 'node:assert/strict';
    for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node']) {
      Object.defineProperty(globalThis, name, {configurable: true, get() {throw new Error('DOM accessed');}});
    }
    const schema = await import('${packageName}/schema');
    assert.deepEqual(Object.keys(schema), ['compileSchemaBundle', 'jsonValueSchema', 'jsonValueSchemaBundle', 'parseFixedNumberInput', 'toValidationIssues', 'validateSchemaInput']);
    assert.deepEqual(schema.toValidationIssues([]), []);
  `);
  const env = {...process.env};
  delete env.NODE_PATH;
  delete env.NODE_OPTIONS;
  const runtime = spawnSync(process.execPath, ['consumer.mjs'], {cwd: isolated, env, encoding: 'utf8'});
  assert.equal(runtime.status, 0, runtime.stderr || runtime.error?.message);
  const require = createRequire(import.meta.url);
  const tsc = join(dirname(require.resolve('typescript/package.json')), 'bin/tsc');
  const types = spawnSync(process.execPath, [tsc, '--noEmit', '-p', 'tsconfig.json'], {
    cwd: isolated, env, encoding: 'utf8'
  });
  assert.equal(types.status, 0, types.stdout + types.stderr || types.error?.message);
});
