import type {TurboWarpHostOptions, TurboWarpBlockEditorHost} from '../turbowarp.js';
import type {BlockReference} from '../types.js';
import type {DescendantEditorHost, SubtreeArgumentChange, SubtreeSnapshot} from '../descendant-types.js';
import type {FixedInputEditorHost} from '../fixed-input-types.js';
import type {BlockRecord, NativeChange, NativeScratchBlocks, NativeWorkspace, NativeVM, TextBinding} from './native-types.js';
import {BlockEditorConflictError, DESCENDANT_EDITING_CAPABILITY} from '../index.js';
import collectBlockEditorSubtree from './subtree.js';
import createFixedInputPort from './fixed-transaction.js';

const owns = (object: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(object, key);

// Adapt only standard, unvalidated text shadows; never evaluate connected reporters.
const createBlockEditorHost = ({ScratchBlocks: nativeBlocks, workspace: nativeWorkspace, vm: nativeVM, registry,
    enableDescendants = false, enableFixedInputs = false, onError = console.error}: TurboWarpHostOptions): TurboWarpBlockEditorHost => {
    const ScratchBlocks = nativeBlocks as NativeScratchBlocks;
    const workspace = nativeWorkspace as NativeWorkspace;
    const vm = nativeVM as NativeVM;
    let disposed = false;
    let committing = false;
    let revision = 0;
    let identity = 0;
    let generation = 1;
    let externalRevision = 0;
    let fixedTransaction: {events: WeakSet<NativeChange>; revisions: number; versions: Map<string, number>} | null = null;
    let lastTarget = vm.editingTarget;
    const versions = new Map<string, number>();
    const invalidations = new Set<{reference: BlockReference; listener: (reason?: unknown) => void; snapshot: SubtreeSnapshot}>();
    const fixedScopeListeners = new Set<() => void>();
    const notifyFixedScopes = () => {
        for (const listener of [...fixedScopeListeners]) {
            try { listener(); } catch (error) {
                try { onError(error); } catch { /* Scope observers cannot interrupt native events. */ }
            }
        }
    };
    let notifyInvalidations = () => {};
    const identities = new WeakMap<object, number>();
    const identify = (object: object): number => {
        if (!identities.has(object)) identities.set(object, ++identity);
        return identities.get(object)!;
    };
    const invalidate = (event?: NativeChange) => {
        if (event && event.isUiEvent) return;
        revision++;
        if (fixedTransaction && event && fixedTransaction.events.has(event)) {
            fixedTransaction.revisions++;
            if (enableDescendants) {
                for (const id of new Set([event.blockId, ...(event.ids || [])])) {
                    if (id) fixedTransaction.versions.set(id, (fixedTransaction.versions.get(id) || 0) + 1);
                }
            }
        } else externalRevision++;
        if (enableDescendants && event) {
            const ids = new Set([event.blockId, ...(event.ids || [])]);
            for (const id of ids) if (id) versions.set(id, (versions.get(id) || 0) + 1);
        }
        if (!committing) notifyInvalidations();
        notifyFixedScopes();
    };
    const renew = () => {
        generation++;
        versions.clear();
        invalidate();
    };
    const targetsChanged = () => {
        if (lastTarget === vm.editingTarget) invalidate();
        else {
            lastTarget = vm.editingTarget;
            renew();
        }
    };
    workspace.addChangeListener(invalidate);
    vm.on('workspaceUpdate', renew);
    vm.on('targetsUpdate', targetsChanged);

    const inspect = (reference: BlockReference, structural = false): BlockRecord | null => {
        const target = vm.editingTarget;
        if (disposed || !target || target.id !== reference.targetId || workspace.isFlyout ||
            workspace.options.readOnly || (workspace.isDragging && workspace.isDragging())) return null;
        const block = workspace.getBlockById(reference.blockId);
        if (!block || block.isInFlyout || block.isShadow()) return null;
        const descriptor = registry.resolve(block.type);
        if (typeof registry.resolveFixed === 'function' && registry.resolveFixed(block.type)) return null;
        const vmBlock = target.blocks.getBlock(block.id);
        if ((!structural && !descriptor) || (!block.isEditable() && (!structural || descriptor)) ||
            !vmBlock || vmBlock.opcode !== block.type) return null;
        const slots = {};
        const fields = new Map();
        const signature: unknown[] = [structural ? versions.get(block.id) || 0 : revision,
            identify(block), identify(vmBlock), identify(target)];
        if (structural) {
            if ((block.getParent() ? block.getParent()!.id : null) !== (vmBlock.parent || null)) return null;
            signature.push(block.isEditable(), vmBlock.fields, vmBlock.inputs, vmBlock.mutation || null);
            for (const input of block.inputList) {
                if (input.type !== ScratchBlocks.INPUT_VALUE) continue;
                const connected = input.connection && input.connection.targetBlock();
                const vmInput = vmBlock.inputs[input.name];
                if ((connected ? connected.id : null) !==
                    (vmInput && vmInput.block ? vmInput.block : null)) return null;
                if (!connected) continue;
                signature.push(input.name, connected.id, identify(connected), connected.type);
                if (!connected.isShadow()) continue;
                const vmShadow = target.blocks.getBlock(connected.id);
                if (!vmShadow) return null;
                for (const row of connected.inputList) {
                    for (const field of row.fieldRow) {
                        if (!field.name) continue;
                        const stored = vmShadow.fields[field.name];
                        if (!stored || String(field.getValue()) !== String(stored.id || stored.value)) return null;
                    }
                }
                signature.push(versions.get(connected.id) || 0, identify(vmShadow), vmShadow.fields);
            }
        }
        for (const name of descriptor ? descriptor.editableArguments : []) {
            const input = block.getInput(name);
            const shadow = input && input.connection && input.connection.targetBlock();
            const field = shadow && shadow.getField('TEXT');
            const vmShadow = shadow && target.blocks.getBlock(shadow.id);
            const vmInput = vmBlock.inputs && vmBlock.inputs[name];
            // Plain text is the only field family whose validation/side effects we support here.
            if (!shadow || !shadow.isShadow() || shadow.type !== 'text' || !field ||
                field.constructor !== ScratchBlocks.FieldTextInput || field.getValidator() ||
                !vmShadow || vmShadow.opcode !== 'text' || !vmShadow.fields.TEXT ||
                !vmInput || vmInput.block !== shadow.id || typeof field.getValue() !== 'string') {
                Object.defineProperty(slots, name, {value: {kind: 'reporter'}, enumerable: true});
                continue;
            }
            // Do not open or save against events which have not reached the VM yet.
            if (vmShadow.fields.TEXT.value !== field.getValue()) return null;
            Object.defineProperty(slots, name, {
                value: {kind: 'literal', value: field.getValue()}, enumerable: true
            });
            fields.set(name, {shadow, field, value: field.getValue()});
            signature.push(name, identify(shadow), identify(field), identify(vmShadow), shadow.id);
        }
        return {
            snapshot: {
                targetId: target.id,
                blockId: block.id,
                opcode: block.type,
                revision: JSON.stringify(signature),
                arguments: slots
            },
            fields,
            block,
            vmBlock
        };
    };

    const collect = (reference: BlockReference) => collectBlockEditorSubtree({ScratchBlocks, reference, inspect, generation});
    notifyInvalidations = () => {
        if (committing) return;
        for (const item of [...invalidations]) {
            let matches = false;
            try {
                const current = collect(item.reference);
                matches = current !== null && JSON.stringify(current.snapshot) === JSON.stringify(item.snapshot);
            } catch (error) {
                // A malformed replacement graph invalidates an already open session too.
            }
            if (!matches) item.listener(new BlockEditorConflictError('The block hierarchy changed.'));
        }
    };

    const apply = (prepared: Array<TextBinding & {next: string}>, signal?: AbortSignal) => {
        const Events = ScratchBlocks.Events;
        if (!Events.isEnabled() || !Events.recordUndo || Events.getGroup() ||
            !Array.isArray(workspace.undoStack_) || !Array.isArray(workspace.redoStack_)) {
            throw new Error('The workspace is busy or its undo API is unsupported.');
        }
        if (!prepared.length) return;

        const target = vm.editingTarget;
        const oldRevision = revision;
        const oldVersions = new Map(versions);
        const undo = workspace.undoStack_.slice();
        const redo = workspace.redoStack_.slice();
        const emitProjectChanged = vm.runtime.emitProjectChanged;
        let succeeded = false;
        // Hold dirty notifications until all synchronous field/VM updates have succeeded.
        vm.runtime.emitProjectChanged = () => {};
        Events.setGroup(true);
        Events.disable();
        committing = true;
        try {
            if (!target || (signal && signal.aborted)) throw new BlockEditorConflictError();
            for (const item of prepared) {
                item.field.setValue(item.next);
                if (item.field.getValue() !== item.next) throw new Error('The field rejected its value.');
            }
            // Deliver normal Change events synchronously: VM and undo state agree before resolving.
            for (const item of prepared) {
                workspace.fireChangeListener(new Events.Change(item.shadow, 'field', 'TEXT', item.value, item.next));
                if ((signal && signal.aborted) || vm.editingTarget !== target) throw new BlockEditorConflictError();
            }
            succeeded = true;
        } catch (error) {
            // No queued setter events exist because events were disabled throughout this section.
            for (const item of prepared) {
                ScratchBlocks.FieldTextInput.prototype.setValue.call(item.field, item.value);
                target!.blocks.blocklyListen(new Events.Change(item.shadow, 'field', 'TEXT', item.next, item.value));
            }
            workspace.undoStack_.splice(0, workspace.undoStack_.length, ...undo);
            workspace.redoStack_.splice(0, workspace.redoStack_.length, ...redo);
            revision = oldRevision;
            versions.clear();
            for (const [id, value] of oldVersions) versions.set(id, value);
            throw error;
        } finally {
            committing = false;
            Events.enable();
            Events.setGroup(false);
            vm.runtime.emitProjectChanged = emitProjectChanged;
        }
        if (succeeded) {
            // Observer exceptions must not misreport an already committed transaction as rejected.
            try {
                emitProjectChanged.call(vm.runtime);
            } catch (error) {
                onError(error);
            }
        }
    };

    const prepare = (changes: readonly SubtreeArgumentChange[], records: Map<string, BlockRecord>) => {
        if (!Array.isArray(changes)) throw new TypeError('Expected an argument patch array.');
        const seen = new Set();
        const fields = new Set();
        return changes.map(change => {
            const record = change && records.get(change.blockId);
            const key = change && JSON.stringify([change.blockId, change.argument]);
            if (!record || typeof change.value !== 'string' || seen.has(key) ||
                !owns(record.snapshot.arguments, change.argument) || !record.fields.has(change.argument)) {
                throw new TypeError('Only distinct standard text shadow changes are supported.');
            }
            seen.add(key);
            const item = record.fields.get(change.argument)!;
            if (fields.has(item.field)) throw new TypeError('Duplicate shadow write.');
            fields.add(item.field);
            return {...item, next: change.value};
        }).filter(item => item.next !== item.value);
    };
    const host: TurboWarpBlockEditorHost & {descendants?: DescendantEditorHost; fixedInputs?: FixedInputEditorHost} = {
        isCommitting: () => committing,
        readBlock: reference => {
            const block = workspace.getBlockById(reference.blockId);
            const declaration = block && typeof registry.resolveFixed === 'function' && registry.resolveFixed(block.type);
            if (declaration) return host.fixedInputs ? host.fixedInputs.readBlock(reference, declaration) : null;
            const result = inspect(reference);
            return result ? result.snapshot : null;
        },
        commit: ({expected, changes}) => {
            if (typeof registry.resolveFixed === 'function' && registry.resolveFixed(expected.opcode)) {
                throw new TypeError('Fixed input editors require the fixed transaction port.');
            }
            const current = inspect(expected);
            if (!current || JSON.stringify(current.snapshot) !== JSON.stringify(expected)) {
                throw new BlockEditorConflictError();
            }
            apply(prepare(changes.map(change => ({...change, blockId: expected.blockId})),
                new Map([[expected.blockId, current]])));
        },
        invalidate: renew,
        dispose: () => {
            disposed = true;
            notifyFixedScopes();
            fixedScopeListeners.clear();
            notifyInvalidations();
            invalidations.clear();
            workspace.removeChangeListener(invalidate);
            vm.removeListener('workspaceUpdate', renew);
            vm.removeListener('targetsUpdate', targetsChanged);
        }
    };
    if (enableDescendants) {
        host.descendants = {
            capability: DESCENDANT_EDITING_CAPABILITY,
            readSubtree: reference => {
                const result = collect(reference);
                return result ? result.snapshot : null;
            },
            commitSubtree: ({expected, changes, signal}) => {
                const current = collect(expected);
                if ((signal && signal.aborted) || !current ||
                    JSON.stringify(current.snapshot) !== JSON.stringify(expected)) throw new BlockEditorConflictError();
                apply(prepare(changes, current.records), signal);
            },
            subscribeInvalidation: (reference, listener) => {
                const result = collect(reference);
                if (!result) {
                    listener(new BlockEditorConflictError());
                    return () => {};
                }
                const item = {reference, listener, snapshot: result.snapshot};
                invalidations.add(item);
                return () => invalidations.delete(item);
            }
        };
    }
    if (enableFixedInputs === true) {
        host.fixedInputs = createFixedInputPort({ScratchBlocks, workspace, vm, registry, identify, onError,
            subscribeScope: listener => {
                fixedScopeListeners.add(listener);
                return () => { fixedScopeListeners.delete(listener); };
            },
            getState: () => ({disposed, revision, generation, externalRevision}),
            begin: () => {
                committing = true;
                fixedTransaction = {events: new WeakSet(), revisions: 0, versions: new Map()};
            },
            markEvent: event => fixedTransaction!.events.add(event),
            finish: succeeded => {
                if (!succeeded) {
                    revision -= fixedTransaction!.revisions;
                    for (const [id, delta] of fixedTransaction!.versions) {
                        const remaining = (versions.get(id) || 0) - delta;
                        if (remaining > 0) versions.set(id, remaining);
                        else versions.delete(id);
                    }
                }
                fixedTransaction = null;
                committing = false;
            }});
    }
    return host;
};

export default createBlockEditorHost;
