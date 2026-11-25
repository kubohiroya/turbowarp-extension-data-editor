// SPDX-License-Identifier: GPL-3.0-or-later
// From turbowarp-plus-editor/test/block-editor/source-host.test.ts at e954848.
// The original test license is retained; see LICENSE.GPL-3.0 in this directory.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fixture, ScratchBlocks} from './fixtures/editor-block-host.ts';
Object.defineProperty(globalThis, 'MessageChannel', {value: undefined, configurable: true});
const {createSourceEditor} = await import('@kubohiroya/turbowarp-extension-data-editor/rjsf');
import {jsonValueSchemaBundle} from '@kubohiroya/turbowarp-extension-data-editor/schema';

const definition = () => createSourceEditor({apiVersion: 1, extensionId: 'story', editorId: 'source', opcodes: ['story_scene'],
    validationContext: () => ({consumerId: 'gui-test', nowMs: 0, settings: null}),
    bindings: ['PROPERTIES', 'NAME'].map(argument => ({argument,
        variants: [{variantId: 'json', format: 'json', schemaBundle: jsonValueSchemaBundle}],
        decode: source => ({source, format: 'json', variantId: 'json', data: JSON.parse(source)}),
        validateSource: source => {
            try {JSON.parse(source);return {source, result: {kind: 'valid', diagnostics: []}};}
            catch {return {source, result: {kind: 'invalid', diagnostics: [{code: 'input-format-invalid'}]}};}
        }
    }))});
type SourceDraft = import('@kubohiroya/turbowarp-extension-data-editor').JsonObject & {
    sources: {
        PROPERTIES: {data: {x: number}};
        NAME: {data: string} | {mode: string; source: string; sourceEdited: boolean};
    };
};

function sourceDraft(session: NonNullable<ReturnType<ReturnType<typeof fixture>['open']>>) {
    return session.getDraft() as SourceDraft;
}

const xmlText = '<xml><block type="story_scene" id="scene">' +
    '<value name="PROPERTIES"><shadow type="text" id="props"><field name="TEXT"> { "x": 1 } </field></shadow></value>' +
    '<value name="NAME"><shadow type="text" id="name"><field name="TEXT">"opening"</field></shadow></value>' +
    '</block></xml>';

test('prepared multi-source save synchronizes Blockly/VM in one undo and redo transaction', async t => {
    const f = fixture(t, {definition: definition(), xmlText});
    const session = f.open();const draft = sourceDraft(session);
    draft.sources.PROPERTIES.data.x = 2;Object.assign(draft.sources.NAME, {data: 'updated'});session.setDraft(draft);
    assert.equal((await session.save()).status, 'saved');ScratchBlocks.Events.fireNow_();
    assert.equal(f.field('props').getValue(), ' { "x": 2 } ');assert.equal(f.vmValue('props'), ' { "x": 2 } ');
    assert.equal(f.field('name').getValue(), '"updated"');assert.equal(f.vmValue('name'), '"updated"');
    f.workspace.undo(false);ScratchBlocks.Events.fireNow_();
    assert.equal(f.field('props').getValue(), ' { "x": 1 } ');assert.equal(f.vmValue('props'), ' { "x": 1 } ');
    assert.equal(f.field('name').getValue(), '"opening"');assert.equal(f.vmValue('name'), '"opening"');
    f.workspace.undo(true);ScratchBlocks.Events.fireNow_();
    assert.equal(f.field('props').getValue(), ' { "x": 2 } ');assert.equal(f.field('name').getValue(), '"updated"');
});

test('invalid second source rejects the entire Blockly/VM transaction; Cancel remains local', async t => {
    const f = fixture(t, {definition: definition(), xmlText});const session = f.open();const draft = sourceDraft(session);
    draft.sources.PROPERTIES.data.x = 3;draft.sources.NAME = {mode: 'source', source: '{invalid', sourceEdited: true};session.setDraft(draft);
    assert.equal((await session.save()).status, 'invalid');ScratchBlocks.Events.fireNow_();
    assert.equal(f.field('props').getValue(), ' { "x": 1 } ');assert.equal(f.vmValue('props'), ' { "x": 1 } ');
    assert.equal(f.workspace.undoStack_.length, 0);assert.equal(f.dirty(), 0);
    assert.equal(session.cancel(), true);assert.equal(f.vmValue('name'), '"opening"');
});

test('no-op prepared save preserves exact source and existing undo history', async t => {
    const f = fixture(t, {definition: definition(), xmlText});const session = f.open();
    assert.deepEqual(await session.save(), {status: 'saved', changed: false});
    assert.equal(f.workspace.undoStack_.length, 0);assert.equal(f.dirty(), 0);
    assert.equal(f.field('props').getValue(), ' { "x": 1 } ');
});

test('prepared field failure after partial mutation restores both sources and history', async t => {
    const f=fixture(t,{definition:definition(),xmlText});
    const field=f.field('name');const setValue=field.setValue;
    field.setValue=function(value){setValue.call(this,value);if(value==='"updated"')throw new Error('Injected prepared setter failure');};
    const session=f.open();const draft=sourceDraft(session);draft.sources.PROPERTIES.data.x=2;Object.assign(draft.sources.NAME, {data: 'updated'});session.setDraft(draft);
    assert.equal((await session.save()).status,'failed');ScratchBlocks.Events.fireNow_();
    assert.equal(f.field('props').getValue(),' { "x": 1 } ');assert.equal(f.vmValue('props'),' { "x": 1 } ');
    assert.equal(f.field('name').getValue(),'"opening"');assert.equal(f.vmValue('name'),'"opening"');
    assert.equal(f.workspace.undoStack_.length,0);assert.equal(f.dirty(),0);
    assert.equal(sourceDraft(session).sources.PROPERTIES.data.x,2);
});

test('prepared listener failure restores VM, fields, dirty and undo before retry', async t => {
    const f=fixture(t,{definition:definition(),xmlText});
    const listener=event=>{if(event.type==='change'&&event.newValue==='"updated"')throw new Error('Injected prepared listener failure');};
    f.workspace.addChangeListener(listener);
    const session=f.open();const draft=sourceDraft(session);draft.sources.PROPERTIES.data.x=2;Object.assign(draft.sources.NAME, {data: 'updated'});session.setDraft(draft);
    assert.equal((await session.save()).status,'failed');ScratchBlocks.Events.fireNow_();
    assert.equal(f.field('props').getValue(),' { "x": 1 } ');assert.equal(f.vmValue('props'),' { "x": 1 } ');
    assert.equal(f.field('name').getValue(),'"opening"');assert.equal(f.vmValue('name'),'"opening"');
    assert.equal(f.workspace.undoStack_.length,0);assert.equal(f.dirty(),0);
    f.workspace.removeChangeListener(listener);assert.equal((await session.save()).status,'saved');
});
