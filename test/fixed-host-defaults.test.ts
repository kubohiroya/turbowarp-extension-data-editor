import assert from 'node:assert/strict';
import {test} from 'node:test';
import {nativeFixture, nativeAvailable} from './fixtures/fixed-host-native.ts';

test('the TurboWarp host reads each input default from the extension block info', {skip: !nativeAvailable}, t => {
  const f = nativeFixture();
  t.after(() => f.close());
  assert.equal(f.read().fixedContext.defaults, undefined, 'no block info, no defaults');
  f.runtime._blockInfo = [{id: 'other', blocks: []}, {id: 'native', blocks: [
    {info: {opcode: 'other', arguments: {}}},
    {info: {opcode: 'fixed', arguments: {TEXT: {defaultValue: 'old'}, NUMBER: {defaultValue: 10}, MENU: {}}}}
  ]}];
  assert.deepEqual({...f.read().fixedContext.defaults}, {TEXT: 'old', NUMBER: 10, MENU: ''});
});
