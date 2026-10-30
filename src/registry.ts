import {captureReference, captureSnapshot} from './data.js';
import type {BlockPreviewDefinition} from './types.js';
import {withBlockPreview} from './preview.js';
import {EditorSession} from './session.js';
import {DescendantSession} from './descendants.js';
import {supportsDescendantEditing} from './descendant-types.js';
import type {DescendantLimits} from './descendant-types.js';
import {captureSubtree, descendantLimits} from './subtree.js';
import {EDITOR_API_VERSION} from './types.js';
import type {BlockEditorHost, BlockReference, EditorDefinition, EditorDescriptor} from './types.js';
import type {PreparedEditorDefinition} from './prepared-types.js';
import {isPreparedEditor} from './prepared-save.js';
import {isFixedInputEditor, captureFixedInputEditorDefinition} from './fixed-input-editor.js';
import {captureFixedInputDeclaration, captureFixedSnapshot} from './fixed-input-snapshot.js';
import {supportsFixedInputEditing} from './fixed-input-types.js';
import type {FixedInputDeclaration, FixedInputEditorDefinition} from './fixed-input-types.js';

export class EditorRegistry {
  #previews = new Map<string, BlockPreviewDefinition>();
  #editors = new Map<string, EditorDefinition>();
  #opcodes = new Map<string, EditorDefinition>();
  #fixedDeclarations = new Map<EditorDefinition, FixedInputDeclaration>();
  #changes = new Set<() => void>();

  registerPreview(definition: BlockPreviewDefinition): () => void {
    if (!definition || !/^[a-z0-9]+$/i.test(definition.extensionId) ||
        !Array.isArray(definition.opcodes) || !definition.opcodes.length ||
        new Set(definition.opcodes).size !== definition.opcodes.length ||
        definition.opcodes.some(op => typeof op !== 'string' || !op.startsWith(`${definition.extensionId}_`) ||
          op === `${definition.extensionId}_` || this.#previews.has(op)) ||
        typeof definition.mount !== 'function' ||
        (definition.hover !== undefined && typeof definition.hover !== 'function')) {
      throw new TypeError('Invalid or duplicate block preview.');
    }
    const entry = Object.freeze({...definition, opcodes: Object.freeze([...definition.opcodes])});
    for (const op of entry.opcodes) this.#previews.set(op, entry);
    this.#notifyChanges();
    return () => {
      if (this.#previews.get(entry.opcodes[0]!) !== entry) return;
      for (const op of entry.opcodes) this.#previews.delete(op);
      this.#notifyChanges();
    };
  }

  resolvePreview(opcode: string): BlockPreviewDefinition | undefined { return this.#previews.get(opcode); }

  #definition(opcode: string): EditorDefinition | undefined {
    const original = this.#opcodes.get(opcode);
    const preview = this.#previews.get(opcode);
    return preview ? withBlockPreview(original, preview, opcode) : original;
  }

  register(definition: EditorDefinition): () => void {
    if (isFixedInputEditor(definition)) throw new TypeError('Fixed input editors require registerFixed().');
    if (isPreparedEditor(definition)) throw new TypeError('Prepared editors require registerPrepared().');
    return this.#register(definition);
  }

  registerPrepared(definition: PreparedEditorDefinition): () => void {
    if (!isPreparedEditor(definition) || typeof definition.prepareSave !== 'function') {
      throw new TypeError('Expected a prepared source editor.');
    }
    return this.#register(definition);
  }

  registerFixed<C = null>(definition: FixedInputEditorDefinition<C>): () => void {
    return this.#register(captureFixedInputEditorDefinition(definition));
  }

  #register(definition: EditorDefinition): () => void {
    if (definition.apiVersion !== EDITOR_API_VERSION) throw new TypeError('Unsupported editor API version.');
    if (!/^[a-z0-9]+$/i.test(definition.extensionId) ||
        !/^[a-z0-9][a-z0-9._-]*$/i.test(definition.editorId)) {
      throw new TypeError('Invalid extension ID or editor ID.');
    }
    if (!Array.isArray(definition.opcodes) || definition.opcodes.length === 0 ||
        new Set(definition.opcodes).size !== definition.opcodes.length ||
        definition.opcodes.some(opcode => typeof opcode !== 'string' ||
          !opcode.startsWith(`${definition.extensionId}_`) || opcode === `${definition.extensionId}_`)) {
      throw new TypeError('Expected distinct full opcodes belonging to the extension.');
    }
    if (!Array.isArray(definition.editableArguments) ||
        new Set(definition.editableArguments).size !== definition.editableArguments.length ||
        definition.editableArguments.some(name => typeof name !== 'string' || !name)) {
      throw new TypeError('Expected distinct editable argument names.');
    }
    if (typeof definition.read !== 'function' || typeof definition.validate !== 'function' ||
        typeof definition.createPatch !== 'function' ||
        (definition.mount !== undefined && typeof definition.mount !== 'function')) {
      throw new TypeError('Invalid editor callbacks.');
    }
    const key = JSON.stringify([definition.extensionId, definition.editorId]);
    if (this.#editors.has(key) || definition.opcodes.some(opcode => this.#opcodes.has(opcode))) {
      throw new Error('The editor ID or an opcode is already registered.');
    }
    const entry = Object.freeze({
      ...definition,
      opcodes: Object.freeze([...definition.opcodes]),
      editableArguments: Object.freeze([...definition.editableArguments])
    });
    if (isFixedInputEditor(entry)) this.#fixedDeclarations.set(entry, captureFixedInputDeclaration(entry));
    this.#editors.set(key, entry);
    for (const opcode of entry.opcodes) this.#opcodes.set(opcode, entry);
    this.#notifyChanges();
    return () => {
      if (this.#editors.get(key) !== entry) return;
      this.#editors.delete(key);
      for (const opcode of entry.opcodes) this.#opcodes.delete(opcode);
      this.#fixedDeclarations.delete(entry);
      this.#notifyChanges();
    };
  }

  resolve(opcode: string): EditorDescriptor | undefined {
    const entry = this.#definition(opcode);
    if (!entry) return undefined;
    return Object.freeze({
      apiVersion: entry.apiVersion, extensionId: entry.extensionId, editorId: entry.editorId,
      opcodes: entry.opcodes, editableArguments: entry.editableArguments
    });
  }

  /** Stable, callback-free authority for this exact registration, never caller metadata. */
  resolveFixed(opcode: string): FixedInputDeclaration | undefined {
    const entry = this.#opcodes.get(opcode);
    return entry ? this.#fixedDeclarations.get(entry) : undefined;
  }

  open(reference: BlockReference, host: BlockEditorHost): EditorSession | undefined {
    const capturedReference = captureReference(reference);
    const live = host.readBlock(capturedReference);
    if (!live) return undefined;
    const entry = this.#definition(live.opcode);
    if (!entry) {
      // Preserve legacy snapshot validation even when no editor is registered.
      captureSnapshot(live, capturedReference);
      return undefined;
    }
    if (isFixedInputEditor(entry)) {
      if (!supportsFixedInputEditing(host)) return undefined;
      const fixed = host.fixedInputs!.readBlock(capturedReference, entry);
      if (!fixed || fixed.opcode !== live.opcode) return undefined;
      const snapshot = captureFixedSnapshot(fixed, capturedReference, entry);
      return new EditorSession(entry, snapshot, host, () => this.#definition(snapshot.opcode) === entry, listener => {
        this.#changes.add(listener);
        return () => {this.#changes.delete(listener);};
      });
    }
    const snapshot = captureSnapshot(live, capturedReference);
    return new EditorSession(entry, snapshot, host, isPreparedEditor(entry) || this.#previews.has(snapshot.opcode)
      ? () => this.#definition(snapshot.opcode) === entry : undefined);
  }

  openDescendants(reference: BlockReference, host: BlockEditorHost, limits?: DescendantLimits): DescendantSession | undefined {
    if (!supportsDescendantEditing(host)) return undefined;
    const port = host.descendants;
    const capturedReference = captureReference(reference);
    const resolvedLimits = descendantLimits(limits);
    const live = port.readSubtree(capturedReference);
    if (!live) return undefined;
    const captured = captureSubtree(live, capturedReference, resolvedLimits);
    const root = this.#definition(captured.snapshot.nodes[0]!.block.opcode);
    if (!root || isFixedInputEditor(root)) return undefined;
    return new DescendantSession(captured, port, opcode => {
      const entry = this.#definition(opcode);
      return entry && !isFixedInputEditor(entry) ? entry : undefined;
    }, listener => {
      this.#changes.add(listener);
      return () => { this.#changes.delete(listener); };
    }, resolvedLimits);
  }

  #notifyChanges(): void {
    for (const listener of [...this.#changes]) listener();
  }
}
