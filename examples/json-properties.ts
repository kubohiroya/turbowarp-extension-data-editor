import {EDITOR_API_VERSION} from '../dist/index.js';

// An editor body for a managed extension; the GUI supplies its modal and footer.
export const jsonPropertiesEditor = {
  apiVersion: EDITOR_API_VERSION,
  extensionId: 'story',
  editorId: 'scene-properties',
  opcodes: ['story_scene'],
  editableArguments: ['PROPERTIES'],
  read(snapshot) {
    const slot = snapshot.arguments.PROPERTIES;
    if (slot?.kind !== 'literal' || typeof slot.value !== 'string') {
      throw new TypeError('PROPERTIES must be a literal JSON string.');
    }
    return {properties: slot.value};
  },
  validate(draft) {
    try {
      if (typeof draft.properties !== 'string') throw new TypeError();
      const parsed = JSON.parse(draft.properties);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new TypeError();
      }
      return [];
    } catch {
      return [{path: 'properties', message: 'JSON オブジェクトを入力してください。'}];
    }
  },
  createPatch(draft) {
    return [{argument: 'PROPERTIES', value: draft.properties}];
  },
  mount(container, context) {
    const document = container.ownerDocument;
    const label = document.createElement('label');
    label.textContent = 'プロパティ（JSON）';
    const input = document.createElement('textarea');
    input.value = context.getDraft().properties;
    input.rows = 10;
    label.append(input);
    container.append(label);
    const onInput = () => context.setDraft({properties: input.value});
    const sync = () => { input.disabled = context.getState().status !== 'editing'; };
    input.addEventListener('input', onInput);
    const unsubscribe = context.subscribe(sync);
    sync();
    return () => {
      unsubscribe();
      input.removeEventListener('input', onInput);
      label.remove();
    };
  }
};
