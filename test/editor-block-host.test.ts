// SPDX-License-Identifier: GPL-3.0-or-later
// From turbowarp-plus-editor/test/block-editor/host.test.ts at e954848.
// The original test license is retained; see LICENSE.GPL-3.0 in this directory.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {BlockEditorConflictError} from '@kubohiroya/turbowarp-extension-data-editor';
import {fixture, ScratchBlocks} from './fixtures/editor-block-host.ts';

test('opening, drafting and cancelling do not change the real workspace, VM, dirty or history', t => {
    const f = fixture(t);
    const s = f.open();
    assert.ok(s);
    s.setDraft({properties: '{"duration":2}', name: 'closing'});
    s.cancel();
    assert.equal(f.field('props').getValue(), '{}');
    assert.equal(f.vmValue('props'), '{}');
    assert.equal(f.dirty(), 0);
    assert.equal(f.workspace.undoStack_.length, 0);
});

test('saving real text shadows updates VM synchronously and supports one-step Undo/Redo', async t => {
    const f = fixture(t);
    const s = f.open();
    s.setDraft({properties: '{"duration":2}', name: 'closing'});
    assert.equal((await s.save()).status, 'saved');
    assert.equal(f.vmValue('props'), '{"duration":2}');
    assert.equal(f.vmValue('name'), 'closing');
    assert.equal(f.dirty(), 1);
    assert.equal(f.workspace.undoStack_.length, 2);
    assert.equal(f.workspace.undoStack_[0].group, f.workspace.undoStack_[1].group);
    assert.ok(f.workspace.undoStack_[0].group);
    f.workspace.undo(false);
    ScratchBlocks.Events.fireNow_();
    assert.equal(f.field('props').getValue(), '{}');
    assert.equal(f.vmValue('props'), '{}');
    assert.equal(f.vmValue('name'), 'opening');
    f.workspace.undo(true);
    ScratchBlocks.Events.fireNow_();
    assert.equal(f.vmValue('props'), '{"duration":2}');
    assert.equal(f.vmValue('name'), 'closing');
});

test('an unchanged save does not dirty the project or clear existing redo history', async t => {
    const f = fixture(t);
    f.field('name').setValue('changed');
    ScratchBlocks.Events.fireNow_();
    f.workspace.undo(false);
    ScratchBlocks.Events.fireNow_();
    const redo = [...f.workspace.redoStack_];
    const dirty = f.dirty();
    const result = await f.open().save();
    assert.equal(result.status, 'saved');
    assert.equal(result.changed, false);
    assert.deepEqual(Array.from(f.workspace.redoStack_), redo);
    assert.equal(f.dirty(), dirty);
});

test('a setter failure after partial UI mutation restores fields without VM/dirty/history changes', async t => {
    const f = fixture(t);
    const field = f.field('name');
    const setValue = field.setValue;
    field.setValue = function (value) {
        setValue.call(this, value);
        if (value === 'closing') throw new Error('Injected field failure');
    };
    const s = f.open();
    s.setDraft({properties: '{"duration":2}', name: 'closing'});
    assert.equal((await s.save()).status, 'failed');
    ScratchBlocks.Events.fireNow_();
    assert.equal(f.field('props').getValue(), '{}');
    assert.equal(f.field('name').getValue(), 'opening');
    assert.equal(f.vmValue('props'), '{}');
    assert.equal(f.vmValue('name'), 'opening');
    assert.equal(f.dirty(), 0);
    assert.equal(f.workspace.undoStack_.length, 0);
    assert.equal(s.getDraft().name, 'closing');
    assert.equal(ScratchBlocks.Events.isEnabled(), true);
    assert.equal(ScratchBlocks.Events.getGroup(), '');
});

test('a listener failure after VM mutation restores VM, fields, dirty, undo and redo', async t => {
    const f = fixture(t);
    f.field('name').setValue('temporary');
    ScratchBlocks.Events.fireNow_();
    f.workspace.undo(false);
    ScratchBlocks.Events.fireNow_();
    const beforeUndo = [...f.workspace.undoStack_];
    const beforeRedo = [...f.workspace.redoStack_];
    const dirty = f.dirty();
    const s = f.open();
    f.workspace.addChangeListener(event => {
        if (event.type === 'change' && event.newValue === 'closing') throw new Error('Injected listener failure');
    });
    s.setDraft({properties: '{"duration":2}', name: 'closing'});
    assert.equal((await s.save()).status, 'failed');
    ScratchBlocks.Events.fireNow_();
    assert.equal(f.field('props').getValue(), '{}');
    assert.equal(f.vmValue('props'), '{}');
    assert.equal(f.vmValue('name'), 'opening');
    assert.equal(f.dirty(), dirty);
    assert.deepEqual(Array.from(f.workspace.undoStack_), beforeUndo);
    assert.deepEqual(Array.from(f.workspace.redoStack_), beforeRedo);
});

test('connected reporters are identified and never overwritten', async t => {
    const f = fixture(t);
    const input = f.block.getInput('PROPERTIES');
    input.connection.disconnect();
    const reporter = f.workspace.newBlock('operator_join');
    input.connection.connect(reporter.outputConnection);
    ScratchBlocks.Events.fireNow_();
    const snapshot = f.host.readBlock(f.reference);
    assert.deepEqual(snapshot.arguments.PROPERTIES, {kind: 'reporter'});
    assert.throws(() => f.host.commit({expected: snapshot, changes: [
        {argument: 'PROPERTIES', value: 'replacement'}
    ]}), TypeError);
    assert.equal(input.connection.targetBlock(), reporter);
});

test('deletion, target switching, refresh and stale values invalidate the opening snapshot', t => {
    const f = fixture(t);
    const snapshot = f.host.readBlock(f.reference);
    f.host.invalidate();
    assert.throws(() => f.host.commit({expected: snapshot, changes: []}), BlockEditorConflictError);
    f.vm.editingTarget = null;
    assert.equal(f.host.readBlock(f.reference), null);
    f.vm.editingTarget = f.target;
    f.block.dispose();
    ScratchBlocks.Events.fireNow_();
    assert.equal(f.host.readBlock(f.reference), null);
});

test('pending Blockly events and custom validators are not accepted as editable snapshots', t => {
    const f = fixture(t);
    f.field('props').setValue('{"pending":true}');
    assert.equal(f.host.readBlock(f.reference), null);
    ScratchBlocks.Events.fireNow_();
    f.field('props').setValidator(value => value);
    assert.deepEqual(f.host.readBlock(f.reference).arguments.PROPERTIES, {kind: 'reporter'});
});

test('workspace busy, duplicate or invalid changes fail before mutation', t => {
    const f = fixture(t);
    const expected = f.host.readBlock(f.reference);
    for (const changes of [
        [{argument: 'MISSING', value: 'x'}],
        [{argument: 'NAME', value: 1}],
        [{argument: 'NAME', value: 'one'}, {argument: 'NAME', value: 'two'}]
    ]) assert.throws(() => f.host.commit({expected, changes}), TypeError);
    ScratchBlocks.Events.setGroup('external');
    try {
        assert.throws(() => f.host.commit({expected, changes: [{argument: 'NAME', value: 'closing'}]}), /busy/);
    } finally { ScratchBlocks.Events.setGroup(false); }
    assert.equal(f.vmValue('name'), 'opening');
    assert.equal(f.dirty(), 0);
});

test('disposing the host blocks late commits and removes lifecycle listeners', t => {
    const f = fixture(t);
    const expected = f.host.readBlock(f.reference);
    const before = f.vm.listenerCount('workspaceUpdate');
    f.host.dispose();
    assert.equal(f.vm.listenerCount('workspaceUpdate'), before - 1);
    assert.throws(() => f.host.commit({expected, changes: []}), BlockEditorConflictError);
});
