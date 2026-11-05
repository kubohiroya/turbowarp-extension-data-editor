import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync, existsSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import ts from 'typescript';
import {createBlockEditorService} from '../dist/rjsf.js';

const appRoot = process.env.BLOCK_PREVIEW_APP_ROOT;
const available = Boolean(appRoot && existsSync(join(appRoot, 'src/dsl4/platform/block-icon-preview-editor.ts')));
async function fixture(command, overrides = {}) {
  const source = readFileSync(join(appRoot, 'src/dsl4/platform/block-icon-preview-editor.ts'), 'utf8')
    .replace("from '../core-action-block-codec.js'", `from '${pathToFileURL(join(appRoot, 'dist/dsl4/core-action-block-codec.js')).href}'`)
    .replace(/^import \{createDsl4BlockIconPreviewRuntime\} from .*;\r?\n/m, '');
  const javascript = ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext}}).outputText;
  const editor = await import('data:text/javascript;base64,' + Buffer.from(javascript).toString('base64'));
  const service = createBlockEditorService({fixedInputs: true});
  const stop = editor.installDsl4BlockIconPreviews({Scratch: {vm: {}, gui: {blockEditors: service.api}}, sourceFrontend: {},
    createRuntime: () => ({open() {throw new Error('The schema contract smoke does not create a renderer.');}})});
  const opcode = 'kubohiroyakamishibairuntime4_' + command;
  const declaration = service.registry.resolveFixed(opcode);assert(declaration);
  const defaults = command === 'show' ? {TARGET: 'Actor', SKIN: 'Skin', X: '0', Y: '0', SCALE: '100'}
    : command === 'moveTo' ? {TARGET: 'Actor', X: '0', Y: '0', SECONDS: '1', EASING: 'linear'}
      : {TARGET: 'Actor', SKIN: 'Skin', SCALE: ''};
  const values = {...defaults, ...overrides};
  const live = {targetId: 'target', blockId: 'block', opcode, revision: '1',
    arguments: Object.fromEntries(Object.entries(values).map(([name, value]) => [name,
      value === null ? {kind: 'reporter'} : {kind: 'literal', value}])),
    fixedContext: {...declaration, generation: 'project-1',
      inputs: Object.fromEntries(Object.entries(values).map(([name, value]) => [name, value === null
        ? {role: 'editable', source: 'reporter', identity: name}
        : {role: 'editable', source: 'shadow', identity: name, field: {blockId: name + '-shadow', name: 'TEXT', type: 'FieldTextInput'}}]))}};
  const writes = [];
  const host = {readBlock: () => live, commit() {throw new Error('Fixed writes must use the fixed port.');}, fixedInputs: {
    capability: 'fixed-inputs-v1', readBlock: () => live, commit: request => {
      assert(request.changes.every(change => typeof change.value === 'string'), 'Native fixed field writes require string tokens.');
      writes.push(request);
      for (const change of request.changes) live.arguments[change.argument] = {kind: 'literal', value: change.value};}
  }};
  const session = service.registry.open(live, host);assert(session);
  return {session, editor, writes, stop, open: () => service.registry.open(live, host)};
}
const contractTest = (name, fn) => test(name, {skip: available ? false : 'Supply BLOCK_PREVIEW_APP_ROOT for the app/common fixed-input contract smoke.'}, fn);

contractTest('app show placement uses real fixed schemas and preserves numeric input tokens on save', async t => {
  const f = await fixture('show');t.after(f.stop);
  const draft = f.session.getDraft();draft.inputs.X = {value: -180.25, buffer: '-180.25', changed: true};
  draft.inputs.SCALE = {value: 125.5, changed: true};f.session.setDraft(draft);
  assert.deepEqual(f.editor.dsl4BlockPreviewDraftChanges('show', draft), {X: '-180.25', SCALE: 125.5});
  assert.equal((await f.session.save()).status, 'saved');
  assert.deepEqual(f.writes[0].changes, [{argument: 'X', value: '-180.25'}, {argument: 'SCALE', value: '125.5'}]);
});

contractTest('app moveTo shares numeric/menu edits and rejects invalid duration before committing', async t => {
  const f = await fixture('moveTo');t.after(f.stop);
  let draft = f.session.getDraft();draft.inputs.SECONDS = {value: -1, buffer: '-1', changed: true};
  f.session.setDraft(draft);assert.equal((await f.session.save()).status, 'invalid');assert.equal(f.writes.length, 0);
  draft.inputs.SECONDS = {value: 0.35, buffer: '0.350', changed: true};draft.inputs.EASING = {value: 'easeInOut', changed: true};
  f.session.setDraft(draft);assert.equal((await f.session.save()).status, 'saved');
  assert.deepEqual(f.writes[0].changes, [{argument: 'SECONDS', value: '0.350'}, {argument: 'EASING', value: 'easeInOut'}]);
});

contractTest('app setSkin optional scale supports unchanged empty, new numeric value and clearing it again', async t => {
  const f = await fixture('setSkin');t.after(f.stop);
  assert.equal(f.session.getDraft().inputs.SCALE.value, '');assert.deepEqual(await f.session.save(), {status: 'saved', changed: false});
  let s = f.open();let draft = s.getDraft();draft.inputs.SCALE = {value: '130', changed: true};s.setDraft(draft);
  assert.equal((await s.save()).status, 'saved');assert.equal(f.writes[0].changes[0].value, '130');
  s = f.open();draft = s.getDraft();draft.inputs.SCALE = {value: '', changed: true};s.setDraft(draft);
  assert.equal((await s.save()).status, 'saved');assert.equal(f.writes[1].changes[0].value, '');
});

contractTest('app invalid numeric buffers and connected reporters never become placement writes', async t => {
  const f = await fixture('show', {X: null});t.after(f.stop);
  const draft = f.session.getDraft();assert.equal(draft.inputs.X.readOnly, true);
  assert.equal(f.session.getFixedInputView().inputs.X.state, 'readonly');
  draft.inputs.SCALE = {value: 1, buffer: '1e', changed: true};f.session.setDraft(draft);
  assert.throws(() => f.editor.dsl4BlockPreviewDraftChanges('show', draft), /数値/);
  assert.equal((await f.session.save()).status, 'invalid');assert.equal(f.writes.length, 0);f.session.cancel();
});
