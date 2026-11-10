// Runs in the minimal editor runtime: the TurboWarp Plus Editor's pinned VM and Scratch Blocks, with
// this package attached to the workspace the way the Editor's GUI attaches it.
import React from 'react';
import ReactDOM from 'react-dom';
import {createBlockEditorService} from '../../dist/rjsf.js';
import {BlockEditorDialog} from '../../dist/react.js';
import {attachTurboWarpBlockEditors} from '../../dist/turbowarp.js';
import styles from '../../dist/react.css';
import * as fixed from './fixed-fixture.ts';
import * as preview from './preview-fixture.ts';

const fixtures = {fixed, preview};

declare const EditorRuntime: any;
const messages = {title: 'Edit block', saving: 'Saving…', cancel: 'Cancel', save: 'Save', saveAll: 'Save all',
    structureError: 'Structure error', conflict: 'Conflict', failed: 'Failed', structuralNode: 'Structure'};

// The stylesheet is a CSS module in the Editor's build. Here it is loaded as it is, so each class the
// dialog asks for is its kebab-case name in the stylesheet.
const classes = new Proxy({}, {get: (_target, name) => typeof name === 'string' ?
    name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`) : undefined});

// The frame the GUI's modal gives the dialog, reduced to what the dialog relies on: an overlay above the
// workspace, and a labelled dialog that closes on Escape.
const Modal = ({id, className, contentLabel, onRequestClose, children}: any) => React.createElement('div',
    {style: {position: 'fixed', inset: 0, zIndex: 1000, overflow: 'auto', background: 'rgba(0, 0, 0, 0.3)'}},
    React.createElement('div', {id, className, role: 'dialog', 'aria-modal': true, 'aria-label': contentLabel,
        style: {background: 'white'},
        onKeyDown: (event: KeyboardEvent) => { if (event.key === 'Escape') onRequestClose(); }}, children));

// A preview VM is a second VM. Constructing one re-registers the VM's dispatch services, so the
// Editor's GUI takes them out for the constructor and puts them back; this does the same.
const createPreviewVm = () => {
    const {dispatch} = EditorRuntime.vmModules;
    const keys = ['runtime', 'extensions'];
    const previous = keys.map(key => Object.getOwnPropertyDescriptor(dispatch.services, key));
    for (const key of keys) delete dispatch.services[key];
    try {
        const vm = new EditorRuntime.VirtualMachine();
        vm.extensionManager.loadExtensionURL = () => Promise.reject(new Error('Preview VMs cannot load extensions.'));
        return vm;
    } finally {
        keys.forEach((key, index) => {
            if (previous[index]) Object.defineProperty(dispatch.services, key, previous[index]);
            else delete dispatch.services[key];
        });
    }
};

(globalThis as any).setup = async (kind: keyof typeof fixtures = 'fixed') => {
    const host = await EditorRuntime.start(document.getElementById('workspace'), {locale: 'en'});
    const style = document.createElement('style');
    // What css-loader does for this module: `:global(...)` names stay as written, local names stay kebab-case.
    style.textContent = (styles as string).replace(/:global\(([^)]+)\)/g, '$1');
    document.head.append(style);
    const service = createBlockEditorService({commonLayout: true, fixedInputs: true});
    const {ScratchCommon} = EditorRuntime.vmModules;
    fixtures[kind].register({...ScratchCommon, gui: {blockEditors: service.api, createPreviewVm},
        extensions: {unsandboxed: true, register: (extension: any) => host.registerExtension(extension)}});
    await host.loadProject(fixtures[kind].projectJSON());
    const root = document.createElement('div');
    document.body.append(root);
    let open = false;
    const bridge = attachTurboWarpBlockEditors({
        enabled: true, descendants: true, fixedInputs: true, ScratchBlocks: (globalThis as any).Blockly,
        workspace: host.workspace, vm: host.vm, service, label: 'Edit block',
        canOpen: () => !open,
        onOpen: (session: any, nodeLabels: any, nodeAppearances: any) => {
            open = true;
            const close = () => { open = false; ReactDOM.unmountComponentAtNode(root); };
            ReactDOM.render(React.createElement(BlockEditorDialog, {session, nodeLabels, nodeAppearances, styles: classes,
                messages, ModalComponent: Modal, onClose: close, onError: (error: unknown) => { throw error; }}), root);
        },
        onError: (error: unknown) => { throw error; }
    } as any);
    (globalThis as any).fixed = {host, bridge};
};

// The values the VM holds for the fixture block, and how often its reporter ran.
(globalThis as any).raw = () => {
    const blocks = (globalThis as any).fixed.host.vm.editingTarget.blocks;
    const root = blocks.getBlock('fixed-root');
    const field = (argument: string, name: string) => blocks.getBlock(root.inputs[argument].block).fields[name].value;
    return {mode: root.fields.MODE.value, number: field('NUMBER', 'NUM'), timeout: field('TIMEOUT', 'NUM'),
        color: field('COLOR', 'COLOUR'), reporter: root.inputs.CONDITION.block,
        evaluations: (globalThis as any).__fixedFixtureExecutions};
};
