import assert from 'node:assert/strict';
import {test} from 'node:test';
import {attachTurboWarpBlockEditors} from '../dist/turbowarp.js';

test('disabled adapters do not inspect native handles or attach listeners, even without a DOM', () => {
  for (const enabled of [undefined, false]) {
    const options = {enabled};
    for (const name of ['ScratchBlocks', 'workspace', 'vm', 'service', 'label', 'canOpen', 'onOpen', 'onError']) {
      Object.defineProperty(options, name, {get() { throw new Error(`Disabled adapter read ${name}`); }});
    }
    const attachment = attachTurboWarpBlockEditors(options);
    assert.ok(Object.isFrozen(attachment));
    attachment.refresh();
    attachment.dispose();
    attachment.dispose();
    attachment.refresh();
  }
});
