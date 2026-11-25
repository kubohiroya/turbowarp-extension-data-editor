// SPDX-License-Identifier: GPL-3.0-or-later
// From turbowarp-plus-editor/test/block-editor/helpers.ts at e954848.
// The original test license is retained; see ../LICENSE.GPL-3.0.
/**
 * The fixtures these tests share.
 *
 * Moved from the fork's `test/unit/block-editor/helpers.mjs`. The package under test is this
 * package's. The real VM and ScratchBlocks artifacts are pinned test dependencies, so no GUI
 * checkout is needed. Their revisions are recorded in package.json and pnpm-lock.yaml.
 */

import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {after, type TestContext} from 'node:test';
import {createRequire} from 'node:module';
import type {EditorDefinition, PreparedEditorDefinition} from '@kubohiroya/turbowarp-extension-data-editor';
import {EditorRegistry} from '@kubohiroya/turbowarp-extension-data-editor';
import {createTurboWarpBlockEditorHost as createBlockEditorHost} from '@kubohiroya/turbowarp-extension-data-editor/turbowarp';

export const hostRequire = createRequire(import.meta.url);

import {JSDOM} from 'jsdom';

export const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/', runScripts: 'outside-only'
});
for (const name of ['window', 'document', 'DOMParser', 'XMLSerializer', 'Element', 'Node', 'navigator']) {
    Object.defineProperty(globalThis, name, {value: dom.window[name], configurable: true});
}
// A JSDOM window must not make JSZip select a browser MessageChannel in Node.
// Its Node scheduling path uses setImmediate and leaves no referenced port behind.
Object.defineProperty(globalThis, 'MessageChannel', {value: undefined, configurable: true});
const require = hostRequire;
const root = pathToFileURL(path.dirname(require.resolve('scratch-blocks/package.json')) + path.sep);
// Load the pinned browser artifacts consumed by scratch-gui's webpack shim.
const code = [
    'blockly_compressed_vertical.js', 'blocks_compressed.js', 'blocks_compressed_vertical.js',
    'msg/messages.js', 'msg/scratch_msgs.js'
].map(name => fs.readFileSync(new URL(name, root), 'utf8')).join('\n');
export const ScratchBlocks = new dom.window.Function(`${code}\nreturn Blockly;`).call(dom.window);
ScratchBlocks.ScratchMsgs.setLocale('en');
const VM = require('scratch-vm');
const Sprite = require('scratch-vm/src/sprites/sprite');

function fixtureText(slot: import('@kubohiroya/turbowarp-extension-data-editor').ArgumentSlot) {
    if (slot.kind !== 'literal') throw new TypeError('Expected a literal argument in the fixture');
    return slot.value;
}

export const makeDefinition = (overrides: Partial<EditorDefinition> = {}): EditorDefinition => ({
    apiVersion: 1, extensionId: 'story', editorId: 'properties', opcodes: ['story_scene'],
    editableArguments: ['PROPERTIES', 'NAME'],
    read: snapshot => ({properties: fixtureText(snapshot.arguments.PROPERTIES), name: fixtureText(snapshot.arguments.NAME)}),
    validate: () => [],
    createPatch: draft => [
        {argument: 'PROPERTIES', value: draft.properties as string}, {argument: 'NAME', value: draft.name as string}
    ],
    mount: () => () => {},
    ...overrides
});

ScratchBlocks.Blocks.story_scene = {
    init() {
        this.jsonInit({
            message0: '%1 scene %2 name %3',
            args0: [
                {type: 'field_image', src: 'data:image/svg+xml,<svg/>', width: 40, height: 40},
                {type: 'input_value', name: 'PROPERTIES'}, {type: 'input_value', name: 'NAME'}
            ],
            inputsInline: true,
            previousStatement: null, nextStatement: null, colour: '#087f8c'
        });
    }
};

export function fixture(t: TestContext, {definition = makeDefinition(), registry = new EditorRegistry(), xmlText,
    enableDescendants = false}: {
    definition?: EditorDefinition | PreparedEditorDefinition;
    registry?: EditorRegistry;
    xmlText?: string;
    enableDescendants?: boolean;
} = {}) {
    const unregisterDefinition = 'saveContract' in definition && definition.saveContract === 'prepared-source-v1'
        ? registry.registerPrepared(definition) : registry.register(definition);
    const workspace = new ScratchBlocks.Workspace();
    // Headless workspaces have no procedure-return renderer to update.
    workspace.procedureReturnsWillChange = () => {};
    const vm = new VM();
    const target = new Sprite(null, vm.runtime).createClone();
    target.isStage = true;
    vm.runtime.targets.push(target);
    vm.setEditingTarget(target.id);
    workspace.addChangeListener(vm.blockListener);
    const xml = ScratchBlocks.Xml.textToDom(xmlText || '<xml><block type="story_scene" id="scene">' +
        '<value name="PROPERTIES"><shadow type="text" id="props"><field name="TEXT">{}</field></shadow></value>' +
        '<value name="NAME"><shadow type="text" id="name"><field name="TEXT">opening</field></shadow></value>' +
        '</block></xml>');
    ScratchBlocks.Xml.domToWorkspace(xml, workspace);
    ScratchBlocks.Events.fireNow_();
    workspace.clearUndo();
    let dirty = 0;
    vm.on('PROJECT_CHANGED', () => { dirty++; });
    const host = createBlockEditorHost({ScratchBlocks, workspace, vm, registry, enableDescendants});
    const reference = {targetId: target.id, blockId: 'scene'};
    const block = workspace.getBlockById('scene');
    t.after(() => {
        host.dispose();
        workspace.removeChangeListener(vm.blockListener);
        workspace.dispose();
        ScratchBlocks.Events.fireNow_();
        vm.quit();
    });
    return {
        host, reference, registry, workspace, vm, target, block, unregisterDefinition,
        open: () => registry.open(reference, host),
        dirty: () => dirty,
        field: id => workspace.getBlockById(id).getField('TEXT'),
        vmValue: id => target.blocks.getBlock(id).fields.TEXT.value
    };
}

after(() => dom.window.close());
