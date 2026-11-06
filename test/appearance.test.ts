import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readBlockEditorAppearance} from '../dist/turbowarp.js';

const ScratchBlocks = {INPUT_VALUE: 1, NEXT_STATEMENT: 3, FieldImage: class {}};
const label = text => ({getText: () => text});
const literal = text => ({isShadow: () => true, inputList: [{fieldRow: [label(text)]}]});
const valueInput = (name, text, child) => ({name, type: ScratchBlocks.INPUT_VALUE,
  fieldRow: [label(text)], connection: {targetBlock: () => child}});

test('asset identifiers appear in block order while editor documents and statements remain unread', () => {
  const icon = new ScratchBlocks.FieldImage();icon.getValue = () => 'icon.svg';
  const block = {getColour: () => '#087f8c', inputList: [
    {...valueInput('NAME', 'asset', literal('Turtle')), fieldRow: [icon, label('asset')]},
    {name: 'VALUE', type: ScratchBlocks.INPUT_VALUE, fieldRow: [label('= JSON')],
      connection: {targetBlock() {throw new Error('Do not read the editor document');}}},
    {type: ScratchBlocks.NEXT_STATEMENT, get fieldRow() {throw new Error('Do not read statements');}}
  ]};
  const appearance = readBlockEditorAppearance(block, ScratchBlocks, ['VALUE']);
  assert.deepEqual(appearance, {name: 'asset (Turtle) = JSON', colour: '#087f8c',
    tint: 'rgba(8, 127, 140, 0.08)', iconURI: 'icon.svg'});
  assert.equal(readBlockEditorAppearance(block, ScratchBlocks).name, 'asset = JSON');
  assert.equal(readBlockEditorAppearance(block, ScratchBlocks, ['NAME', 'VALUE']).name, 'asset = JSON');
});

test('identifiers handle multiple inputs, empty values, reporters and unavailable connections', () => {
  const reporter = {isShadow: () => false, get inputList() {throw new Error('Do not inspect reporters');}};
  const block = {inputList: [
    valueInput('NAME', 'asset', literal('  Turtle  ')),
    valueInput('COUNT', 'count', literal('2')),
    valueInput('EMPTY', 'empty', literal('   ')),
    valueInput('REPORTER', 'reporter', reporter),
    valueInput('DISCONNECTED', 'missing', null),
    {name: 'BROKEN', type: ScratchBlocks.INPUT_VALUE, fieldRow: [label('unavailable')],
      connection: {targetBlock() {throw new Error('Disconnected');}}}
  ]};
  assert.equal(readBlockEditorAppearance(block, ScratchBlocks, []).name,
    'asset (Turtle) count (2) empty reporter missing unavailable');
});
