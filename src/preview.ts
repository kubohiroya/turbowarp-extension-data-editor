import type {BlockPreviewDefinition, EditorDefinition} from './types.js';

const cache = new WeakMap<BlockPreviewDefinition, Map<string, {original: EditorDefinition | undefined; result: EditorDefinition}>>();

/** Compose presentation only; the original definition retains sole authority over persistence. */
export function withBlockPreview(original: EditorDefinition | undefined, preview: BlockPreviewDefinition, opcode: string): EditorDefinition {
  let entries = cache.get(preview);
  if (!entries) { entries = new Map(); cache.set(preview, entries); }
  const previous = entries.get(opcode);
  if (previous && previous.original === original) return previous.result;
  const fallback: EditorDefinition = {
    apiVersion: 1, extensionId: preview.extensionId, editorId: 'block-preview', opcodes: [opcode], editableArguments: [],
    read: () => ({}), validate: () => [], createPatch: () => []
  };
  const result = Object.freeze({...original ?? fallback, mount(container, context) {
    const snapshot = context.getSnapshot?.();
    if (!snapshot) throw new TypeError('Block preview requires a captured snapshot.');
    const document = container.ownerDocument;
    const layout = document.createElement('div');
    layout.dataset.blockPreviewLayout = '';
    layout.dataset.blockPreviewHasForm = String(typeof original?.mount === 'function');
    const style = document.createElement('style');
    style.textContent = `
      [data-block-preview-layout] {
        display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px;
        min-width: 0; width: 100%; align-items: start;
      }
      [data-block-preview-layout] > [data-block-preview-visual],
      [data-block-preview-layout] > [data-block-preview-form] {
        min-width: 0; max-width: 100%; overflow-wrap: anywhere;
      }
      @media (min-width: 900px) {
        [data-block-preview-layout][data-block-preview-has-form="true"] {
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        }
        [data-block-preview-layout][data-block-preview-has-form="true"] > [data-block-preview-visual] {
          position: sticky; top: 0; align-self: start;
        }
      }
    `;
    const visual = document.createElement('div');
    visual.dataset.blockPreviewVisual = '';
    const form = document.createElement('div');
    form.dataset.blockPreviewForm = '';
    form.hidden = typeof original?.mount !== 'function';
    layout.append(visual, form);
    container.append(style, layout);
    const removeLayout = () => { layout.remove(); style.remove(); };
    let removeForm: (() => void) | undefined;
    let removePreview: (() => void) | undefined;
    try {
      if (original?.mount) {
        const cleanup = original.mount(form, context);
        if (typeof cleanup !== 'function') throw new TypeError('mount() must return a cleanup function.');
        removeForm = cleanup;
      }
      const cleanup = preview.mount(visual, context, snapshot);
      if (typeof cleanup !== 'function') throw new TypeError('preview.mount() must return a cleanup function.');
      removePreview = cleanup;
    } catch (error) {
      try { removePreview?.(); } finally { try { removeForm?.(); } finally { removeLayout(); } }
      throw error;
    }
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      try { removePreview?.(); } finally { try { removeForm?.(); } finally { removeLayout(); } }
    };
  }} satisfies EditorDefinition);
  entries.set(opcode, {original, result});
  return result;
}
