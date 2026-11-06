import assert from 'node:assert/strict';
import {test} from 'node:test';
import {EditorRegistry} from '../dist/index.js';
import {jsonPropertiesEditor} from '../examples/json-properties.ts';

test('JSON properties example validates before handing one literal change to the host', async () => {
  const registry = new EditorRegistry();
  registry.register(jsonPropertiesEditor);
  let block = {
    targetId: 'sprite', blockId: 'scene', opcode: 'story_scene', revision: '1',
    arguments: {PROPERTIES: {kind: 'literal', value: '{}'}}
  };
  let commits = 0;
  const host = {
    readBlock: () => block,
    commit: request => {
      commits += 1;
      block = {...block, revision: '2', arguments: {
        PROPERTIES: {kind: 'literal', value: request.changes[0].value}
      }};
    }
  };
  const session = registry.open(block, host);
  for (const properties of ['broken', 'null', '[]', '42']) {
    session.setDraft({properties});
    assert.equal((await session.save()).status, 'invalid');
    assert.equal(commits, 0);
  }
  session.setDraft({properties: '{"duration":2}'});
  assert.equal((await session.save()).status, 'saved');
  assert.equal(commits, 1);
  assert.equal(block.arguments.PROPERTIES.value, '{"duration":2}');
});
