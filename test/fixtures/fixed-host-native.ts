import {readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import {EditorRegistry} from '../../dist/index.js';
import {createFixedInputEditor} from '../../dist/rjsf.js';
import createBlockEditorHost from '../../dist/turbowarp/host.js';

export const guiRoot = process.env.BLOCK_EDITOR_GUI_ROOT;
export const nativeAvailable = Boolean(guiRoot && existsSync(join(guiRoot, 'node_modules/scratch-vm/src/engine/blocks.js')));
const require = createRequire(import.meta.url);
const fieldNames = {TEXT: 'TEXT', NUMBER: 'NUM', MENU: 'CHOICE', DIRECT: 'DIRECT', COLOR: 'COLOUR', CONDITION: 'TEXT'};
const childIds = {TEXT: 'native-text', NUMBER: 'native-number', MENU: 'native-menu', COLOR: 'native-color', CONDITION: 'native-condition'};

function schemaBundle(type) {
  const source = {repository: 'native-fixture', path: `${type}.schema.json`};
  return {identity: {ownerId: 'native', contractId: type, revision: '1', variantId: 'default'}, dialect: 'draft-07',
    root: {retrievalUri: `https://fixture.invalid/${type}`, document: {type}, artifact: {role: 'canonical-schema', source}},
    resources: [], provenance: {canonicalSources: [source], generatedFiles: [], referenceSchemas: [], generationSources: []}};
}

export function nativeFixture({enableFixedInputs = true, dependencies = [], branchPolicies} = {}) {
  if (!nativeAvailable) throw new Error('BLOCK_EDITOR_GUI_ROOT must supply actual ScratchBlocks and Scratch VM.');
  const root = join(guiRoot, 'node_modules');
  const {JSDOM} = require('jsdom');
  const Blocks = require(join(root, 'scratch-vm/src/engine/blocks.js'));
  const adapter = require(join(root, 'scratch-vm/src/engine/adapter.js'));
  const dom = new JSDOM('<html><body></body></html>', {runScripts: 'outside-only'});
  const files = ['blockly_compressed_vertical.js', 'blocks_compressed.js', 'blocks_compressed_vertical.js', 'msg/js/en.js'];
  dom.window.eval(files.map(path => readFileSync(join(root, 'scratch-blocks', path), 'utf8')).join('\n') + '\nglobalThis.ScratchBlocks=Blockly;');
  const B = dom.window.ScratchBlocks;
  B.Blocks.native_fixed = {init() {
    this.appendValueInput('TEXT'); this.appendValueInput('NUMBER'); this.appendValueInput('MENU');
    this.appendDummyInput().appendField(new B.FieldDropdown([['first', 'first'], ['second', 'second']]), 'DIRECT');
    this.appendValueInput('COLOR'); this.appendValueInput('CONDITION'); this.setPreviousStatement(true); this.setNextStatement(true);
  }};
  B.Blocks.native_menu_static = {init() {
    this.appendDummyInput().appendField(new B.FieldDropdown([['first', 'first'], ['second', 'second']]), 'CHOICE'); this.setOutput(true);
  }};
  B.Blocks.native_reporter = {init() {this.appendDummyInput().appendField('not evaluated'); this.setOutput(true);}};
  B.Events.disable();
  const workspace = new B.Workspace();
  const xml = B.Xml.textToDom(`<xml><block type="native_fixed" id="native-root">
    <value name="TEXT"><shadow type="text" id="native-text"><field name="TEXT">old</field></shadow></value>
    <value name="NUMBER"><shadow type="math_number" id="native-number"><field name="NUM">10</field></shadow></value>
    <value name="MENU"><shadow type="native_menu_static" id="native-menu"><field name="CHOICE">first</field></shadow></value>
    <value name="COLOR"><shadow type="colour_picker" id="native-color"><field name="COLOUR">#112233</field></shadow></value>
    <value name="CONDITION"><shadow type="text" id="native-condition"><field name="TEXT">ready</field></shadow></value>
  </block></xml>`);
  const block = B.Xml.domToBlock(xml.firstChild, workspace);
  const vm = new EventEmitter();let dirty = 0;
  const runtime = {emitProjectChanged() {dirty++;}, getTargetForStage: () => null,
    getEditingTarget: () => vm.editingTarget, emit() {}, targets: [], requestBlocksUpdate() {}};
  const blocks = new Blocks(runtime); vm.runtime = runtime; vm.editingTarget = {id: 'native-target', blocks}; runtime.targets = [vm.editingTarget];
  for (const value of adapter({xml: B.Xml.blockToDom(block)})) blocks.createBlock(value);
  dirty = 0;
  const events = [];
  workspace.addChangeListener(event => {events.push(event); blocks.blocklyListen(event);});
  B.Events.enable();workspace.clearUndo();
  const registry = new EditorRegistry();
  const options = {apiVersion: 1, extensionId: 'native', editorId: 'fixed', opcodes: ['native_fixed'],
    contractId: 'native.fixed', contractRevision: '1', readOnlyArguments: ['CONDITION'], dependencies,
    ...(branchPolicies === undefined ? {} : {branchPolicies}),
    bindings: ['TEXT', 'NUMBER', 'MENU', 'DIRECT', 'COLOR'].map(argument => ({argument,
      schemaBundle: schemaBundle(argument === 'NUMBER' ? 'number' : 'string'),
      read: value => argument === 'NUMBER' ? Number(value) : String(value), encode: value => String(value), validateCandidate: () => []})),
    validationContext: () => ({consumerId: 'native', nowMs: 0, settings: null})};
  const definition = createFixedInputEditor(options);let remove = registry.registerFixed(definition);
  const host = createBlockEditorHost({ScratchBlocks: B, workspace, vm, registry, enableFixedInputs, onError: error => {throw error;}});
  const reference = {targetId: 'native-target', blockId: block.id};
  const declaration = () => registry.resolveFixed('native_fixed');
  const read = () => host.fixedInputs.readBlock(reference, declaration());
  const value = argument => workspace.getBlockById(childIds[argument] || block.id).getField(fieldNames[argument]).getValue();
  const vmValue = argument => blocks.getBlock(childIds[argument] || block.id).fields[fieldNames[argument]].value;
  const commit = (changes, extras = {}) => host.fixedInputs.commit({expected: read(), changes,
    context: {consumerId: 'native', nowMs: 0, settings: null}, signal: new AbortController().signal, ...extras});
  const state = () => ({colorState: (() => {const colorBlock = workspace.getBlockById('native-color');const field = colorBlock.getField('COLOUR');
    return {hue: field.hue_, saturation: field.saturation_, brightness: field.brightness_,
      colors: ['getColour', 'getColourSecondary', 'getColourTertiary', 'getColourQuaternary'].map(name => typeof colorBlock[name] === 'function' ? colorBlock[name]() : null)};})(), values: Object.fromEntries(Object.keys(fieldNames).map(key => [key, value(key)])),
    vm: JSON.parse(JSON.stringify(blocks._blocks)), undo: workspace.undoStack_.slice(), redo: workspace.redoStack_.slice(), dirty,
    eventGroup: B.Events.getGroup(), eventsEnabled: B.Events.isEnabled(), recordUndo: B.Events.recordUndo});
  return {B, dom, workspace, vm, runtime, blocks, block, registry, host, reference, definition, declaration, read, value, vmValue, commit, state, events,
    dirty: () => dirty, remove: () => remove(), reregister: () => {remove = registry.registerFixed(definition);},
    close() {host.dispose();B.Events.disable();workspace.dispose();B.Events.enable();dom.window.close();}};
}

export const flushNativeEvents = () => new Promise(resolve => setTimeout(resolve, 30));
