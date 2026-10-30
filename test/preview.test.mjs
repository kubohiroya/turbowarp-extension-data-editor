import assert from 'node:assert/strict';
import test from 'node:test';
import {JSDOM} from 'jsdom';
import {EditorRegistry} from '../dist/index.js';
import {createBlockEditorService} from '../dist/rjsf.js';
import {attachTurboWarpBlockEditors, bindBlockEditorIcon, openBlockEditorSession} from '../dist/turbowarp.js';
import {nativeFixture, nativeAvailable} from './fixtures/fixed-host-native.mjs';

const reference = {targetId: 'target', blockId: 'block'};
const snapshot = () => ({...reference, opcode: 'story_scene', revision: '1', arguments: {VALUE: {kind: 'literal', value: 'old'}}});
const definition = (overrides = {}) => ({apiVersion: 1, extensionId: 'story', editorId: 'scene', opcodes: ['story_scene'],
  editableArguments: ['VALUE'], read: s => ({value: s.arguments.VALUE.value}), validate: () => [],
  createPatch: d => [{argument: 'VALUE', value: d.value}], mount: () => () => {}, ...overrides});
const preview = (overrides = {}) => ({extensionId: 'story', opcodes: ['story_scene'], mount: () => () => {}, ...overrides});
const domFor = t => {const dom = new JSDOM('<body><div id="mount"></div></body>');t.after(() => dom.window.close());return dom;};
function sessionFixture(registry) {
  let live = snapshot();const writes = [];
  const host = {readBlock: () => live, commit: request => {
    assert.deepEqual(request.expected, live);
    const before = live;live = structuredClone(live);live.revision = '2';
    for (const change of request.changes) live.arguments[change.argument].value = change.value;
    writes.push({before, after: live});
  }};
  return {host, writes, live: () => live, open: () => registry.open(reference, host)};
}

test('preview registration is explicit, namespaced, atomic and removable without removing the form', () => {
  const registry = new EditorRegistry();registry.register(definition());
  assert.equal(registry.resolvePreview('story_scene'), undefined);
  for (const bad of [null, preview({extensionId: 'bad_id'}), preview({opcodes: []}),
    preview({opcodes: ['story_scene', 'story_scene']}), preview({opcodes: ['foreign_scene']}),
    preview({mount: null}), preview({hover: 'bad'})]) assert.throws(() => registry.registerPreview(bad), TypeError);
  const declaration = preview();const remove = registry.registerPreview(declaration);
  declaration.opcodes.push('story_other');assert.equal(registry.resolve('story_other'), undefined);
  assert.throws(() => registry.registerPreview(preview({opcodes: ['story_new', 'story_scene']})), TypeError);
  assert.equal(registry.resolve('story_new'), undefined);
  assert.deepEqual(registry.resolve('story_scene').editableArguments, ['VALUE']);
  remove();remove();assert.equal(registry.resolvePreview('story_scene'), undefined);
  assert.equal(registry.resolve('story_scene').editorId, 'scene');
});

test('registerPreview service capability notifies once per registration and removal', () => {
  const service = createBlockEditorService();let changes = 0;service.subscribe(() => changes++);
  assert.equal(typeof service.api.registerPreview, 'function');
  const remove = service.api.registerPreview(preview());assert.equal(changes, 1);
  remove();remove();assert.equal(changes, 2);assert.equal(service.registry.resolve('story_scene'), undefined);
});

test('companion and original form share a draft, retain original validation/patch and clean up once', async t => {
  const dom = domFor(t);const registry = new EditorRegistry();const lifecycle = [];let form;let visual;let captured;
  registry.register(definition({mount: (_element, context) => {form = context;lifecycle.push('form');return () => lifecycle.push('form-stop');}}));
  registry.registerPreview(preview({mount: (_element, context, block) => {
    visual = context;captured = block;lifecycle.push('preview');return () => lifecycle.push('preview-stop');
  }}));
  const f = sessionFixture(registry);const s = f.open();const mount = dom.window.document.getElementById('mount');
  const unmount = s.mount(mount);assert.equal(form, visual);assert.equal(captured.blockId, 'block');
  assert(Object.isFrozen(captured.arguments.VALUE));assert.throws(() => {captured.arguments.VALUE.value = 'bad';}, TypeError);
  visual.setDraft({value: 'dragged'});assert.equal(form.getDraft().value, 'dragged');assert.equal(f.writes.length, 0);
  assert.deepEqual(await s.save(), {status: 'saved', changed: true});assert.equal(f.writes.length, 1);
  assert.equal(f.live().arguments.VALUE.value, 'dragged');unmount();
  assert.deepEqual(lifecycle, ['form', 'preview', 'preview-stop', 'form-stop']);assert.equal(mount.childNodes.length, 0);
  assert.throws(() => visual.setDraft({value: 'late'}), /unmounted/);
});

test('cancel and conflicting edits do not commit preview drafts', async t => {
  const dom = domFor(t);const registry = new EditorRegistry();let cleaned = 0;
  registry.register(definition());registry.registerPreview(preview({mount: () => () => cleaned++}));
  const f = sessionFixture(registry);let s = f.open();s.mount(dom.window.document.body);s.setDraft({value: 'cancelled'});s.cancel();
  assert.equal(cleaned, 1);assert.equal(f.writes.length, 0);
  s = f.open();s.setDraft({value: 'unsaved'});f.live().arguments.VALUE.value = 'external';
  assert.equal((await s.save()).status, 'conflict');assert.equal(f.writes.length, 0);assert.equal(s.getDraft().value, 'unsaved');s.dispose();
});

test('a failed preview mount rolls back form subscriptions and DOM, permitting a clean remount', t => {
  const dom = domFor(t);const registry = new EditorRegistry();let fail = true;let stopped = 0;let notified = 0;
  registry.register(definition({mount: (_e, c) => {c.subscribe(() => notified++);return () => stopped++;}}));
  registry.registerPreview(preview({mount: () => {if (fail) throw new Error('preview failed');return () => {};}}));
  const f = sessionFixture(registry);const s = f.open();const mount = dom.window.document.getElementById('mount');
  assert.throws(() => s.mount(mount), /preview failed/);assert.equal(stopped, 1);assert.equal(mount.childNodes.length, 0);
  s.setDraft({value: 'changed'});assert.equal(notified, 0);fail = false;s.mount(mount);s.cancel();assert.equal(stopped, 2);
});

test('preview-only registrations never acquire write authority and form registration can follow preview registration', async t => {
  const dom = domFor(t);const registry = new EditorRegistry();let received;
  const remove = registry.registerPreview(preview({mount: (_e, _c, block) => {received = block;return () => {};}}));
  const f = sessionFixture(registry);let s = f.open();s.mount(dom.window.document.body);assert.deepEqual(s.getDraft(), {});
  s.setDraft({value: 'ignored'});assert.deepEqual(await s.save(), {status: 'saved', changed: false});assert.equal(f.writes.length, 0);
  assert.equal(received.blockId, 'block');registry.register(definition());s = f.open();s.setDraft({value: 'new'});
  assert.equal((await s.save()).changed, true);remove();assert.equal(registry.resolve('story_scene').editorId, 'scene');
});

test('prepared source save contract remains valid after adding a companion', async () => {
  const registry = new EditorRegistry();registry.registerPrepared({...definition(), saveContract: 'prepared-source-v1',
    prepareSave: d => ({kind: 'ready', changes: [{argument: 'VALUE', value: d.value}]})});
  registry.registerPreview(preview());const f = sessionFixture(registry);const s = f.open();s.setDraft({value: 'prepared'});
  assert.deepEqual(await s.save(), {status: 'saved', changed: true});assert.equal(f.live().arguments.VALUE.value, 'prepared');
});

test('removing a companion during pending validation prevents commit', async () => {
  const registry = new EditorRegistry();let finish;
  registry.register(definition({validate: () => new Promise(resolve => {finish = resolve;})}));
  const remove = registry.registerPreview(preview());const f = sessionFixture(registry);const s = f.open();s.setDraft({value: 'stale'});
  const saving = s.save();remove();finish([]);assert.equal((await saving).status, 'conflict');assert.equal(f.writes.length, 0);s.dispose();
});

test('pointer/focus hover callbacks coexist with keyboard activation and leave default icons unchanged', t => {
  const dom = domFor(t);const element = dom.window.document.createElement('div');dom.window.document.body.appendChild(element);
  let hovered = 0;let left = 0;let opened = 0;let enabled = true;
  const stop = bindBlockEditorIcon({element, label: 'Preview', canOpen: () => enabled, onOpen: () => opened++,
    onHover: () => hovered++, onLeave: () => left++});
  element.dispatchEvent(new dom.window.Event('pointerenter'));element.dispatchEvent(new dom.window.Event('pointerleave'));
  element.focus();element.dispatchEvent(new dom.window.KeyboardEvent('keydown', {key: 'Enter', bubbles: true, cancelable: true}));
  assert.equal(hovered, 2);assert.equal(left, 1);assert.equal(opened, 1);
  enabled = false;element.dispatchEvent(new dom.window.Event('pointerenter'));assert.equal(hovered, 2);
  stop();element.dispatchEvent(new dom.window.Event('pointerenter'));assert.equal(hovered, 2);assert.equal(element.getAttribute('role'), null);
  bindBlockEditorIcon({element, label: 'Legacy', canOpen: () => true, onOpen() {}})();
});

test('native fixed companion preserves registration authority, numeric/menu save and one Undo/Redo group', {skip: !nativeAvailable}, async t => {
  const f = nativeFixture();t.after(() => f.close());const authority = f.declaration();let context;let captured;let stopped = 0;
  const remove = f.registry.registerPreview({extensionId: 'native', opcodes: ['native_fixed'],
    mount: (_e, c, s) => {context = c;captured = s;return () => stopped++;}});
  assert.equal(f.declaration(), authority);const s = f.registry.open(f.reference, f.host);assert(s);s.mount(f.dom.window.document.body);
  assert.equal(captured.fixedContext.contractId, 'native.fixed');
  const draft = context.getDraft();draft.inputs.NUMBER = {value: 25, changed: true, buffer: '25'};
  draft.inputs.MENU = {value: 'second', changed: true};context.setDraft(draft);
  assert.equal(f.vmValue('NUMBER'), '10');assert.equal((await s.save()).status, 'saved');assert.equal(stopped, 1);
  assert.equal(f.vmValue('NUMBER'), '25');assert.equal(f.vmValue('MENU'), 'second');
  await new Promise(resolve => setTimeout(resolve, 10));
  const groups = new Set(f.workspace.undoStack_.map(e => e.group));assert.equal(groups.size, 1);
  f.workspace.undo(false);await new Promise(resolve => setTimeout(resolve, 10));assert.equal(f.vmValue('NUMBER'), '10');
  f.workspace.undo(true);await new Promise(resolve => setTimeout(resolve, 10));assert.equal(f.vmValue('NUMBER'), '25');
  const next = f.registry.open(f.reference, f.host);next.mount(f.dom.window.document.body);remove();assert.equal(next.getState().status, 'disposed');
  assert.equal(stopped, 2);assert.equal(f.declaration(), authority);
});


test('aggregate companion snapshots stay tied to each node and unrelated registrations retain the shared scope', t => {
  const dom = domFor(t);const registry = new EditorRegistry();const shown = [];
  registry.register(definition({opcodes: ['story_scene', 'story_action']}));
  const remove = registry.registerPreview(preview({opcodes: ['story_scene', 'story_action'],
    mount: (_e, context, block) => {shown.push({context, block});return () => {};}}));
  const root = snapshot();const child = {...snapshot(), blockId: 'child', opcode: 'story_action'};
  const scope = {...reference, generation: 'project-1', nodes: [
    {block: root, branches: [{input: 'SUBSTACK', blockIds: ['child']}]}, {block: child, branches: []}
  ]};
  const host = {readBlock: () => root, commit() {}, descendants: {
    capability: 'descendant-editing-v1', readSubtree: () => scope, commitSubtree() {}
  }};
  const session = registry.openDescendants(reference, host);assert(session);
  for (const node of session.getNodes()) {
    const element = dom.window.document.createElement('div');dom.window.document.body.appendChild(element);
    session.getEditor(node.reference.blockId).mount(element);
  }
  assert.deepEqual(shown.map(x => x.block.blockId), ['block', 'child']);
  shown[1].context.setDraft({value: 'child-draft'});assert.equal(shown[0].context.getDraft().value, 'old');
  const removeOther = registry.registerPreview({extensionId: 'other', opcodes: ['other_action'], mount: () => () => {}});
  assert.equal(session.getState().status, 'editing');removeOther();assert.equal(session.getState().status, 'editing');
  remove();assert.equal(session.getState().status, 'invalidated');
});

test('native bridge releases hover on leave, opening, project changes, registration changes and disposal', {skip: !nativeAvailable}, t => {
  const f = nativeFixture();t.after(() => f.close());const {B, block, workspace, dom} = f;
  B.Events.disable();const icon = new B.FieldImage('data:image/svg+xml,<svg/>', 40, 40, '');
  block.appendDummyInput('ICON').appendField(icon);block.moveInputBefore('ICON', 'TEXT');B.Events.enable();
  icon.fieldGroup_ = dom.window.document.createElement('div');icon.imageElement_ = {tooltip: 'original'};
  icon.setTooltip = value => {icon.imageElement_.tooltip = value;};B.hideChaff = () => {};
  const listeners = new Set();let hovered = 0;let stopped = 0;let session;
  f.registry.registerPreview({extensionId: 'native', opcodes: ['native_fixed'], mount: () => () => {},
    hover: (_anchor, snapshot) => {assert.equal(snapshot.blockId, block.id);hovered++;return () => stopped++;}});
  const bridge = attachTurboWarpBlockEditors({enabled: true, fixedInputs: true, ScratchBlocks: B, workspace, vm: f.vm,
    service: {registry: f.registry, subscribe: listener => {listeners.add(listener);return () => listeners.delete(listener);}},
    label: 'Preview', canOpen: () => true, onOpen: value => {session = value;}, onError: error => {throw error;}});
  t.after(() => bridge.dispose());
  const enter = () => icon.fieldGroup_.dispatchEvent(new dom.window.Event('pointerenter'));
  enter();assert.equal(hovered, 1);icon.fieldGroup_.dispatchEvent(new dom.window.Event('pointerleave'));assert.equal(stopped, 1);
  enter();icon.fieldGroup_.dispatchEvent(new dom.window.KeyboardEvent('keydown', {key: 'Enter', bubbles: true, cancelable: true}));
  assert.equal(stopped, 2);assert(session);enter();assert.equal(hovered, 2);session.cancel();
  enter();f.vm.emit('targetsUpdate');assert.equal(stopped, 3);
  enter();for (const listener of listeners) listener();assert.equal(stopped, 4);
  enter();bridge.dispose();bridge.dispose();assert.equal(stopped, 5);assert.equal(icon.imageElement_.tooltip, 'original');
});


test('preview roots open only their own scene/action session even with descendant editing enabled', () => {
  let single = 0;let aggregate = 0;
  const registry = {resolveFixed: () => undefined, resolvePreview: opcode => opcode === 'story_scene' ? {} : undefined,
    open: () => {single++;return 'single';}, openDescendants: () => {aggregate++;return 'aggregate';}};
  const host = {readBlock: () => snapshot(), descendants: {
    capability: 'descendant-editing-v1', readSubtree() {}, commitSubtree() {}
  }};
  assert.equal(openBlockEditorSession({registry, reference, host, descendants: true}), 'single');
  assert.equal(single, 1);assert.equal(aggregate, 0);
  registry.resolvePreview = () => undefined;
  assert.equal(openBlockEditorSession({registry, reference, host, descendants: true}), 'aggregate');
  assert.equal(single, 1);assert.equal(aggregate, 1);
});


test('companion layout mounts real form controls in an independent column and removes its complete body on close', t => {
  const dom = domFor(t);const registry = new EditorRegistry();let input;let button;let context;
  registry.register(definition({mount(container, view) {
    context = view;input = dom.window.document.createElement('input');input.value = view.getDraft().value;
    input.addEventListener('input', () => view.setDraft({value: input.value}));container.appendChild(input);
    return () => input.remove();
  }}));
  registry.registerPreview(preview({mount(container, view) {
    button = dom.window.document.createElement('button');button.textContent = 'Replay';container.appendChild(button);
    const stop = view.subscribe(() => {if (view.getState().status === 'editing') button.dataset.value = view.getDraft().value;});
    return () => {stop();button.remove();};
  }}));
  const f = sessionFixture(registry);const s = f.open();const mount = dom.window.document.getElementById('mount');s.mount(mount);
  const layout = mount.querySelector('[data-block-preview-layout]');assert(layout);
  assert.equal(input.parentElement, layout.querySelector('[data-block-preview-form]'));
  assert.equal(button.parentElement, layout.querySelector('[data-block-preview-visual]'));
  input.value = 'edited with preview visible';input.dispatchEvent(new dom.window.Event('input'));
  assert.equal(button.dataset.value, 'edited with preview visible');assert.equal(context.getDraft().value, input.value);
  assert.equal(f.writes.length, 0);s.cancel();assert.equal(mount.childNodes.length, 0);
  assert.equal(input.isConnected, false);assert.equal(button.isConnected, false);
});

test('a form without a preview retains its original mount and receives no companion layout', t => {
  const dom = domFor(t);const registry = new EditorRegistry();let mounted;
  registry.register(definition({mount(container) {mounted = container;return () => {};}}));
  const f = sessionFixture(registry);const s = f.open();const mount = dom.window.document.getElementById('mount');s.mount(mount);
  assert.equal(mounted, mount);assert.equal(mount.querySelector('[data-block-preview-layout]'), null);s.cancel();
});
