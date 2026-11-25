// SPDX-License-Identifier: GPL-3.0-or-later
// From turbowarp-plus-editor/test/block-editor/bridge.test.ts at e954848.
// The original test license is retained; see LICENSE.GPL-3.0 in this directory.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {attachTurboWarpBlockEditors as createBlockEditorBridge, openBlockEditorSession}
    from '@kubohiroya/turbowarp-extension-data-editor/turbowarp';
import {BlockEditorStructureError} from '@kubohiroya/turbowarp-extension-data-editor';
import {fixture, makeDefinition, ScratchBlocks, dom} from './fixtures/editor-block-host.ts';



function bridgeFixture(t, overrides = {}, descendants = false) {
    t.mock.method(ScratchBlocks, 'hideChaff', () => {});
    const f = fixture(t, {definition: makeDefinition(overrides)});
    const listeners = new Set<() => void>();
    const service = {registry: f.registry, subscribe: fn => {
        listeners.add(fn);
        return () => listeners.delete(fn);
    }};
    const field = f.block.inputList[0].fieldRow[0];
    field.fieldGroup_ = dom.window.document.createElement('div');
    field.imageElement_ = {};
    field.setTooltip = value => { field.imageElement_.tooltip = value; };
    dom.window.document.body.appendChild(field.fieldGroup_);
    let session;
    let appearances;
    let nodeLabels;
    const bridge = createBlockEditorBridge({enabled: true, ScratchBlocks, workspace: f.workspace, vm: f.vm,
        descendants,
        service, label: 'Edit', canOpen: () => true, onOpen: (value, labels, metadata) => {
            session = value;
            appearances = metadata;
            nodeLabels = labels;
        },
        onError: error => { throw error; }});
    const element = field.fieldGroup_;
    t.after(() => { bridge.dispose(); element.remove(); });
    return {...f, bridge, field, session: () => session, appearances: () => appearances, labels: () => nodeLabels,
        openIcon: () => field.fieldGroup_.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
            key: 'Enter', bubbles: true, cancelable: true
        })),
        unregister: () => { for (const listener of listeners) listener(); }};
}

test('read-only workspaces remove editor decorations and restore original attributes', t => {
    const f = bridgeFixture(t);
    assert.equal(f.field.fieldGroup_.getAttribute('role'), 'button');
    f.workspace.options.readOnly = true;
    f.bridge.refresh();
    assert.equal(f.field.fieldGroup_.hasAttribute('data-block-editor-icon'), false);
    f.workspace.options.readOnly = false;
    f.bridge.refresh();
    assert.equal(f.field.fieldGroup_.hasAttribute('data-block-editor-icon'), true);
});

test('target switch invalidates the open draft and releases its view', t => {
    const f = bridgeFixture(t);
    f.openIcon();
    const session = f.session();
    assert.ok(session);
    f.vm.editingTarget = null;
    f.vm.emit('targetsUpdate');
    assert.equal(session.getState().status, 'disposed');
    assert.equal(f.dirty(), 0);
});

test('registration invalidation while validation is pending closes after rejection and never commits', async t => {
    let release;
    const f = bridgeFixture(t, {validate: () => new Promise(resolve => { release = resolve; })});
    f.openIcon();
    const session = f.session();
    session.setDraft({properties: 'changed', name: 'changed'});
    const saving = session.save();
    f.unregister();
    release([]);
    assert.equal((await saving).status, 'conflict');
    assert.equal(session.getState().status, 'disposed');
    assert.equal(f.vmValue('props'), '{}');
    assert.equal(f.dirty(), 0);
    assert.equal(f.workspace.undoStack_.length, 0);
});

test('the bridge retains the draft after a host transaction rolls back', async t => {
    const f = bridgeFixture(t);
    f.openIcon();
    const session = f.session();
    const field = f.workspace.getBlockById('name').getField('TEXT');
    const setter = field.setValue;
    field.setValue = function (value) {
        setter.call(this, value);
        if (value === 'closing') throw new Error('Injected setter failure');
    };
    session.setDraft({properties: '{"duration":2}', name: 'closing'});
    assert.equal((await session.save()).status, 'failed');
    assert.equal(session.getState().status, 'editing');
    assert.equal(session.getDraft().name, 'closing');
    assert.equal(f.vmValue('name'), 'opening');
    assert.equal(f.dirty(), 0);
    assert.equal(f.workspace.undoStack_.length, 0);
});

test('the enabled bridge opens the aggregate API and unregister aborts pending validation immediately', async t => {
    let release;
    const f = bridgeFixture(t, {validate: () => new Promise(resolve => { release = resolve; })}, true);
    f.openIcon();
    const session = f.session();
    assert.equal(typeof session.getNodes, 'function');
    assert.equal(session.getNodes().length, 1);
    session.getEditor('scene').setDraft({properties: '{"draft":1}', name: 'draft'});
    const saving = session.save();
    f.unregisterDefinition();
    assert.deepEqual(await saving, {status: 'invalidated'});
    release([]);
    await Promise.resolve();
    assert.equal(f.vmValue('props'), '{}');
    assert.equal(f.dirty(), 0);
});

test('the bridge passes block presentation data outside the aggregate snapshot and draft', t => {
    const f = bridgeFixture(t, {}, true);
    f.openIcon();
    assert.equal(f.appearances().scene.iconURI, f.field.getValue());
    assert.equal(f.appearances().scene.colour, f.block.getColour());
    assert.equal(f.labels().scene, 'scene name');
    assert.equal(f.appearances().scene.name, 'scene name');
    const nodes = f.session().getNodes();
    assert.equal(nodes[0].iconURI, undefined);
    assert.equal(nodes[0].colour, undefined);
    assert.deepEqual(f.session().getEditor('scene').getDraft(), {properties: '{}', name: 'opening'});
    assert.equal(f.dirty(), 0);
});

test('flag OFF or an unsupported host uses single editing; supported hierarchy errors never fall back', () => {
    let singles = 0;
    let aggregates = 0;
    // Stub only the entry points used by this selection test.
    const registry = {open: () => { singles++; return 'single'; },
        openDescendants: () => { aggregates++; throw new BlockEditorStructureError('Invalid tree', 'cycle'); }} as unknown as Parameters<typeof openBlockEditorSession>[0]['registry'];
    const host: import('@kubohiroya/turbowarp-extension-data-editor').BlockEditorHost = {
        readBlock: () => null,
        commit: () => assert.fail('Unexpected commit')
    };
    const reference = {targetId: 'target', blockId: 'block'};
    assert.equal(openBlockEditorSession({registry, host, reference, descendants: true}), 'single');
    Object.assign(host, {descendants: {capability: 'descendant-editing-v1', readSubtree: () => null,
        commitSubtree: () => assert.fail('Unexpected subtree commit')}});
    assert.equal(openBlockEditorSession({registry, host, reference, descendants: false}), 'single');
    assert.throws(() => openBlockEditorSession({registry, host, reference, descendants: true}), BlockEditorStructureError);
    assert.equal(singles, 2);
    assert.equal(aggregates, 1);
});

test('the public attachment disposes once, removes its listeners and restores its icon', t => {
    const f = bridgeFixture(t);
    const workspaceListeners = f.vm.listeners('workspaceUpdate').length;
    const targetListeners = f.vm.listeners('targetsUpdate').length;
    f.openIcon();
    assert.equal(f.session().getState().status, 'editing');
    f.bridge.dispose();
    assert.equal(f.session().getState().status, 'disposed');
    assert.equal(f.field.fieldGroup_.hasAttribute('data-block-editor-icon'), false);
    assert.equal(f.vm.listeners('workspaceUpdate').length, workspaceListeners - 2);
    assert.equal(f.vm.listeners('targetsUpdate').length, targetListeners - 2);
    f.bridge.dispose();
    f.bridge.refresh();
    assert.equal(f.field.fieldGroup_.hasAttribute('data-block-editor-icon'), false);
    assert.equal(f.vm.listeners('workspaceUpdate').length, workspaceListeners - 2);
    assert.equal(f.vm.listeners('targetsUpdate').length, targetListeners - 2);
});

test('disposing one public attachment leaves another workspace usable', t => {
    const first = bridgeFixture(t);
    const second = bridgeFixture(t);
    first.bridge.dispose();
    assert.equal(first.field.fieldGroup_.hasAttribute('data-block-editor-icon'), false);
    assert.equal(second.field.fieldGroup_.hasAttribute('data-block-editor-icon'), true);
    second.openIcon();
    assert.equal(second.session().getState().status, 'editing');
    assert.equal(second.session().reference.targetId, second.target.id);
});
