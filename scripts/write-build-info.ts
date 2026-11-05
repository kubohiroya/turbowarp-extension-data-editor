import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile, writeFile, readdir} from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const {name, version, repository} = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
let revision;
try {
  // git archive substitutes this file, including GitHub's commit source archives.
  const archived = (await readFile(new URL('source-revision.txt', root), 'utf8')).trim();
  if (/^[a-f0-9]{40}$/.test(archived)) revision = archived;
} catch { /* A regular checkout may not contain an archive stamp. */ }
revision ??= execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim();
if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('A full source revision is required.');
let sourceState = 'archive';
try {
  sourceState = execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', 'src', 'scripts',
    'package.json', 'tsconfig.json', 'webpack4.cts'], {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim()
    ? 'working-tree' : 'commit';
} catch { /* A source archive has no Git metadata. */ }
const hash = createHash('sha256');
async function hashPath(path) {
  try {
    const entries = await readdir(new URL(path, root), {withFileTypes: true});
    for (const entry of entries.sort((a,b) => a.name.localeCompare(b.name))) await hashPath(`${path}/${entry.name}`);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    if (error.code !== 'ENOTDIR') throw error;
    hash.update(path + '\0');hash.update(await readFile(new URL(path, root)));hash.update('\0');
  }
}
for (const path of ['package.json', 'scripts', 'src', 'tsconfig.json', 'webpack4.cts']) await hashPath(path);
await writeFile(new URL('dist/build-info.json', root), JSON.stringify({
  name, version, repository: repository.url.replace(/^git\+/, '').replace(/\.git$/, ''), revision,
  sourceState, sourceSha256: hash.digest('hex'), capabilities: {preparedSource: 1}
}, null, 2) + '\n');
