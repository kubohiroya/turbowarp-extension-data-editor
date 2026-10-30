import {captureReference, cloneJson, isLiteral} from './data.js';
import {BlockEditorConflictError} from './types.js';
import {DescendantNodeError} from './descendant-types.js';
import {captureSubtree, sameSubtree} from './subtree.js';
import {EditorView} from './view.js';
import type {CapturedSubtree} from './subtree.js';
import type {
  DescendantEditorHost, DescendantLimits, DescendantNodeDescriptor, DescendantNodeEditor,
  DescendantSaveResult, DescendantSessionState, DescendantSessionStatus,
  SubtreeArgumentChange, SubtreeSnapshot
} from './descendant-types.js';
import type {
  BlockReference, BlockSnapshot, EditorDefinition, JsonObject, SessionState, ValidationIssue
} from './types.js';

interface DraftRecord {
  readonly descriptor: DescendantNodeDescriptor;
  readonly definition: EditorDefinition;
  readonly snapshot: BlockSnapshot;
  readonly view: EditorView;
  readonly listeners: Set<() => void>;
  readonly editor: DescendantNodeEditor;
  draft: JsonObject;
  issues: readonly ValidationIssue[];
}

function copyDraft(draft: JsonObject): JsonObject {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
    throw new TypeError('The editor draft must be a JSON object.');
  }
  return cloneJson(draft);
}

function copyIssues(issues: readonly ValidationIssue[]): readonly ValidationIssue[] {
  if (!Array.isArray(issues)) throw new TypeError('Expected a validation issue array.');
  return Object.freeze(issues.map(issue => {
    if (!issue || typeof issue.message !== 'string' ||
        (issue.path !== undefined && typeof issue.path !== 'string')) {
      throw new TypeError('Invalid validation issue.');
    }
    return Object.freeze({message: issue.message, ...(issue.path === undefined ? {} : {path: issue.path})});
  }));
}

function observe(listeners: Set<() => void>): void {
  for (const listener of [...listeners]) {
    try { listener(); } catch (error) { report(error); }
  }
}

function report(error: unknown): void {
  console.error('Block editor view callback failed:', error);
}

/** Stop waiting immediately on invalidation; late resolutions/rejections stay handled. */
function abortable<T>(value: T | Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, {once: true});
    Promise.resolve(value).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) {
      signal.removeEventListener('abort', abort);
      abort();
    }
  });
}

/** Aggregate draft/validation only. The negotiated host owns the atomic write. */
export class DescendantSession {
  readonly #snapshot: SubtreeSnapshot;
  readonly #host: DescendantEditorHost;
  readonly #limits: Required<DescendantLimits>;
  readonly #lookup: (opcode: string) => EditorDefinition | undefined;
  readonly #bindings = new Map<string, EditorDefinition | undefined>();
  readonly #records = new Map<string, DraftRecord>();
  readonly #nodes: readonly DescendantNodeDescriptor[];
  readonly #listeners = new Set<() => void>();
  readonly #detach = new Set<() => void>();
  readonly #abort = new AbortController();
  #status: DescendantSessionStatus = 'editing';
  #committing = false;
  #error: unknown;

  /** Use EditorRegistry.openDescendants() to negotiate and capture the scope. */
  constructor(
    captured: CapturedSubtree, host: DescendantEditorHost,
    lookup: (opcode: string) => EditorDefinition | undefined,
    subscribeRegistry: (listener: () => void) => () => void,
    limits: Required<DescendantLimits>
  ) {
    this.#snapshot = captured.snapshot;
    this.#host = host;
    this.#lookup = lookup;
    this.#limits = limits;
    for (const node of captured.snapshot.nodes) this.#bindings.set(node.block.opcode, lookup(node.block.opcode));
    this.#nodes = Object.freeze(captured.snapshot.nodes.map(node => {
      const definition = this.#bindings.get(node.block.opcode);
      const descriptor: DescendantNodeDescriptor = Object.freeze({
        reference: captureReference(node.block), opcode: node.block.opcode,
        inputPath: captured.paths.get(node.block.blockId)!,
        ...(definition ? {editor: Object.freeze({
          apiVersion: definition.apiVersion, extensionId: definition.extensionId,
          editorId: definition.editorId, opcodes: definition.opcodes,
          editableArguments: definition.editableArguments
        })} : {})
      });
      if (definition) {
        try {
          this.#records.set(node.block.blockId, this.#createRecord(descriptor, definition, node.block));
        } catch (cause) {
          throw new DescendantNodeError(descriptor.reference, descriptor.inputPath, cause);
        }
      }
      return descriptor;
    }));
    try {
      this.#watch(() => subscribeRegistry(() => {
        if (!this.#bindingsCurrent()) this.invalidate(new BlockEditorConflictError('An editor registration changed.'));
      }));
      this.#checkBindings();
      if (host.subscribeInvalidation) {
        this.#watch(() => host.subscribeInvalidation!(this.reference, reason => this.invalidate(reason)));
      }
    } catch (error) {
      this.#finish('disposed');
      throw error;
    }
  }

  get reference(): BlockReference { return captureReference(this.#snapshot); }
  get generation(): string { return this.#snapshot.generation; }
  getNodes(): readonly DescendantNodeDescriptor[] { return this.#nodes; }
  getEditor(blockId: string): DescendantNodeEditor | undefined { return this.#records.get(blockId)?.editor; }

  getState(): DescendantSessionState {
    const issues = Object.freeze([...this.#records.values()].flatMap(record => record.issues.map(issue =>
      Object.freeze({...issue, reference: record.descriptor.reference, inputPath: record.descriptor.inputPath})
    )));
    return Object.freeze({status: this.#status,
      canSave: this.#status === 'editing' && issues.length === 0, issues, error: this.#error});
  }

  subscribe(listener: () => void): () => void {
    this.#assertOpen();
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  async save(): Promise<DescendantSaveResult> {
    if (this.#status === 'saving') return {status: 'busy'};
    if (this.#status !== 'editing') return {status: 'closed'};
    this.#status = 'saving';
    this.#error = undefined;
    for (const record of this.#records.values()) record.issues = [];
    this.#notify();
    try {
      this.#assertSaving();
      const prepared = new Map<string, PreparedSave>();
      for (const record of this.#records.values()) {
        try {
          const result = isPreparedEditor(record.definition)
            ? capturePreparedSave(record.definition, cloneJson(record.draft), record.snapshot) : undefined;
          if (result) prepared.set(record.snapshot.blockId, result);
          const issues = result ? (result.kind === 'invalid' ? result.issues : [])
            : await abortable(record.definition.validate(cloneJson(record.draft), record.snapshot), this.#abort.signal);
          this.#assertSaving();
          record.issues = copyIssues(issues);
        } catch (cause) {
          this.#assertSaving();
          throw new DescendantNodeError(record.descriptor.reference, record.descriptor.inputPath, cause);
        }
      }
      const issues = this.getState().issues;
      if (issues.length) return {status: 'invalid', issues};
      const changes: SubtreeArgumentChange[] = [];
      const destinations = new Set<string>();
      for (const record of this.#records.values()) {
        try {
          const result = prepared.get(record.snapshot.blockId);
          const patch = result?.kind === 'ready' ? result.changes
            : record.definition.createPatch(cloneJson(record.draft), record.snapshot);
          this.#assertSaving();
          if (!Array.isArray(patch)) throw new TypeError('createPatch() must return an array.');
          for (const change of patch) {
            if (!change || !record.definition.editableArguments.includes(change.argument) || !isLiteral(change.value)) {
              throw new TypeError('Patch contains an invalid or disallowed argument.');
            }
            const destination = JSON.stringify([record.snapshot.blockId, change.argument]);
            if (destinations.has(destination)) throw new TypeError('Duplicate subtree write destination.');
            destinations.add(destination);
            const slot = Object.hasOwn(record.snapshot.arguments, change.argument)
              ? record.snapshot.arguments[change.argument] : undefined;
            if (slot?.kind !== 'literal') throw new TypeError('Only existing literal arguments can be changed.');
            if (slot.value !== change.value) changes.push(Object.freeze({
              blockId: record.snapshot.blockId, argument: change.argument, value: change.value
            }));
          }
        } catch (cause) {
          this.#assertSaving();
          throw new DescendantNodeError(record.descriptor.reference, record.descriptor.inputPath, cause);
        }
      }
      this.#assertSaving();
      const live = this.#host.readSubtree(this.reference);
      let matches = false;
      if (live) {
        try { matches = sameSubtree(this.#snapshot, captureSubtree(live, this.reference, this.#limits).snapshot); }
        catch { /* A malformed current graph is also a conflict with the captured scope. */ }
      }
      this.#assertSaving();
      if (!matches) throw new BlockEditorConflictError('The subtree changed or is no longer editable.');
      if (changes.length) {
        this.#committing = true;
        await abortable(this.#host.commitSubtree(Object.freeze({
          expected: this.#snapshot, changes: Object.freeze(changes), signal: this.#abort.signal
        })), this.#abort.signal);
        this.#assertSaving();
      }
      this.#finish('saved');
      return {status: 'saved', changed: changes.length > 0};
    } catch (error) {
      if (!this.#isOpen()) return this.#closedSaveResult();
      this.#error = error;
      return error instanceof BlockEditorConflictError ? {status: 'conflict', error} : {status: 'failed', error};
    } finally {
      this.#committing = false;
      if (this.#status === 'saving') {
        this.#status = 'editing';
        this.#notify();
      }
    }
  }

  /** Validation may be cancelled; an already dispatched commit must finish atomically. */
  cancel(): boolean {
    if (!this.#isOpen() || this.#committing) return false;
    this.#finish('cancelled');
    return true;
  }

  dispose(): boolean {
    if (this.#committing && this.#isOpen()) return false;
    if (this.#isOpen()) this.#finish('disposed');
    return true;
  }

  /** The host must observe the abort signal before any deferred write. */
  invalidate(reason: unknown = new BlockEditorConflictError('The subtree session was invalidated.')): boolean {
    if (!this.#isOpen()) return false;
    this.#error = reason;
    this.#finish('invalidated');
    return true;
  }

  #createRecord(descriptor: DescendantNodeDescriptor, definition: EditorDefinition, snapshot: BlockSnapshot): DraftRecord {
    const view = new EditorView();
    const listeners = new Set<() => void>();
    const editor: DescendantNodeEditor = Object.freeze({
      reference: descriptor.reference,
      getSnapshot: () => snapshot,
      getDraft: () => { this.#assertOpen(); return cloneJson(record.draft); },
      setDraft: (draft: JsonObject) => {
        this.#assertEditable();
        record.draft = copyDraft(draft);
        record.issues = [];
        this.#error = undefined;
        this.#notify(record);
      },
      setValidationIssues: (issues: readonly ValidationIssue[]) => {
        this.#assertEditable();
        record.issues = copyIssues(issues);
        this.#notify(record);
      },
      getState: (): SessionState => Object.freeze({
        status: this.#status === 'invalidated' ? 'disposed' : this.#status,
        canSave: this.#status === 'editing' && record.issues.length === 0,
        issues: record.issues, error: this.#error
      }),
      subscribe: (listener: () => void) => {
        this.#assertOpen();
        listeners.add(listener);
        return () => { listeners.delete(listener); };
      },
      mount: (container: HTMLElement) => view.mount(container, definition.mount, editor)
    });
    const record: DraftRecord = {descriptor, definition, snapshot, view, listeners, editor,
      draft: copyDraft(definition.read(snapshot)), issues: []};
    return record;
  }

  #isOpen(): boolean { return this.#status === 'editing' || this.#status === 'saving'; }
  #closedSaveResult(): DescendantSaveResult {
    return this.#status === 'invalidated' ? {status: 'invalidated'} : {status: 'closed'};
  }
  #assertOpen(): void { if (!this.#isOpen()) throw new Error('The session is closed.'); }
  #assertEditable(): void { if (this.#status !== 'editing') throw new Error('The session is not editable.'); }
  #bindingsCurrent(): boolean {
    return [...this.#bindings].every(([opcode, definition]) => this.#lookup(opcode) === definition);
  }
  #checkBindings(): void {
    if (!this.#bindingsCurrent()) throw new BlockEditorConflictError('An editor registration changed.');
  }
  #assertSaving(): void {
    if (this.#status !== 'saving') throw new Error('The save was cancelled or invalidated.');
    this.#checkBindings();
  }
  #notify(record?: DraftRecord): void {
    if (record) observe(record.listeners);
    else for (const node of this.#records.values()) observe(node.listeners);
    observe(this.#listeners);
  }
  #watch(subscribe: () => () => void): void {
    const detach = subscribe();
    if (typeof detach !== 'function') throw new TypeError('Invalidation subscriptions must return a cleanup function.');
    if (this.#isOpen()) this.#detach.add(detach);
    else detach();
  }
  #finish(status: Exclude<DescendantSessionStatus, 'editing' | 'saving'>): void {
    this.#status = status;
    this.#abort.abort(this.#error);
    this.#notify();
    for (const record of this.#records.values()) {
      try { record.view.unmount(); } catch (error) { report(error); }
      record.draft = {};
      record.issues = [];
      record.listeners.clear();
    }
    for (const detach of this.#detach) {
      try { detach(); } catch (error) { report(error); }
    }
    this.#detach.clear();
    this.#listeners.clear();
  }
}
import {isPreparedEditor, capturePreparedSave} from './prepared-save.js';
import type {PreparedSave} from './prepared-types.js';
