// SPDX-License-Identifier: GPL-3.0-or-later
// From turbowarp-plus-editor/test/block-editor/appearance.test.ts at e954848.
// The original test license is retained; see LICENSE.GPL-3.0 in this directory.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readBlockEditorAppearance} from '@kubohiroya/turbowarp-extension-data-editor/turbowarp';
import {fixture, ScratchBlocks} from './fixtures/editor-block-host.ts';



test('appearance follows each real block instance and does not mutate block or VM data', t => {
    const f = fixture(t);
    const before = JSON.stringify(f.target.blocks.toXML());
    const icon = f.block.inputList[0].fieldRow[0].getValue();
    assert.deepEqual(readBlockEditorAppearance(f.block, ScratchBlocks), {
        name: 'scene name', colour: '#087f8c', tint: 'rgba(8, 127, 140, 0.08)', iconURI: icon
    });
    const sibling = f.workspace.newBlock('story_scene');
    sibling.setColour('#663399');
    sibling.inputList[0].fieldRow[0].setValue('data:image/svg+xml,<svg id="sibling"/>');
    assert.deepEqual(readBlockEditorAppearance(sibling, ScratchBlocks), {
        name: 'scene name', colour: '#663399', tint: 'rgba(102, 51, 153, 0.08)', iconURI: 'data:image/svg+xml,<svg id="sibling"/>'
    });
    assert.equal(readBlockEditorAppearance(f.block, ScratchBlocks).colour, '#087f8c');
    // Reading presentation data creates no value edits, undo entries or dirty notifications.
    assert.equal(JSON.stringify(f.target.blocks.toXML()), before);
    assert.equal(f.workspace.undoStack_.length, 0);
    assert.equal(f.dirty(), 0);
});

test('missing and malformed presentation data falls back independently without guessing an icon', () => {
    const colour = () => '#ffab19';
    const image = new ScratchBlocks.FieldImage('data:image/svg+xml,<svg/>', 24, 24);
    assert.deepEqual(readBlockEditorAppearance(null, ScratchBlocks), {});
    assert.deepEqual(readBlockEditorAppearance({getColour: colour, inputList: []}, ScratchBlocks), {
        colour: '#ffab19', tint: 'rgba(255, 171, 25, 0.08)'
    });
    // A later image may be part of the block's content, not its extension icon.
    assert.equal(readBlockEditorAppearance({getColour: colour,
        inputList: [{fieldRow: [{}, image]}]}, ScratchBlocks).iconURI, undefined);
    for (const invalid of [undefined, 'red', '#123', '#12345678', 'url(unknown)']) {
        assert.deepEqual(readBlockEditorAppearance({getColour: () => invalid,
            inputList: [{fieldRow: [image]}]}, ScratchBlocks), {iconURI: image.getValue()});
    }
    assert.deepEqual(readBlockEditorAppearance({getColour: () => { throw new Error('No colour'); },
        inputList: [{fieldRow: [image]}]}, ScratchBlocks), {iconURI: image.getValue()});
    image.getValue = () => { throw new Error('No image'); };
    assert.deepEqual(readBlockEditorAppearance({getColour: colour,
        inputList: [{fieldRow: [image]}]}, ScratchBlocks), {
        colour: '#ffab19', tint: 'rgba(255, 171, 25, 0.08)'
    });
});


test('names use localized block labels without connected values or statement content', () => {
    const label = text => ({getText: () => text});
    const image = new ScratchBlocks.FieldImage('icon.svg', 24, 24);
    const block = {getColour: () => '#087f8c', inputList: [
        {fieldRow: [image, label('  シーンを')], connection: {targetBlock: () => {
            throw new Error('Connected JSON must never be read for the block name');
        }}},
        {fieldRow: [label(' 編集する  ')]},
        {type: ScratchBlocks.NEXT_STATEMENT, fieldRow: [label('Hidden branch label')]}
    ]};
    assert.equal(readBlockEditorAppearance(block, ScratchBlocks).name, 'シーンを 編集する');
    block.inputList = [{fieldRow: [image]}];
    assert.equal(readBlockEditorAppearance(block, ScratchBlocks).name, undefined);
});
