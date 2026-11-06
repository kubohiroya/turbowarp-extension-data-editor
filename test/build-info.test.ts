import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';

const require = createRequire(import.meta.url);

test('distribution exposes source metadata without requiring a consumer Git checkout', async () => {
  const info = require('@kubohiroya/turbowarp-extension-data-editor/build-info');
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(info.name, manifest.name);
  assert.equal(info.version, manifest.version);
  assert.equal(info.repository, 'https://github.com/kubohiroya/turbowarp-extension-data-editor');
  assert.match(info.revision, /^[a-f0-9]{40}$/);
});

test('source archives retain a full revision without relying on a Git checkout', async () => {
  const {mkdtemp, mkdir, copyFile, writeFile, rm} = await import('node:fs/promises');
  const {tmpdir} = await import('node:os');const {join} = await import('node:path');const {execFileSync} = await import('node:child_process');
  const directory = await mkdtemp(join(tmpdir(), 'editor-archive-'));
  try {
    await mkdir(join(directory, 'scripts'));await mkdir(join(directory, 'dist'));
    await copyFile(new URL('../scripts/write-build-info.ts', import.meta.url), join(directory, 'scripts/write-build-info.ts'));
    await copyFile(new URL('../package.json', import.meta.url), join(directory, 'package.json'));
    const revision = '0123456789abcdef0123456789abcdef01234567';
    await writeFile(join(directory, 'source-revision.txt'), revision+'\n');
    execFileSync(process.execPath, ['scripts/write-build-info.ts'], {cwd: directory});
    assert.equal(JSON.parse(await readFile(join(directory, 'dist/build-info.json'), 'utf8')).revision, revision);
  } finally {await rm(directory, {recursive: true, force: true});}
});
