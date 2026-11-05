import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import ReactDOMServer from 'react-dom/server.js';
const {renderToStaticMarkup} = ReactDOMServer;
import {BlockEditorDialog} from '../dist/react.js';
const messages = {title: 'Editor', saving: 'Saving', cancel: 'Cancel', save: 'Save', saveAll: 'Save all',
  structureError: 'Structure changed', conflict: 'Conflict', failed: 'Save failed', structuralNode: 'Block', invalidInput: '値を確認してください'};
const issue = {path: '/VALUE', message: 'Fixed input validation failed: private-contract; contract="private-id".'};
const session = fixed => ({
  getState: () => ({status: 'editing', canSave: false, issues: [issue], error: undefined}),
  subscribe: () => () => {}, save: async () => ({status: 'invalid', issues: [issue]}), cancel: () => true, dispose: () => true,
  ...(fixed ? {getFixedInputView: () => ({inputs: {}, branches: [], issues: [issue]})} : {})
});
const markup = instance => renderToStaticMarkup(React.createElement(BlockEditorDialog, {
  session: instance, messages, styles: {}, onClose() {}, ModalComponent: ({children}) => React.createElement('section', null, children)
}));
test('fixed dialog displays a localized validation summary while preserving diagnostic API data', () => {
  const fixed = session(true);const html = markup(fixed);
  assert(html.includes(messages.invalidInput));assert(!html.includes('private-contract'));assert(!html.includes('private-id'));
  assert.equal(fixed.getState().issues[0], issue);
});
test('legacy dialog retains its original issue presentation without the fixed view capability', () => {
  assert(markup(session(false)).includes('private-contract'));
});
