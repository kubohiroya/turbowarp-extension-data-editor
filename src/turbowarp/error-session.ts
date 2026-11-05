import type {BlockReference, SessionStatus} from '../types.js';
import type {BlockEditorFailureSession} from '../turbowarp.js';

// A failed opening has no draft or save path; retain a closeable diagnostic modal.
const createBlockEditorErrorSession = (reference: BlockReference, error: unknown): BlockEditorFailureSession => {
    let status: SessionStatus = 'editing';
    const listeners = new Set<() => void>();
    const finish = (next: SessionStatus) => {
        if (status !== 'editing') return false;
        status = next;
        for (const listener of [...listeners]) listener();
        listeners.clear();
        return true;
    };
    return Object.freeze({
        reference,
        getState: () => ({status, canSave: false, issues: [], error}),
        subscribe: (listener: () => void) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        mount: () => () => {},
        save: () => Promise.resolve({status: 'failed' as const, error}),
        cancel: () => finish('cancelled'),
        dispose: () => {
            finish('disposed'); return true;
        }
    });
};

export default createBlockEditorErrorSession;
