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
