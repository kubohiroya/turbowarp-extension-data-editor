// SPDX-License-Identifier: GPL-3.0-or-later
// From turbowarp-plus-editor/test/block-editor/icon.test.ts at f660e12.
// The original test license is retained; see LICENSE.GPL-3.0 in this directory.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {JSDOM} from 'jsdom';
import {bindBlockEditorIcon} from '../dist/turbowarp.js';
import {createPlusBlockEditor} from '../dist/plus.js';

test('pointer and keyboard activation use only the icon and release all listeners', () => {
    const dom = new JSDOM('<!doctype html><body><div id="block"><svg><g id="icon"></g></svg></div></body>');
    const element = dom.window.document.getElementById('icon');
    const block = dom.window.document.getElementById('block');
    let opens = 0;
    let blockStarts = 0;
    let allowed = true;
    block.addEventListener('mousedown', () => { blockStarts++; });
    const cleanup = bindBlockEditorIcon({element, label: 'Edit block', canOpen: () => allowed,
        onOpen: () => { opens++; }});
    const pointer = (type, x = 0, y = 0) => {
        const event = new dom.window.MouseEvent(type, {bubbles: true, cancelable: true, clientX: x, clientY: y});
        Object.defineProperty(event, 'pointerId', {value: 1});
        element.dispatchEvent(event);
    };
    pointer('pointerdown');
    element.dispatchEvent(new dom.window.MouseEvent('mousedown', {bubbles: true, cancelable: true}));
    pointer('pointerup');
    assert.equal(opens, 1);
    assert.equal(blockStarts, 0);
    pointer('pointerdown');
    pointer('pointermove', 20);
    pointer('pointerup');
    assert.equal(opens, 1);
    for (const key of ['Enter', ' ']) {
        element.dispatchEvent(new dom.window.KeyboardEvent('keydown', {key, bubbles: true, cancelable: true}));
    }
    assert.equal(opens, 3);
    allowed = false;
    pointer('pointerdown'); pointer('pointerup');
    assert.equal(opens, 3);
    cleanup();
    assert.equal(element.hasAttribute('role'), false);
    assert.equal(element.hasAttribute('tabindex'), false);
    element.dispatchEvent(new dom.window.MouseEvent('mousedown', {bubbles: true}));
    assert.equal(blockStarts, 1);
});

test('schema-only registration supplies serialization and authoritative validation', async () => {
    const service = createPlusBlockEditor().createService();
    const remove = service.api.register({
        apiVersion: 1, extensionId: 'demo', editorId: 'schema', opcodes: ['demo_scene'],
        argument: 'PROPERTIES',
        schema: {type: 'object', properties: {duration: {type: 'number', minimum: 1}},
            required: ['duration'], additionalProperties: false}
    });
    let block = {targetId: 'sprite', blockId: 'scene', opcode: 'demo_scene', revision: '1',
        arguments: {PROPERTIES: {kind: 'literal', value: '{"duration":2}'}}};
    let commits = 0;
    const session = service.registry.open(block, {readBlock: () => block, commit: request => {
        commits++;
        block = {...block, arguments: {PROPERTIES: {kind: 'literal', value: request.changes[0].value}}};
    }});
    session.setDraft({data: {duration: 0}});
    assert.equal((await session.save()).status, 'invalid');
    assert.equal(commits, 0);
    session.setDraft({data: {duration: 4}});
    assert.equal((await session.save()).status, 'saved');
    assert.equal(commits, 1);
    assert.equal(block.arguments.PROPERTIES.value, '{"duration":4}');
    remove();
});
