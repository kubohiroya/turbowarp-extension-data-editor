import {readFile, readdir, writeFile} from 'node:fs/promises';
import path from 'node:path';

// dist/webpack4 bundles third-party packages, so their notices must travel with it.
const root = path.resolve(new URL('../', import.meta.url).pathname);
const {inputs} = JSON.parse(await readFile(path.join(root, 'dist/webpack4/metafile.json'), 'utf8'));

// Packages that publish no license file; the text is MIT with the notice from their README.
const missingLicenseFiles = {
    'json-schema-merge-allof': 'Copyright (c) Martin Hansen'
};
const mitText = notice => `MIT License

${notice}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

const directories = new Set();
for (const input of Object.keys(inputs)) {
    const match = input.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/.@][^/]*)\//);
    if (match) directories.add(path.resolve(root, match[1]));
}

const packages = [];
for (const directory of directories) {
    const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
    const license = manifest.license ?? manifest.licenses?.map(entry => entry.type).join(' OR ');
    if (!license) throw new Error(`${manifest.name} declares no license`);
    const files = (await readdir(directory)).filter(name => /^(licen[cs]e|copying|notice)(\.|$)/i.test(name)).sort();
    const texts = [];
    for (const name of files) texts.push((await readFile(path.join(directory, name), 'utf8')).trim());
    if (texts.length === 0) {
        const notice = missingLicenseFiles[manifest.name];
        if (!notice || license !== 'MIT') throw new Error(`${manifest.name} has no license file to include`);
        texts.push(mitText(notice).trim());
    }
    packages.push({name: manifest.name, version: manifest.version, license, texts});
}
packages.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

const sections = packages.map(entry => [
    `## ${entry.name}@${entry.version}`,
    '',
    `License: ${entry.license}`,
    '',
    ...entry.texts.flatMap(text => ['```text', text, '```', ''])
].join('\n'));
await writeFile(path.join(root, 'dist/webpack4/THIRD_PARTY_LICENSES.md'), [
    '# Third-party licenses',
    '',
    'The files in `dist/webpack4` bundle the following packages. Each keeps its own license.',
    'The rest of this package is MPL-2.0 (see `LICENSE`).',
    '',
    ...sections
].join('\n'));
console.log(`Third-party licenses recorded for ${packages.length} packages`);
