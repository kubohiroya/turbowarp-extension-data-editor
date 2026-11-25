// SPDX-License-Identifier: GPL-3.0-or-later
// From turbowarp-plus-editor/test/block-editor/descendant-host.test.ts at e954848.
// The original test license is retained; see LICENSE.GPL-3.0 in this directory.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {BlockEditorConflictError, BlockEditorStructureError} from '@kubohiroya/turbowarp-extension-data-editor';
import {fixture, makeDefinition, ScratchBlocks} from './fixtures/editor-block-host.ts';

import {hostRequire} from './fixtures/editor-block-host.ts';


const require = hostRequire;

ScratchBlocks.Blocks.story_group = {
    init() {
        this.jsonInit({
            message0: '%1 group %2 name %3 check %4',
            args0: [
                {type: 'field_image', src: 'data:image/svg+xml,<svg/>', width: 40, height: 40},
                {type: 'input_value', name: 'PROPERTIES'}, {type: 'input_value', name: 'NAME'},
                {type: 'input_value', name: 'CHECK'}
            ],
            message1: 'body %1', args1: [{type: 'input_statement', name: 'BODY'}],
            message2: 'otherwise %1', args2: [{type: 'input_statement', name: 'ALTERNATIVE'}],
            previousStatement: null, nextStatement: null, colour: '#087f8c'
        });
    }
};

const argumentsXml = id => `<value name="PROPERTIES"><shadow type="text" id="${id}-props">` +
    '<field name="TEXT">{}</field></shadow></value>' +
    `<value name="NAME"><shadow type="text" id="${id}-name"><field name="TEXT">${id}</field></shadow></value>`;
const itemXml = (id, next = '') => `<block type="story_scene" id="${id}">${argumentsXml(id)}` +
    (next ? `<next>${next}</next>` : '') + '</block>';
const treeXml = '<xml><block type="story_group" id="scene">' + argumentsXml('scene') +
    '<value name="CHECK"><block type="operator_equals" id="reporter"/></value>' +
    '<statement name="BODY">' + itemXml('first',
        '<block type="control_if_else" id="middle"><statement name="SUBSTACK">' + itemXml('grand') +
        '</statement><next>' + itemXml('sibling') + '</next></block>') +
    '</statement><statement name="ALTERNATIVE">' + itemXml('right') + '</statement><next>' +
    itemXml('outside') + '</next></block></xml>';

function hierarchyFixture(t, overrides = {}, xmlText = treeXml) {
    const f = fixture(t, {enableDescendants: true, xmlText,
        definition: makeDefinition({opcodes: ['story_group', 'story_scene'], ...overrides})});
    return {...f, openTree: () => f.registry.openDescendants(f.reference, f.host),
        value: id => f.vmValue(`${id}-props`)};
}
const edit = (session, id, properties, name = 'changed') => session.getEditor(id).setDraft({properties, name});

test('real Blockly traversal keeps internal next/branches/unregistered nodes and excludes outer next/reporters', t => {
    const f = hierarchyFixture(t);
    const session = f.openTree();
    assert.ok(session);
    assert.deepEqual(session.getNodes().map(node => node.reference.blockId),
        ['scene', 'first', 'middle', 'grand', 'sibling', 'right']);
    const grand = session.getNodes().find(node => node.reference.blockId === 'grand');
    assert.deepEqual(grand.inputPath.map(step => [step.blockId, step.input, step.index]),
        [['scene', 'BODY', 1], ['middle', 'SUBSTACK', 0]]);
    assert.equal(session.getEditor('middle'), undefined);
    assert.equal(session.getEditor('outside'), undefined);
    assert.equal(session.getEditor('reporter'), undefined);
    edit(session, 'grand', '{"value":"draft"}');
    session.cancel();
    assert.equal(f.value('grand'), '{}');
    assert.equal(f.dirty(), 0);
    assert.equal(f.workspace.undoStack_.length, 0);
});

test('all descendant changes update the actual VM in one undo/redo group with one dirty notification', async t => {
    const f = hierarchyFixture(t);
    const session = f.openTree();
    const reporter = f.block.getInput('CHECK').connection.targetBlock();
    const next = f.block.getNextBlock();
    edit(session, 'scene', '{"root":1}', 'root edited');
    edit(session, 'grand', '{"grand":2}', 'grand edited');
    edit(session, 'sibling', '{"sibling":3}', 'sibling edited');
    assert.equal((await session.save()).status, 'saved');
    assert.equal(f.value('scene'), '{"root":1}');
    assert.equal(f.value('grand'), '{"grand":2}');
    assert.equal(f.value('sibling'), '{"sibling":3}');
    assert.equal(f.value('outside'), '{}');
    assert.equal(f.dirty(), 1);
    const events = f.workspace.undoStack_;
    assert.equal(events.length, 6);
    assert.ok(events[0].group);
    assert.ok(events.every(event => event.group === events[0].group));
    f.workspace.undo(false);
    ScratchBlocks.Events.fireNow_();
    for (const id of ['scene', 'grand', 'sibling']) assert.equal(f.value(id), '{}');
    f.workspace.undo(true);
    ScratchBlocks.Events.fireNow_();
    assert.equal(f.value('grand'), '{"grand":2}');
    assert.equal(f.block.getInput('CHECK').connection.targetBlock(), reporter);
    assert.equal(f.block.getNextBlock(), next);
});

test('unchanged hierarchy save preserves redo and does not emit dirty or events', async t => {
    const f = hierarchyFixture(t);
    f.field('first-name').setValue('temporary');
    ScratchBlocks.Events.fireNow_();
    f.workspace.undo(false);
    ScratchBlocks.Events.fireNow_();
    const dirty = f.dirty();
    const redo = [...f.workspace.redoStack_];
    assert.deepEqual(await f.openTree().save(), {status: 'saved', changed: false});
    assert.equal(f.dirty(), dirty);
    assert.deepEqual(Array.from(f.workspace.redoStack_), redo);
});

test('setter or event-listener failure rolls back every descendant and allows retry with the same draft', async t => {
    for (const phase of ['setter', 'listener']) {
        const f = hierarchyFixture(t);
        const session = f.openTree();
        edit(session, 'first', '{"one":1}', 'one');
        edit(session, 'grand', '{"two":2}', 'two');
        const field = f.field('grand-name');
        const setter = field.setValue;
        const listener = event => {
            if (event.newValue === 'two') throw new Error('Injected event failure');
        };
        if (phase === 'setter') field.setValue = function(value) {
            setter.call(this, value);
            if (value === 'two') throw new Error('Injected setter failure');
        };
        else f.workspace.addChangeListener(listener);
        assert.equal((await session.save()).status, 'failed');
        assert.equal(session.getState().status, 'editing');
        for (const id of ['first', 'grand']) assert.equal(f.value(id), '{}');
        assert.equal(f.vmValue('grand-name'), 'grand');
        assert.equal(f.field('grand-name').getValue(), 'grand');
        assert.equal(f.dirty(), 0);
        assert.equal(f.workspace.undoStack_.length, 0);
        assert.equal(f.workspace.redoStack_.length, 0);
        assert.equal(session.getEditor('grand').getDraft().name, 'two');
        field.setValue = setter;
        f.workspace.removeChangeListener(listener);
        assert.equal((await session.save()).status, 'saved');
        assert.equal(f.value('grand'), '{"two":2}');
        assert.equal(f.dirty(), 1);
    }
});

test('a changed hidden grandchild aborts pending validation without applying drafts', async t => {
    let finish;
    const f = hierarchyFixture(t, {validate: () => new Promise(resolve => { finish = resolve; })});
    const session = f.openTree();
    edit(session, 'first', '{"draft":1}');
    const saving = session.save();
    f.field('grand-name').setValue('external');
    ScratchBlocks.Events.fireNow_();
    assert.deepEqual(await saving, {status: 'invalidated'});
    assert.equal(session.getState().status, 'invalidated');
    finish([]);
    await Promise.resolve();
    assert.equal(f.value('first'), '{}');
    assert.equal(f.vmValue('grand-name'), 'external');
});

test('unrelated outer-next field edits leave the hierarchy open and are preserved', async t => {
    const f = hierarchyFixture(t);
    const session = f.openTree();
    f.field('outside-name').setValue('outside edited');
    ScratchBlocks.Events.fireNow_();
    assert.equal(session.getState().status, 'editing');
    edit(session, 'grand', '{"edit":1}');
    assert.equal((await session.save()).status, 'saved');
    assert.equal(f.vmValue('outside-name'), 'outside edited');
});

test('a complete recheck blocks structure/target changes, registration removal and aborted writes', t => {
    const f = hierarchyFixture(t);
    const before = f.host.descendants.readSubtree(f.reference);
    const signal = new AbortController();
    signal.abort();
    assert.throws(() => f.host.descendants.commitSubtree({expected: before,
        changes: [{blockId: 'grand', argument: 'NAME', value: 'bad'}], signal: signal.signal}), BlockEditorConflictError);
    for (const changes of [
        [{blockId: 'outside', argument: 'NAME', value: 'bad'}],
        [{blockId: 'scene', argument: 'CHECK', value: 'disconnect'}],
        [{blockId: 'grand', argument: 'NAME', value: 'one'}, {blockId: 'grand', argument: 'NAME', value: 'two'}]
    ]) assert.throws(() => f.host.descendants.commitSubtree({expected: before, changes,
        signal: new AbortController().signal}), TypeError);
    const session = f.openTree();
    f.unregisterDefinition();
    assert.equal(session.getState().status, 'invalidated');
    assert.throws(() => f.host.descendants.commitSubtree({expected: before, changes: [],
        signal: new AbortController().signal}), BlockEditorConflictError);
    assert.equal(f.dirty(), 0);
});

test('collector reports cyclic or over-deep graphs without returning a partial hierarchy', t => {
    const f = hierarchyFixture(t);
    const first = f.workspace.getBlockById('first');
    const stored = f.target.blocks.getBlock('first');
    const next = stored.next;
    const getNext = first.getNextBlock;
    stored.next = 'first';
    first.getNextBlock = () => first;
    assert.throws(() => f.openTree(), BlockEditorStructureError);
    stored.next = next;
    first.getNextBlock = getNext;
    let nested = itemXml('leaf');
    for (let i = 32; i >= 0; i--) nested = `<block type="story_group" id="${i === 0 ? 'scene' : `d${i}`}">` +
        argumentsXml(i === 0 ? 'scene' : `d${i}`) + `<statement name="BODY">${nested}</statement></block>`;
    const deep = hierarchyFixture(t, {}, `<xml>${nested}</xml>`);
    assert.throws(() => deep.openTree(), error => error instanceof BlockEditorStructureError && error.code === 'limit');
});

test('the collector accepts exactly 500 nodes and refuses the next node without truncation', t => {
    let chain = '';
    for (let i = 498; i >= 0; i--) chain = itemXml(`n${i}`, chain);
    const xml = '<xml><block type="story_group" id="scene">' + argumentsXml('scene') +
        `<statement name="BODY">${chain}</statement></block></xml>`;
    const f = hierarchyFixture(t, {}, xml);
    const session = f.openTree();
    assert.equal(session.getNodes().length, 500);
    session.cancel();
    ScratchBlocks.Xml.domToWorkspace(ScratchBlocks.Xml.textToDom(`<xml>${itemXml('extra')}</xml>`), f.workspace);
    f.workspace.getBlockById('n498').nextConnection.connect(f.workspace.getBlockById('extra').previousConnection);
    ScratchBlocks.Events.fireNow_();
    const dirty = f.dirty();
    const undo = f.workspace.undoStack_.slice();
    assert.throws(() => f.openTree(), error => error instanceof BlockEditorStructureError && error.code === 'limit');
    assert.equal(f.dirty(), dirty);
    assert.deepEqual(f.workspace.undoStack_, undo);
});

test('moves, deletions and project/target switches invalidate the entire real hierarchy', t => {
    for (const change of [
        f => {
            const child = f.workspace.getBlockById('grand');
            child.previousConnection.disconnect();
            f.workspace.getBlockById('right').nextConnection.connect(child.previousConnection);
            ScratchBlocks.Events.fireNow_();
        },
        f => { f.workspace.getBlockById('grand').dispose(); ScratchBlocks.Events.fireNow_(); },
        f => { f.vm.editingTarget = null; f.vm.emit('targetsUpdate'); },
        f => { f.vm.emit('workspaceUpdate'); }
    ]) {
        const f = hierarchyFixture(t);
        const session = f.openTree();
        edit(session, 'first', '{"uncommitted":true}');
        change(f);
        assert.equal(session.getState().status, 'invalidated');
        assert.equal(f.value('first'), '{}');
    }
});

test('a real sb3 ZIP round-trip retains all committed values and connections without editor metadata', async t => {
    const VM = require('scratch-vm');
    const Storage = require('@turbowarp/scratch-storage');
    const JSZip = require('@turbowarp/jszip');
    const f = hierarchyFixture(t);
    const storage = new Storage();
    f.vm.attachStorage(storage);
    f.target.sprite.name = 'Stage';
    const asset = storage.createAsset(storage.AssetType.ImageVector, storage.DataFormat.SVG,
        new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'), null, true);
    f.target.sprite.costumes.push({name: 'blank', asset, assetId: asset.assetId, dataFormat: 'svg',
        md5: `${asset.assetId}.svg`, rotationCenterX: 0, rotationCenterY: 0, bitmapResolution: 1});
    f.target.currentCostume = 0;
    const session = f.openTree();
    const properties = '{"label":"再読込「春」 & \\"value\\"","amount":7}';
    edit(session, 'scene', properties, '親');
    edit(session, 'grand', '{"label":"孫","amount":9}', '孫');
    assert.equal((await session.save()).status, 'saved');
    const saved = await f.vm.saveProjectSb3('nodebuffer');
    const zip = await JSZip.loadAsync(saved);
    const project = JSON.parse(await zip.file('project.json').async('string'));
    assert.equal(Object.hasOwn(project, 'generation'), false);
    for (const target of project.targets) {
        for (const block of Object.values(target.blocks)) {
            if (!block || Array.isArray(block)) continue;
            for (const key of ['draft', 'generation', 'schema', 'inputPath', 'revision']) {
                assert.equal(Object.hasOwn(block as object, key), false);
            }
        }
    }
    class Story {
        getInfo() {
            return {id: 'story', name: 'Test tree', blocks: [
                {opcode: 'group', blockType: 'conditional', branchCount: 2,
                    text: 'group [PROPERTIES] [NAME] [CHECK]', arguments: {
                        PROPERTIES: {type: 'string'}, NAME: {type: 'string'}, CHECK: {type: 'Boolean'}
                    }},
                {opcode: 'scene', blockType: 'command', text: 'item [PROPERTIES] [NAME]',
                    arguments: {PROPERTIES: {type: 'string'}, NAME: {type: 'string'}}}
            ]};
        }
        group() {}
        scene() {}
    }
    const reloaded = new VM();
    reloaded.attachStorage(new Storage());
    reloaded.extensionManager.addBuiltinExtension('story', Story);
    t.after(() => reloaded.quit());
    await reloaded.loadProject(saved);
    const target = reloaded.runtime.targets.find(value => value.isStage);
    const root = target.blocks.getScripts().map(id => target.blocks.getBlock(id))
        .find(block => block.opcode === 'story_group');
    const first = target.blocks.getBlock(root.inputs.BODY.block);
    const middle = target.blocks.getBlock(first.next);
    const grand = target.blocks.getBlock(middle.inputs.SUBSTACK.block);
    const value = block => target.blocks.getBlock(block.inputs.PROPERTIES.block).fields.TEXT.value;
    assert.equal(value(root), properties);
    assert.equal(value(grand), '{"label":"孫","amount":9}');
    const outside = target.blocks.getBlock(root.next);
    assert.equal(target.blocks.getBlock(outside.inputs.NAME.block).fields.TEXT.value, 'outside');
    assert.equal(target.blocks.getBlock(root.inputs.CHECK.block).opcode, 'operator_equals');
    assert.equal(grand.parent, middle.id);
});
