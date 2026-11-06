import assert from 'node:assert/strict';
import {test} from 'node:test';
import {nativeAvailable, nativeFixture} from './fixtures/fixed-host-native.ts';
import {createBlockEditorService} from '../dist/rjsf.js';
import {createTurboWarpBlockEditorHost} from '../dist/turbowarp.js';

const nativeTest = (name, fn) => test(name, {skip: nativeAvailable ? false : 'Supply BLOCK_EDITOR_GUI_ROOT for actual host entry integration.'}, fn);

for (const method of ['getValue', 'getValidator']) {
    nativeTest(`service registry open rejects custom ${method} accessors without running legacy TEXT reads`, t => {
        const f = nativeFixture(); t.after(() => f.close());
        const service = createBlockEditorService({fixedInputs: true});
        const remove = service.registry.registerFixed(f.definition); t.after(remove);
        const host = createTurboWarpBlockEditorHost({ScratchBlocks: f.B, workspace: f.workspace, vm: f.vm,
            registry: service.registry, enableFixedInputs: true}); t.after(() => host.dispose());
        const field = f.workspace.getBlockById('native-text').getField('TEXT'); let calls = 0;
        Object.defineProperty(field, method, {configurable: true, get() {calls++; throw new Error('Unknown native field accessor executed.');}});
        try {
            const session = service.registry.open(f.reference, host);
            assert.ok(session); assert.deepEqual(session.getDraft().inputs.TEXT, {readOnly: true});
            assert.equal(calls, 0); session.dispose();
        } finally {delete field[method];}
    });
}

nativeTest('fixed registration with a legacy-only host does not execute custom field getters', t => {
    const f = nativeFixture({enableFixedInputs: false}); t.after(() => f.close());
    const field = f.workspace.getBlockById('native-text').getField('TEXT'); let calls = 0;
    Object.defineProperty(field, 'getValue', {configurable: true, get() {calls++; throw new Error('Unknown getter executed.');}});
    try {
        assert.equal(f.registry.open(f.reference, f.host), undefined); assert.equal(calls, 0);
    } finally {delete field.getValue;}
});

nativeTest('fixed descendants and legacy commit fail closed before custom field callbacks', t => {
    const f = nativeFixture(); t.after(() => f.close());
    const expected = f.read();
    const host = createTurboWarpBlockEditorHost({ScratchBlocks: f.B, workspace: f.workspace, vm: f.vm,
        registry: f.registry, enableFixedInputs: true, enableDescendants: true}); t.after(() => host.dispose());
    const field = f.workspace.getBlockById('native-text').getField('TEXT'); let calls = 0;
    Object.defineProperty(field, 'getValue', {configurable: true, get() {calls++; throw new Error('Unknown getter executed.');}});
    try {
        assert.equal(f.registry.openDescendants(f.reference, host), undefined);
        assert.throws(() => host.commit({expected, changes: [{argument: 'TEXT', value: 'forged'}]}));
        assert.equal(calls, 0); assert.equal(f.vmValue('TEXT'), 'old'); assert.equal(f.dirty(), 0);
    } finally {delete field.getValue;}
});
