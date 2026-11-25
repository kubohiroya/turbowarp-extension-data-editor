// SPDX-License-Identifier: GPL-3.0-or-later
// From turbowarp-plus-editor/test/block-editor/modal.test.ts at 7b74a0d.
// The original test license is retained; see LICENSE.GPL-3.0 in this directory.
// Exercise the package's public dialog API with real ReactModal and Intl, without a GUI checkout.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {test, after} from 'node:test';
import * as core from '@kubohiroya/turbowarp-extension-data-editor';
import * as sharedUI from '@kubohiroya/turbowarp-extension-data-editor/react';
import {createBlockEditorErrorSession} from '@kubohiroya/turbowarp-extension-data-editor/turbowarp';
import {JSDOM} from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/', pretendToBeVisual: true
});
for (const name of [
    'window', 'document', 'DOMParser', 'XMLSerializer', 'Element', 'HTMLElement',
    'HTMLCollection', 'NodeList', 'Node', 'navigator'
]) Object.defineProperty(globalThis, name, {value: dom.window[name], configurable: true});
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
// React 16's scheduler must use its timer fallback in this Node/jsdom test.
Object.defineProperty(globalThis, 'MessageChannel', {value: undefined, configurable: true});
after(() => dom.window.close());
const require = createRequire(import.meta.url);
const React = require('react');
const ReactDOM = require('react-dom');
const ReactModal = require('react-modal');
const {act} = require('react-dom/test-utils');
const {bindBlockEditorFieldErrors} = sharedUI;
const {createSchemaEditor} = await import('@kubohiroya/turbowarp-extension-data-editor/rjsf');
const schemaRequire = createRequire(import.meta.resolve('@kubohiroya/turbowarp-extension-data-editor/rjsf'));
const {act: schemaAct, Simulate: schemaSimulate} = schemaRequire('react-dom/test-utils');
const intl = require('react-intl');
const {createPlusBlockEditor} = await import('@kubohiroya/turbowarp-extension-data-editor/plus');
// Editor's Node asset hook supplies an empty stylesheet map in the original tests too.
const blockEditor = createPlusBlockEditor({styles: {}, dialog: sharedUI.BlockEditorDialog});
const ModalComponent = props => React.createElement(ReactModal, {
    isOpen: true, ariaHideApp: false, contentLabel: props.contentLabel,
    onRequestClose: props.onRequestClose
}, props.children);
const Component = intl.injectIntl(props => blockEditor.render({...props,
    ModalComponent, onError: () => {}}));

function textValue(value: core.JsonValue): string {
    assert.equal(typeof value, 'string');
    return value as string;
}

function literalText(slot: core.ArgumentSlot): string {
    assert.equal(slot.kind, 'literal');
    return textValue(slot.value);
}

async function fixture(t, {validate = () => []}: {validate?: core.EditorDefinition['validate']} = {}) {
    const registry = new core.EditorRegistry();
    let mounts = 0;
    let cleanups = 0;
    let commits = 0;
    let closes = 0;
    const block: core.BlockSnapshot = {
        targetId: 'sprite', blockId: 'scene', opcode: 'story_scene', revision: '1',
        arguments: {PROPERTIES: {kind: 'literal' as const, value: '{}'}}
    };
    registry.register({
        apiVersion: 1, extensionId: 'story', editorId: 'properties', opcodes: ['story_scene'],
        editableArguments: ['PROPERTIES'],
        read: () => ({properties: '{}'}), validate,
        createPatch: draft => [{argument: 'PROPERTIES', value: textValue(draft.properties)}],
        mount: (container, context) => {
            assert.ok(container instanceof dom.window.HTMLElement);
            mounts++;
            const input = document.createElement('textarea');
            input.value = textValue(context.getDraft().properties);
            container.appendChild(input);
            const onInput = () => context.setDraft({properties: input.value});
            input.addEventListener('input', onInput);
            return () => {
                cleanups++;
                input.removeEventListener('input', onInput);
                input.remove();
            };
        }
    });
    const session = registry.open(block, {readBlock: () => block, commit: () => { commits++; }});
    const root = document.createElement('div');
    document.body.appendChild(root);
    await act(async () => {
        ReactDOM.render(React.createElement(intl.IntlProvider, {locale: 'en'},
            React.createElement(Component, {session, onClose: () => { closes++; }})
        ), root);
        await new Promise(resolve => setTimeout(resolve, 0));
    });
    t.after(() => {
        act(() => { ReactDOM.unmountComponentAtNode(root); });
        root.remove();
    });
    const input = document.querySelector('textarea');
    assert.ok(input, 'The editor body mounts after the real ReactModal portal becomes available.');
    return {
        session, input,
        mounts: () => mounts, cleanups: () => cleanups,
        commits: () => commits, closes: () => closes,
        edit: value => act(() => {
            input.value = value;
            input.dispatchEvent(new dom.window.Event('input', {bubbles: true}));
        }),
        save: () => document.querySelector<HTMLButtonElement>('[data-block-editor-save]')
    };
}

test('invalid data stays open with its draft and errors; valid data alone reaches commit', async t => {
    const f = await fixture(t, {validate: draft => draft.properties === 'invalid'
        ? [{message: 'Enter valid data.'}] : []});
    f.edit('invalid');
    await act(async () => { f.save().click(); });
    assert.equal(f.session.getState().status, 'editing');
    assert.equal(f.commits(), 0);
    assert.equal(f.closes(), 0);
    assert.equal(f.input.value, 'invalid');
    assert.match(document.querySelector('[role="status"]').textContent, /Enter valid data/);
    f.edit('{"duration":2}');
    await act(async () => { f.save().click(); });
    assert.equal(f.commits(), 1);
    assert.equal(f.closes(), 1);
    assert.equal(f.cleanups(), 1);
});

test('asynchronous validation disables Save and a repeated click cannot commit early', async t => {
    let release;
    const f = await fixture(t, {validate: () => new Promise<core.ValidationIssue[]>(resolve => { release = resolve; })});
    f.edit('pending invalid data');
    act(() => f.save().click());
    assert.equal(f.save().disabled, true);
    assert.equal(f.session.cancel(), false);
    act(() => f.save().click());
    assert.equal(f.commits(), 0);
    await act(async () => { release([{message: 'Invalid.'}]); });
    assert.equal(f.save().disabled, true);
    assert.equal(f.commits(), 0);
    assert.equal(f.closes(), 0);
});

test('opening focuses the body after its portal and form are rendered', async t => {
    const f = await fixture(t);
    await act(async () => { await new Promise(resolve => window.requestAnimationFrame(resolve)); });
    assert.equal(document.activeElement, f.input);
});

test('IME Escape and multiline Enter retain the draft; ordinary Escape cancels', async t => {
    const f = await fixture(t);
    f.edit('one\ntwo');
    act(() => {
        f.input.dispatchEvent(new dom.window.CompositionEvent('compositionstart', {bubbles: true}));
        f.input.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
            key: 'Escape', keyCode: 27, bubbles: true, isComposing: true
        }));
        f.input.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
            key: 'Enter', keyCode: 13, bubbles: true, isComposing: true
        }));
    });
    assert.equal(f.session.getState().status, 'editing');
    assert.equal(f.commits(), 0);
    act(() => {
        f.input.dispatchEvent(new dom.window.CompositionEvent('compositionend', {bubbles: true}));
        f.input.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
            key: 'Enter', keyCode: 13, bubbles: true
        }));
    });
    assert.equal(f.session.getState().status, 'editing');
    assert.equal(f.session.getDraft().properties, 'one\ntwo');
    act(() => { f.input.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
        key: 'Escape', keyCode: 27, bubbles: true
    })); });
    assert.equal(f.session.getState().status, 'cancelled');
    assert.equal(f.closes(), 1);
    assert.equal(f.commits(), 0);
});

async function hierarchyFixture(t, {validate = () => [], extraNodes = 0, nodeAppearances = {}}: {
    validate?: core.EditorDefinition['validate'];
    extraNodes?: number;
    nodeAppearances?: Record<string, import('@kubohiroya/turbowarp-extension-data-editor/turbowarp').TurboWarpNodeAppearance>;
} = {}) {
    const registry = new core.EditorRegistry();
    let commits = 0;
    let closes = 0;
    let cleanups = 0;
    const remove = registry.register({
        apiVersion: 1, extensionId: 'demo', editorId: 'tree', opcodes: ['demo_node'],
        editableArguments: ['VALUE'],
        read: block => ({properties: literalText(block.arguments.VALUE), id: block.blockId}),
        validate: (draft, block) => draft.properties === 'invalid'
            ? [{message: 'Invalid nested value', path: 'properties'}] : validate(draft, block),
        createPatch: draft => [{argument: 'VALUE', value: textValue(draft.properties)}],
        mount: (container, context) => {
            const input = document.createElement('textarea');
            input.id = `field-${context.getDraft().id}`;
            input.value = textValue(context.getDraft().properties);
            const update = () => {
                context.setDraft({...context.getDraft(), properties: input.value});
            };
            input.addEventListener('input', update);
            const sync = () => { input.disabled = context.getState().status !== 'editing'; };
            context.subscribe(sync);
            sync();
            container.appendChild(input);
            return () => {
                cleanups++;
                input.removeEventListener('input', update);
                input.remove();
            };
        }
    });
    const node = (id, branches = [], opcode = 'demo_node') => ({block: {
        targetId: 'target', blockId: id, opcode, revision: '1', arguments: {VALUE: {kind: 'literal' as const, value: '{}'}}
    }, branches});
    const snapshot = {targetId: 'target', blockId: 'root', generation: '1', nodes: [
        node('root', [{input: 'BODY', blockIds: ['a', 'middle']}, {input: 'ELSE', blockIds: ['b']}]),
        node('a'), node('middle', [{input: 'BODY', blockIds: ['grand']}], 'control_repeat'), node('grand'), node('b')
    ]};
    for (let i = 0; i < extraNodes; i++) {
        const id = `extra${i}`;
        snapshot.nodes[0].branches[1].blockIds.push(id);
        snapshot.nodes.push(node(id));
    }
    const session = registry.openDescendants(snapshot, {readBlock: () => snapshot.nodes[0].block, commit: () => {
        throw new Error('Single commits must not be used');
    }, descendants: {capability: core.DESCENDANT_EDITING_CAPABILITY,
        readSubtree: () => snapshot, commitSubtree: () => { commits++; }}});
    const root = document.createElement('div');
    document.body.appendChild(root);
    await act(async () => {
        ReactDOM.render(React.createElement(intl.IntlProvider, {locale: 'en'},
            React.createElement(Component, {session, nodeAppearances, nodeLabels: {root: 'Root', a: 'First', middle: 'Repeat',
                grand: 'Grandchild', b: 'Other'}, onClose: () => { closes++; }})
        ), root);
        await new Promise(resolve => setTimeout(resolve, 0));
    });
    t.after(() => {
        act(() => { ReactDOM.unmountComponentAtNode(root); });
        root.remove();
    });
    return {
        session, remove, commits: () => commits, closes: () => closes, cleanups: () => cleanups,
        field: id => document.querySelector<HTMLTextAreaElement>(`#field-${id}`),
        toggle: id => document.querySelector<HTMLButtonElement>(`[data-block-editor-toggle="${id}"]`),
        save: () => document.querySelector<HTMLButtonElement>('[data-block-editor-save]'),
        edit: (id, value) => act(() => {
            const input = document.querySelector<HTMLTextAreaElement>(`#field-${id}`);
            input.value = value;
            input.dispatchEvent(new dom.window.Event('input', {bubbles: true}));
        })
    };
}

test('one real modal composes parent/grandchild forms and reveals an invalid collapsed node', async t => {
    const f = await hierarchyFixture(t);
    assert.equal(document.querySelectorAll('[role="dialog"]').length, 1);
    assert.equal(document.querySelectorAll('[data-block-editor-save]').length, 1);
    assert.equal(f.save().textContent, 'Save all');
    assert.equal(document.querySelectorAll('form').length, 0);
    const rootNode = document.querySelector<HTMLElement>('[data-block-editor-node="root"]');
    const middleNode = document.querySelector<HTMLElement>('[data-block-editor-node="middle"]');
    assert.ok(rootNode.contains(middleNode));
    assert.ok(middleNode.contains(document.querySelector<HTMLElement>('[data-block-editor-node="grand"]')));
    f.edit('grand', 'invalid');
    act(() => f.toggle('middle').click());
    assert.equal(f.field('grand'), null);
    assert.equal(f.session.getEditor('grand').getDraft().properties, 'invalid');
    await act(async () => { f.save().click(); });
    assert.equal(f.commits(), 0);
    assert.equal(f.save().disabled, true);
    assert.equal(f.field('grand').value, 'invalid');
    assert.equal(f.toggle('middle').getAttribute('aria-expanded'), 'true');
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
    assert.equal(document.activeElement, f.field('grand'));
    assert.match(document.querySelector('[role="status"]').textContent, /Grandchild: Invalid nested value/);
    f.edit('grand', '{"fixed":true}');
    f.edit('a', '{"first":true}');
    await act(async () => { f.save().click(); });
    assert.equal(f.commits(), 1);
    assert.equal(f.closes(), 1);
    assert.equal(f.cleanups(), 5);
});

test('aggregate saving disables forms, closing, toggles and double submit; unregister releases all views', async t => {
    let release;
    const f = await hierarchyFixture(t, {validate: () => new Promise<core.ValidationIssue[]>(resolve => { release = resolve; })});
    f.edit('a', 'pending');
    act(() => f.save().click());
    assert.equal(f.save().disabled, true);
    assert.equal(f.toggle('root').disabled, true);
    assert.equal(f.field('a').disabled, true);
    act(() => f.save().click());
    assert.equal(f.commits(), 0);
    await act(async () => { f.remove(); });
    assert.equal(f.session.getState().status, 'invalidated');
    assert.equal(f.closes(), 1);
    assert.equal(f.cleanups(), 4);
    assert.equal(f.field('grand'), null);
    await act(async () => { release([]); });
    assert.equal(f.commits(), 0);
});

test('hierarchy IME Escape is retained and ordinary Escape cancels every node without commit', async t => {
    const f = await hierarchyFixture(t);
    f.edit('grand', 'unfinished');
    act(() => {
        f.field('grand').dispatchEvent(new dom.window.CompositionEvent('compositionstart', {bubbles: true}));
        f.field('grand').dispatchEvent(new dom.window.KeyboardEvent('keydown', {
            key: 'Escape', keyCode: 27, bubbles: true, cancelable: true, isComposing: true
        }));
    });
    assert.equal(f.session.getState().status, 'editing');
    await act(async () => {
        f.field('grand').dispatchEvent(new dom.window.CompositionEvent('compositionend', {bubbles: true}));
        f.field('grand').dispatchEvent(new dom.window.KeyboardEvent('keydown', {
            key: 'Escape', keyCode: 27, bubbles: true, cancelable: true
        }));
    });
    assert.equal(f.session.getState().status, 'cancelled');
    assert.equal(f.commits(), 0);
    assert.equal(f.cleanups(), 4);
});

test('hierarchy opening errors show a diagnostic with Save disabled and no partial form', async t => {
    const session = createBlockEditorErrorSession({targetId: 't', blockId: 'b'},
        new core.BlockEditorStructureError('Too deep', 'limit'));
    const root = document.createElement('div');
    document.body.appendChild(root);
    t.after(() => { act(() => { ReactDOM.unmountComponentAtNode(root); }); root.remove(); });
    await act(async () => {
        ReactDOM.render(React.createElement(intl.IntlProvider, {locale: 'en'},
            React.createElement(Component, {session, onClose: () => {}})), root);
        await new Promise(resolve => setTimeout(resolve, 0));
    });
    assert.equal(document.querySelector<HTMLButtonElement>('[data-block-editor-save]').disabled, true);
    assert.equal(document.querySelectorAll('textarea, input').length, 0);
    assert.match(document.querySelector('[role="status"]').textContent, /500 blocks or 32 levels/);
});

test('large hierarchies mount lazily but still validate and reveal an unseen grandchild', async t => {
    const f = await hierarchyFixture(t, {extraNodes: 30});
    assert.equal(document.querySelectorAll('textarea').length, 1);
    assert.equal(f.field('grand'), null);
    f.session.getEditor('grand').setDraft({id: 'grand', properties: 'invalid'});
    await act(async () => { f.save().click(); });
    assert.equal(f.commits(), 0);
    assert.equal(f.field('grand').value, 'invalid');
    assert.equal(f.toggle('middle').getAttribute('aria-expanded'), 'true');
    assert.equal(f.field('extra29'), null);
});


test('each hierarchy heading has its own decorative icon and colour, including structural nodes', async t => {
    const firstIcon = 'data:image/svg+xml,<svg id="first"/>';
    const otherIcon = 'data:image/svg+xml,<svg id="other"/>';
    const f = await hierarchyFixture(t, {nodeAppearances: {
        root: {name: '親グループ', iconURI: firstIcon, colour: '#087f8c', tint: 'rgba(8, 127, 140, 0.08)'},
        a: {iconURI: firstIcon, colour: '#087f8c', tint: 'rgba(8, 127, 140, 0.08)'},
        middle: {colour: '#ffab19', tint: 'rgba(255, 171, 25, 0.08)'},
        grand: {iconURI: otherIcon, colour: '#663399', tint: 'rgba(102, 51, 153, 0.08)'}
    }});
    const section = id => document.querySelector<HTMLElement>(`[data-block-editor-node="${id}"]`);
    const icon = id => document.querySelector<HTMLImageElement>(`[data-block-editor-node-icon="${id}"]`);
    assert.equal(icon('root').getAttribute('src'), firstIcon);
    assert.equal(document.querySelector('[data-block-editor-node-name="root"]').textContent, '親グループ');
    assert.equal(document.querySelector('[data-block-editor-node-name="grand"]').textContent, 'Grandchild');
    assert.equal(icon('grand').getAttribute('src'), otherIcon);
    assert.equal(icon('grand').getAttribute('alt'), '');
    assert.equal(icon('grand').getAttribute('aria-hidden'), 'true');
    assert.equal(icon('grand').tabIndex, -1);
    assert.equal(section('middle').style.getPropertyValue('--block-editor-node-colour'), '#ffab19');
    assert.equal(section('grand').style.getPropertyValue('--block-editor-node-colour'), '#663399');
    assert.equal(section('grand').style.getPropertyValue('--block-editor-node-tint'), 'rgba(102, 51, 153, 0.08)');
    assert.equal(section('b').style.getPropertyValue('--block-editor-node-colour'), '');
    assert.equal(icon('middle'), null);
    assert.equal(icon('b'), null);
    f.edit('grand', 'draft retained');
    act(() => f.toggle('middle').click());
    assert.equal(icon('grand'), null);
    assert.equal(section('middle').style.getPropertyValue('--block-editor-node-colour'), '#ffab19');
    act(() => f.toggle('middle').click());
    assert.equal(icon('grand').getAttribute('src'), otherIcon);
    assert.equal(f.field('grand').value, 'draft retained');
    assert.equal(f.commits(), 0);
});

test('an image load failure removes only that node icon and survives collapsing its ancestor', async t => {
    const iconURI = 'missing-icon.svg';
    const f = await hierarchyFixture(t, {nodeAppearances: {
        root: {iconURI}, grand: {iconURI, colour: '#663399', tint: 'rgba(102, 51, 153, 0.08)'}
    }});
    f.edit('grand', 'invalid');
    act(() => { document.querySelector('[data-block-editor-node-icon="grand"]').dispatchEvent(
        new dom.window.Event('error')); });
    assert.equal(document.querySelector('[data-block-editor-node-icon="grand"]'), null);
    assert.ok(document.querySelector('[data-block-editor-node-icon="root"]'));
    assert.match(f.toggle('grand').textContent, /Grandchild/);
    act(() => f.toggle('middle').click());
    await act(async () => { f.save().click(); });
    assert.equal(f.toggle('middle').getAttribute('aria-expanded'), 'true');
    assert.equal(document.querySelector('[data-block-editor-node-icon="grand"]'), null);
    assert.equal(f.field('grand').value, 'invalid');
    assert.equal(f.commits(), 0);
});

async function schemaModalFixture(t, {schema, data, uiSchema, descendants}: {
    schema: Parameters<typeof createSchemaEditor>[0]['schema'];
    uiSchema?: Parameters<typeof createSchemaEditor>[0]['uiSchema'];
    data: core.JsonValue;
    descendants?: core.JsonValue;
}) {
    const registry = new core.EditorRegistry();
    registry.register(createSchemaEditor({apiVersion: 1, extensionId: 'demo', editorId: 'schema',
        opcodes: ['demo_node'], argument: 'VALUE', schema, uiSchema}));
    const node = (id, value, branches = []) => ({block: {
        targetId: 'target', blockId: id, opcode: 'demo_node', revision: '1',
        arguments: {VALUE: {kind: 'literal' as const, value: JSON.stringify(value)}}
    }, branches});
    const snapshot = {targetId: 'target', blockId: 'root', generation: '1', nodes: descendants ? [
        node('root', data, [{input:'BODY',blockIds:['grand']}]), node('grand', descendants)
    ] : [node('root', data)]};
    let commits = 0;
    const host: core.BlockEditorHost = {readBlock: () => snapshot.nodes[0].block, commit: () => { commits++; },
        descendants: {capability: core.DESCENDANT_EDITING_CAPABILITY,
            readSubtree: () => snapshot, commitSubtree: () => { commits++; }}};
    const session = descendants ? registry.openDescendants(snapshot, host) : registry.open(snapshot, host);
    const root = document.createElement('div');
    document.body.appendChild(root);
    await act(async () => {
        ReactDOM.render(React.createElement(intl.IntlProvider, {locale:'en'},
            React.createElement(Component, {session, onClose: () => {}, nodeAppearances: {
                root:{name:'Parent',colour:'#087f8c',tint:'rgba(8, 127, 140, 0.08)'},
                grand:{name:'Grandchild',colour:'#663399',tint:'rgba(102, 51, 153, 0.08)'}
            }})), root);
        await new Promise(resolve=>setTimeout(resolve,0));
    });
    let mounted = true;
    const unmount = () => {
        if (mounted) act(() => { ReactDOM.unmountComponentAtNode(root); });
        mounted = false;
    };
    t.after(() => { unmount(); root.remove(); });
    const field = (name: string, id?: string) => {
        const container = id ? document.querySelector<HTMLElement>(`[data-block-editor-node="${id}"]`) : document;
        return [...container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select')].find(control=>control.id.endsWith(`_${name}`));
    };
    return {session, snapshot, unmount, commits:()=>commits, field,
        change: async (control,value) => {
            await schemaAct(async()=> { schemaSimulate.change(control,{target:{value}}); });
            await new Promise(resolve=>setTimeout(resolve,0));
        }};
}

test('real RJSF highlights initial field errors and preserves valid nested siblings and group constraints', async t => {
    const f = await schemaModalFixture(t, {schema:{type:'object',required:['name','amount'],properties:{
        name:{type:'string',minLength:1}, amount:{type:'integer',minimum:1},
        mode:{type:'string',enum:['a','b']}, notes:{type:'string',pattern:'^OK',title:'Notes'},
        nested:{type:'object',properties:{valid:{type:'string'},invalid:{type:'string',pattern:'^OK$'}}},
        list:{type:'array',maxItems:1,items:{type:'object',properties:{label:{type:'string',minLength:1}},required:['label']}}
    }}, uiSchema:{notes:{'ui:widget':'textarea'}},
    data:{amount:0,mode:'outside',notes:'bad',nested:{valid:'fine',invalid:'bad'},list:[{label:'valid'},{label:'also valid'}]}});
    for (const name of ['name','amount','mode','notes','nested_invalid']) {
        const control=f.field(name);
        assert.equal(control.getAttribute('aria-invalid'),'true', name);
        assert.equal(control.getAttribute('data-block-editor-invalid'),'true', name);
        const error=document.getElementById(`${control.id}__error`);
        assert.ok(error && error.textContent.trim(), name);
        assert.ok(control.getAttribute('aria-describedby').split(/\s+/).includes(error.id));
        assert.equal(error.closest('.field'),control.closest('.field'));
    }
    for (const name of ['nested_valid','list_0_label']) {
        assert.equal(f.field(name).hasAttribute('aria-invalid'),false, name);
        assert.equal(f.field(name).hasAttribute('data-block-editor-invalid'),false, name);
    }
    const array=f.field('list_0_label').closest('.field-array.has-error');
    assert.equal(array.getAttribute('data-block-editor-invalid'),'group');
    assert.equal(array.getAttribute('role'),'group');
    assert.ok(document.getElementById(array.getAttribute('aria-labelledby')));
    assert.match(array.querySelector('.error-detail').textContent,/1/);
    assert.equal(f.session.getState().canSave,false);
    assert.equal(f.commits(),0);
});

test('correcting real RJSF errors removes field decoration without losing focus, and unmount restores attributes', async t => {
    const f=await schemaModalFixture(t,{schema:{type:'object',required:['name','amount'],properties:{
        name:{type:'string',minLength:1},amount:{type:'integer',minimum:1}
    }},data:{name:'',amount:0}});
    const name=f.field('name');
    const amount=f.field('amount');
    name.focus();
    await f.change(name,'Valid');
    assert.equal(document.activeElement,name);
    assert.equal(name.hasAttribute('data-block-editor-invalid'),false);
    assert.equal(name.hasAttribute('aria-invalid'),false);
    assert.equal(amount.getAttribute('aria-invalid'),'true');
    await f.change(amount,'2');
    assert.equal(amount.hasAttribute('aria-invalid'),false);
    assert.equal(document.querySelectorAll('[data-block-editor-invalid]').length,0);
    assert.equal(f.session.getState().canSave,true);
    assert.equal(f.commits(),0);
    await f.change(amount,'0');
    assert.equal(amount.getAttribute('aria-invalid'),'true');
    f.unmount();
    assert.equal(amount.hasAttribute('aria-invalid'),false);
    assert.equal(amount.hasAttribute('data-block-editor-invalid'),false);
    assert.equal(f.commits(),0);
});

test('real nested RJSF error display survives collapse and reveal while block appearance remains intact', async t => {
    const f=await schemaModalFixture(t,{schema:{type:'object',required:['amount'],properties:{
        amount:{type:'integer',minimum:1}
    }},data:{amount:1},descendants:{amount:0}});
    const root=document.querySelector<HTMLElement>('[data-block-editor-node="root"]');
    const grand=document.querySelector<HTMLElement>('[data-block-editor-node="grand"]');
    assert.equal(root.style.getPropertyValue('--block-editor-node-colour'),'#087f8c');
    assert.equal(grand.style.getPropertyValue('--block-editor-node-colour'),'#663399');
    assert.equal(f.field('amount','root').hasAttribute('aria-invalid'),false);
    assert.equal(f.field('amount','grand').getAttribute('aria-invalid'),'true');
    act(()=>document.querySelector<HTMLButtonElement>('[data-block-editor-toggle="grand"]').click());
    assert.equal(f.field('amount','grand'),undefined);
    const issue=document.querySelector<HTMLElement>('[data-block-editor-issue]');
    assert.ok(issue);
    await act(async()=> { issue.click(); await new Promise(resolve=>setTimeout(resolve,30)); });
    const control=f.field('amount','grand');
    assert.equal(control.getAttribute('aria-invalid'),'true');
    assert.equal(control.value,'0');
    assert.equal(document.activeElement,control);
    assert.equal(grand.style.getPropertyValue('--block-editor-node-tint'),'rgba(102, 51, 153, 0.08)');
    await f.change(control,'2');
    assert.equal(control.hasAttribute('aria-invalid'),false);
    assert.equal(f.session.getState().canSave,true);
    assert.equal(f.commits(),0);
});

test('the error adapter leaves custom non-RJSF forms untouched and releases its observer', async () => {
    const container=document.createElement('div');
    container.innerHTML='<div class="field has-error"><input id="custom" aria-describedby="custom__error">'+
        '<ul class="error-detail" id="custom__error"><li>Custom error</li></ul></div>';
    const stop=bindBlockEditorFieldErrors(container);
    const input=container.querySelector('input');
    assert.equal(input.hasAttribute('aria-invalid'),false);
    stop();
    container.firstElementChild.classList.add('rjsf');
    await Promise.resolve();
    assert.equal(input.hasAttribute('data-block-editor-invalid'),false);
});


test('object-wide errors describe the group without marking its valid controls', async t => {
    const f = await schemaModalFixture(t, {schema: {type: 'object', properties: {
        group: {type: 'object', title: 'Settings group', minProperties: 2, properties: {
            valid: {type: 'string'}, other: {type: 'string'}
        }}
    }}, data: {group: {valid: 'Keep this value'}}});
    const valid = f.field('group_valid');
    const group = valid.closest('.field-object.has-error');
    assert.ok(group);
    assert.equal(group.getAttribute('data-block-editor-invalid'), 'group');
    assert.equal(group.getAttribute('aria-invalid'), 'true');
    assert.ok(document.getElementById(group.getAttribute('aria-labelledby')));
    assert.equal(valid.hasAttribute('aria-invalid'), false);
    assert.equal(f.field('group_other').hasAttribute('aria-invalid'), false);
    assert.equal(f.session.getState().canSave, false);
    await f.change(f.field('group_other'), 'Another value');
    assert.equal(group.hasAttribute('aria-invalid'), false);
    assert.equal(group.hasAttribute('data-block-editor-invalid'), false);
    assert.equal(group.hasAttribute('role'), false);
    assert.equal(f.session.getState().canSave, true);
});


test('array reordering keeps error descriptions attached to the current field IDs', async t => {
    const f = await schemaModalFixture(t, {schema: {type: 'object', properties: {
        list: {type: 'array', items: {type: 'object', properties: {
            label: {type: 'string', minLength: 1}
        }}}
    }}, data: {list: [{label: ''}, {label: 'Valid sibling'}]}});
    const initial = f.field('list_0_label');
    const oldId = initial.id;
    assert.equal(initial.getAttribute('aria-invalid'), 'true');
    const move = initial.closest('.array-item').querySelector('button[aria-label="項目を下へ移動"]');
    assert.ok(move);
    await schemaAct(async () => { schemaSimulate.click(move); });
    await new Promise(resolve => setTimeout(resolve, 0));
    const moved = f.field('list_1_label');
    assert.equal(moved.value, '');
    assert.equal(moved.getAttribute('aria-invalid'), 'true');
    assert.ok(moved.getAttribute('aria-describedby').split(/\s+/).includes(`${moved.id}__error`));
    await f.change(moved, 'Corrected after move');
    assert.equal(moved.hasAttribute('aria-invalid'), false);
    assert.ok(moved.getAttribute('aria-describedby').split(/\s+/).includes(`${moved.id}__description`));
    assert.ok(!moved.getAttribute('aria-describedby').split(/\s+/).includes(`${oldId}__error`));
    assert.equal(f.field('list_0_label').value, 'Valid sibling');
});
