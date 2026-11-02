import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';

test('the webpack4 bundle carries the license of every third-party package it includes', async () => {
  const {inputs} = JSON.parse(await readFile(new URL('../dist/webpack4/metafile.json', import.meta.url), 'utf8'));
  const notices = await readFile(new URL('../dist/webpack4/THIRD_PARTY_LICENSES.md', import.meta.url), 'utf8');
  const bundled = new Set();
  for (const input of Object.keys(inputs)) {
    const match = input.match(/.*node_modules\/((?:@[^/]+\/)?[^/.@][^/]*)\//);
    if (match) bundled.add(match[1]);
  }
  assert.ok(bundled.size > 0, 'the bundle includes third-party packages');
  for (const name of bundled) {
    assert.match(notices, new RegExp(`^## ${name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}@`, 'm'), `${name} is listed`);
  }
  for (const section of notices.split(/^## /m).slice(1)) {
    assert.match(section, /^License: \S/m, `${section.split('\n')[0]} states its license`);
    assert.match(section, /```text\n[\s\S]*?\S[\s\S]*?\n```/, `${section.split('\n')[0]} includes license text`);
  }
});
