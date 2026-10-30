import type {EditorDefinition, EditorViewContext, JsonObject, ValidationIssue} from './types.js';

/** Shared body lifetime for single-block and aggregate sessions. */
export class EditorView {
  #unmount: (() => void) | undefined;
  #mounting = false;

  mount(container: HTMLElement, mount: EditorDefinition['mount'], owner: EditorViewContext): () => void {
    if (owner.getState().status !== 'editing' || this.#unmount || this.#mounting) {
      throw new Error('The session cannot mount another view.');
    }
    if (!mount) throw new Error('No editor view is registered.');
    let active = true;
    const subscriptions = new Set<() => void>();
    const assertMounted = () => {
      if (!active) throw new Error('The editor view is unmounted.');
    };
    const release = () => {
      active = false;
      for (const unsubscribe of subscriptions) unsubscribe();
      subscriptions.clear();
    };
    const context: EditorViewContext = Object.freeze({
      ...(owner.getSnapshot ? {getSnapshot: () => { assertMounted(); return owner.getSnapshot!(); }} : {}),
      getDraft: () => owner.getDraft(),
      ...(owner.getFixedInputView ? {getFixedInputView: () => {
        assertMounted();
        return owner.getFixedInputView!();
      }} : {}),
      setDraft: (draft: JsonObject) => { assertMounted(); owner.setDraft(draft); },
      setValidationIssues: (issues: readonly ValidationIssue[]) => {
        assertMounted();
        owner.setValidationIssues(issues);
      },
      getState: () => owner.getState(),
      subscribe: (listener: () => void) => {
        assertMounted();
        const unsubscribe = owner.subscribe(() => { if (active) listener(); });
        const remove = () => { subscriptions.delete(remove); unsubscribe(); };
        subscriptions.add(remove);
        return remove;
      }
    });
    this.#mounting = true;
    let cleanup: () => void;
    try {
      cleanup = mount(container, context);
      if (typeof cleanup !== 'function') throw new TypeError('mount() must return a cleanup function.');
    } catch (error) {
      release();
      throw error;
    } finally {
      this.#mounting = false;
    }
    if (owner.getState().status !== 'editing' && owner.getState().status !== 'saving') {
      release();
      cleanup();
      return () => {};
    }
    const unmount = () => {
      if (!active) return;
      release();
      this.#unmount = undefined;
      cleanup();
    };
    this.#unmount = unmount;
    return unmount;
  }

  unmount(): void { this.#unmount?.(); }
}
