import { readFile, realpath, cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root = process.cwd(),
  manifest = JSON.parse(await readFile('package.json', 'utf8'));
const entry =
  manifest.name === '@kubohiroya/turbowarp-extension-data-editor' ? '/schema' : '/editor-schema';
const temp = await mkdtemp('/tmp/schema-owner-consumer-');
const target = join(temp, 'node_modules', manifest.name);
await mkdir(target, { recursive: true });
const packed = JSON.parse(
  execFileSync(
    'npm',
    [
      '--cache',
      '/tmp/schema-stage1-npm-cache',
      'pack',
      '--ignore-scripts',
      '--json',
      '--pack-destination',
      temp,
    ],
    { encoding: 'utf8' },
  ),
)[0];
execFileSync('tar', ['-xzf', join(temp, packed.filename), '-C', target, '--strip-components=1']);
await rm(join(target, 'src'), { recursive: true, force: true });
const copied = new Set();
async function copyDependency(name, from) {
  const require = createRequire(join(from, 'package.json'));
  let m;
  for (const base of require.resolve.paths(name) ?? [])
    try {
      const candidate = join(base, name, 'package.json');
      await readFile(candidate);
      m = candidate;
      break;
    } catch {}
  if (!m) throw Error('Cannot resolve ' + name);
  m = await realpath(m);
  const pkg = JSON.parse(await readFile(m, 'utf8'));
  if (copied.has(pkg.name)) return;
  copied.add(pkg.name);
  const out = join(temp, 'node_modules', pkg.name);
  await cp(dirname(m), out, {
    recursive: true,
    filter: (src) => !src.split('/').slice(dirname(m).split('/').length).includes('node_modules'),
  });
  // Explicit inputs keep unrelated extension/ML dependencies out of this pure consumer.
  if (
    [
      '@kubohiroya/turbowarp-extension-data-editor',
      '@kubohiroya/turbowarp-scene-graph',
      '@kubohiroya/turbowarp-camera-source',
    ].includes(name) ||
    !name.startsWith('@kubohiroya/')
  )
    for (const dep of Object.keys(pkg.dependencies ?? {})) await copyDependency(dep, dirname(m));
}
for (const name of process.argv.slice(2)) await copyDependency(name, root);
try {
  await readFile(join(temp, 'node_modules/react/package.json'));
  throw Error('React leaked into pure consumer');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await writeFile(
  join(temp, 'consumer.mjs'),
  `let accesses=0;for(const name of ['document','window','navigator','Scratch','WebSocket','fetch','MediaDevices'])Object.defineProperty(globalThis,name,{configurable:true,get(){accesses++;throw Error('Pure import accessed '+name)}});const owner=await import('${manifest.name}${entry}');${entry === '/schema' ? `const prefab=await import('./node_modules/${manifest.name}/dist/webpack4/schema.js');if(Object.keys(prefab).sort().join()!==Object.keys(owner).sort().join())throw Error('webpack schema exports differ');` : ''}if(!Object.keys(owner).length)throw Error('empty entry');if(accesses)throw Error('side effect');console.log(JSON.stringify({package:${JSON.stringify(manifest.name)},exports:Object.keys(owner),sourceAbsent:true,globalAccesses:accesses,reactInstalled:false}));`,
);
try {
  execFileSync(process.execPath, [join(temp, 'consumer.mjs')], { stdio: 'inherit' });
} catch (error) {
  console.error('isolated consumer retained:', temp);
  throw error;
}
await writeFile(
  join(temp, 'consumer.ts'),
  `import * as owner from '${manifest.name}${entry}'; export const checked = owner;`,
);
await writeFile(
  join(temp, 'tsconfig.json'),
  JSON.stringify({
    compilerOptions: {
      noEmit: true,
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      target: 'ES2022',
      lib: ['ES2022'],
      types: [],
      strict: true,
      skipLibCheck: false,
      resolveJsonModule: true,
    },
    include: ['consumer.ts'],
  }),
);
execFileSync(
  process.execPath,
  [join(root, 'node_modules/typescript/bin/tsc'), '--project', join(temp, 'tsconfig.json')],
  { stdio: 'inherit' },
);
if (entry === '/schema') {
  // This checks our public UI options against packed declarations, without importing React.
  // Legacy RJSF declarations retain the separately documented skipLibCheck limitation.
  await writeFile(join(temp, 'legacy-options.ts'), `
import {createSchemaBundleEditor} from '${manifest.name}/rjsf';
import type {SchemaBundleEditorOptions} from '${manifest.name}/rjsf';
import type {SchemaBundle} from '${manifest.name}/schema';
declare const schemaBundle: SchemaBundle;
const shared = {apiVersion:1 as const,extensionId:'owner',editorId:'default',opcodes:['owner_data'],argument:'JSON',schemaBundle};
export const options: SchemaBundleEditorOptions = {...shared,
  validationContext:()=>({consumerId:'owner',nowMs:0,settings:null})};
export const editor = createSchemaBundleEditor(options);
export const inline = createSchemaBundleEditor({...options,validationContext:()=>({consumerId:'owner',nowMs:0,settings:null})});
export const explicit: SchemaBundleEditorOptions<{delegate:boolean}> = {...shared,validationContext:()=>({consumerId:'owner',nowMs:0,settings:{delegate:true}})};
export const invalid: SchemaBundleEditorOptions = {...options,
  // @ts-expect-error Settings-free options only accept null.
  validationContext:()=>({consumerId:'owner',nowMs:0,settings:{delegate:true}})};
`);
  await writeFile(join(temp, 'tsconfig.legacy-options.json'), JSON.stringify({
    extends: './tsconfig.json',
    compilerOptions: {lib: ['ES2022', 'DOM'], skipLibCheck: true},
    include: ['legacy-options.ts'],
  }));
  execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--project',
    join(temp, 'tsconfig.legacy-options.json')], {stdio: 'inherit'});
  console.log(JSON.stringify({packedRjsfOptionsDefault: 'null', legacyOptionsTypecheck: true, legacySkipLibCheck: true}));
}
console.log('artifact:', packed.filename, 'unpackedBytes:', packed.unpackedSize, 'isolated:', temp);

const config = entry === '/schema' ? 'tsconfig.json' : 'tsconfig.editor.json';
const emitted = join(temp, 'emitted');
execFileSync(
  process.execPath,
  [
    join(root, 'node_modules/typescript/bin/tsc'),
    '--project',
    join(root, config),
    '--outDir',
    emitted,
  ],
  { stdio: 'inherit' },
);
const { readdir } = await import('node:fs/promises');
async function hashes(directory, prefix = '') {
  const result = {};
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name),
      key = prefix + item.name;
    if (item.isDirectory()) Object.assign(result, await hashes(path, key + '/'));
    else
      result[key] = createHash('sha256')
        .update(await readFile(path))
        .digest('hex');
  }
  return result;
}
const expected = await hashes(emitted),
  actual = await hashes(join(root, entry === '/schema' ? 'dist' : 'lib-editor'));
for (const [file, hash] of Object.entries(expected))
  if (actual[file] !== hash) throw Error('Source/output mismatch: ' + file);
if (entry !== '/schema' && Object.keys(actual).length !== Object.keys(expected).length)
  throw Error('Stale generated files');
console.log(
  JSON.stringify({
    sourceEmittedHashMatches: Object.keys(expected).length,
    extraDistributionArtifacts: Object.keys(actual).filter((file) => !(file in expected)),
  }),
);

if (entry === '/schema') {
  const meta = JSON.parse(await readFile(join(root, 'dist/webpack4/metafile.json'), 'utf8'));
  const known = new Set([
    'react.css',
    'build-info.json',
    'webpack4/metafile.json',
    ...Object.keys(meta.outputs).map((path) => path.replace(/^dist\//, '')),
  ]);
  const extras = Object.keys(actual).filter((file) => !(file in expected));
  if (extras.length !== known.size || extras.some((file) => !known.has(file)))
    throw Error('Unexpected distribution files');
  if (
    actual['react.css'] !==
    createHash('sha256')
      .update(await readFile(join(root, 'src/react.css')))
      .digest('hex')
  )
    throw Error('CSS source/output mismatch');
  console.log(
    JSON.stringify({
      cssHashMatches: true,
      webpackOutputsMatchMetafile: Object.keys(meta.outputs).length,
      distributionFiles: Object.keys(actual).length,
    }),
  );
}
