import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {createRequire} from 'node:module';
import {JSDOM} from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {pretendToBeVisual: true});
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Node',
  'requestAnimationFrame', 'cancelAnimationFrame']) {
  Object.defineProperty(globalThis, name, {value: dom.window[name], configurable: true});
}
Object.defineProperty(globalThis, 'MessageChannel', {value: undefined, configurable: true});
after(() => dom.window.close());
const require = createRequire(import.meta.url);
const React = require('react');
const ReactDOM = require('react-dom');
const {act} = require('react-dom/test-utils');
const {BlockEditorDialog} = await import('../dist/react.js');

const messages = {title: 'ブロックを編集', saving: '保存中', cancel: 'キャンセル', save: '保存',
  saveAll: 'すべて保存', structureError: '構造エラー', conflict: '競合', failed: '失敗', structuralNode: '構造'};

test('dialog titles identify the edited block and pass its icon to the host modal', async t => {
  for (const [title, expected, name = 'データを設定'] of [
    ['ブロックを編集', 'データを設定を編集'], ['Edit block', 'Edit データを設定'],
    ['{name}の編集', 'データを設定の編集'],
    ['ブロックを編集', 'asset (Turtle) = JSONを編集', 'asset (Turtle) = JSON'],
    ['Edit block', 'Edit asset (Turtle) = JSON', 'asset (Turtle) = JSON']
  ]) {
    let modalProps;
    const session = {reference: {blockId: 'root'},
      getState: () => ({status: 'editing', canSave: true, issues: [], error: null}),
      subscribe: () => () => {}, mount: () => () => {}, dispose: () => true};
    const container = document.createElement('div');
    t.after(() => container.remove());
    const Modal = props => { modalProps = props; return React.createElement('div', null, props.children); };
    await act(async () => { ReactDOM.render(React.createElement(BlockEditorDialog, {
      session, ModalComponent: Modal, messages: {...messages, title}, styles: {header: 'editor-header'}, onClose: () => {},
      nodeAppearances: {root: {name, iconURI: 'data:image/svg+xml,icon'}}
    }), container); });
    assert.equal(modalProps.contentLabel, expected);
    assert.equal(modalProps.headerImage, 'data:image/svg+xml,icon');
    assert.equal(modalProps.headerClassName, 'editor-header');
    await act(async () => { ReactDOM.unmountComponentAtNode(container); });
  }
});

test('dialog uses the root label in a hierarchy and retains the generic title without metadata', async t => {
  const container = document.createElement('div');
  t.after(() => container.remove());
  for (const hierarchy of [false, true]) {
    let modalProps;
    const session = {
      getState: () => ({status: 'editing', canSave: false, issues: [], error: null}),
      subscribe: () => () => {}, mount: () => () => {}, dispose: () => true,
      ...(hierarchy ? {getNodes: () => [
        {reference: {blockId: 'child'}, opcode: 'child_opcode', inputPath: [{blockId: 'root'}]},
        {reference: {blockId: 'root'}, opcode: 'root_opcode', inputPath: []}
      ], getEditor: () => undefined} : {})
    };
    const Modal = props => { modalProps = props; return React.createElement('div', null, props.children); };
    await act(async () => { ReactDOM.render(React.createElement(BlockEditorDialog, {
      session, ModalComponent: Modal, messages, styles: {}, onClose: () => {},
      nodeLabels: {root: '親ブロック', child: '子ブロック'}
    }), container); });
    assert.equal(modalProps.contentLabel, hierarchy ? '親ブロックを編集' : 'ブロックを編集');
    assert.equal(modalProps.headerImage, undefined);
    await act(async () => { ReactDOM.unmountComponentAtNode(container); });
  }
});

test('the save button reads Update once the block differs from its defaults, with the reason it is disabled', async t => {
  const labels = {...messages, update: '更新', noChanges: '変更はありません', fixToSave: '{count}件の問題を直すと保存できます'};
  const cases = [
    [{saveMode: 'save', unchanged: true, canSave: true, issues: []}, '保存', null],
    [{saveMode: 'update', unchanged: true, canSave: false, issues: []}, '更新', '変更はありません'],
    [{saveMode: 'update', unchanged: false, canSave: false, issues: [{message: 'a'}, {message: 'b'}]}, '更新', '2件の問題を直すと保存できます'],
    [{canSave: true, issues: []}, '保存', null]
  ];
  for (const [state, label, reason] of cases) {
    const session = {reference: {blockId: 'root'}, getState: () => ({status: 'editing', error: null, ...state}),
      subscribe: () => () => {}, mount: () => () => {}, dispose: () => true};
    const container = document.createElement('div');
    t.after(() => container.remove());
    const Modal = props => React.createElement('div', null, props.children);
    await act(async () => { ReactDOM.render(React.createElement(BlockEditorDialog, {
      session, ModalComponent: Modal, messages: labels, styles: {}, onClose: () => {}}), container); });
    assert.equal(container.querySelector('[data-block-editor-save]').textContent, label);
    assert.equal(container.querySelector('[data-block-editor-save-reason]')?.textContent ?? null, reason);
    await act(async () => { ReactDOM.unmountComponentAtNode(container); });
  }
});

test('a hierarchy pane sits beside the tree and follows the node the reader picks', async t => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  t.after(() => container.remove());
  const nodes = [
    {reference: {blockId: 'root'}, opcode: 'story_scene', inputPath: []},
    {reference: {blockId: 'child'}, opcode: 'story_action', inputPath: [{blockId: 'root', input: 'SUBSTACK', index: 0}]}
  ];
  const contexts = Object.fromEntries(nodes.map(node => [node.reference.blockId, {
    reference: node.reference, getDraft: () => ({}), setDraft: () => {},
    getState: () => ({status: 'editing', issues: []}), subscribe: () => () => {},
    getSnapshot: () => ({blockId: node.reference.blockId, opcode: node.opcode, arguments: {}}),
    mount: () => () => {}
  }]));
  const mounted = [];
  let release = 0;
  const session = {
    getState: () => ({status: 'editing', canSave: true, issues: [], error: null}),
    subscribe: () => () => {}, dispose: () => true,
    getNodes: () => nodes,
    getEditor: blockId => contexts[blockId],
    getNodeSnapshot: blockId => contexts[blockId]?.getSnapshot(),
    getPreview: () => ({
      extensionId: 'story', opcodes: ['story_scene'],
      mount: (host, context, snapshot, selection) => {
        mounted.push({host, context, snapshot, selection});
        return () => { release += 1; };
      }
    })
  };
  const Modal = props => React.createElement('div', null, props.children);
  const styles = {hierarchyLayout: 'hierarchy-layout', previewColumn: 'preview-column', treeNode: 'tree-node'};
  await act(async () => { ReactDOM.render(React.createElement(BlockEditorDialog, {
    session, ModalComponent: Modal, messages, styles, onClose: () => {}
  }), container); });

  // One pane for the whole dialog, in its own column beside the tree.
  assert.equal(mounted.length, 1);
  const layout = container.querySelector('[data-block-editor-hierarchy-layout]');
  assert(layout);
  assert.equal(layout.className, 'hierarchy-layout');
  assert.equal(layout.children.length, 2);
  assert.equal(mounted[0].host, layout.children[1]);
  assert.equal(mounted[0].host.className, 'preview-column');
  assert.equal(mounted[0].snapshot.blockId, 'root');

  // The selection starts on the opened block and reports its depth.
  const selection = mounted[0].selection;
  assert.deepEqual(
    {blockId: selection.get().snapshot.blockId, depth: selection.get().depth},
    {blockId: 'root', depth: 0}
  );
  assert.equal(selection.get().context, contexts.root);

  let notified = 0;
  const stop = selection.subscribe(() => { notified += 1; });
  const heading = container.querySelector('[data-block-editor-toggle="child"]');
  assert(heading);
  await act(async () => { heading.click(); });
  assert.equal(notified, 1);
  assert.equal(selection.get().snapshot.blockId, 'child');
  assert.equal(selection.get().context, contexts.child);
  assert.equal(selection.get().depth, 1);
  assert.equal(heading.getAttribute('aria-current'), 'true');
  assert.equal(
    container.querySelector('[data-block-editor-node="child"]').getAttribute('data-block-editor-selected'),
    'true'
  );
  // The pane is mounted once; picking another node never remounts it.
  assert.equal(mounted.length, 1);
  stop();
  await act(async () => { heading.click(); });
  assert.equal(notified, 1);

  await act(async () => { ReactDOM.unmountComponentAtNode(container); });
  assert.equal(release, 1);
});
