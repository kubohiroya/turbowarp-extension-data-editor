/**
 * The TurboWarp Plus distribution of the block editor: its strings in English and Japanese, the
 * capabilities it exposes, and how it attaches to and renders in the Plus GUI.
 *
 * The Plus Editor used to keep this in its own `site/block-editor`. It belongs with the editor it
 * configures, so a host only wires it up: it passes the dialog stylesheet it bundles and adds
 * `plus.css` (global class names) to its page.
 */

import React from 'react';
import {createBlockEditorService} from './rjsf.js';
import {BlockEditorDialog} from './react.js';
import {attachTurboWarpBlockEditors} from './turbowarp.js';

/** The part of react-intl's `intl` these strings use. */
export interface PlusIntl {
    formatMessage(descriptor: {id: string; defaultMessage: string; description?: string}, values?: Record<string, string>): string;
}
type FixedInputMessages = Record<'reset' | 'readOnly' | 'unverified' | 'currentValue' | 'colorPicker' | 'invalidValue' | 'inactiveDraft', string>;
type DialogMessages = Record<string, string>;

export const fixedMessages = (intl: PlusIntl): FixedInputMessages => ({
    reset: intl.formatMessage({id: 'tw.blockEditor.fixed.reset',
        defaultMessage: 'Reset',
        description: 'Reset one fixed input to its declared reset value'}),
    readOnly: intl.formatMessage({id: 'tw.blockEditor.fixed.readOnly',
        defaultMessage: 'This input cannot be edited safely.',
        description: 'A fixed input is read only'}),
    unverified: intl.formatMessage({id: 'tw.blockEditor.fixed.unverified',
        defaultMessage: 'The expression is retained without evaluation. Its runtime validity has not been checked.',
        description: 'A retained reporter expression is not evaluated by the editor'}),
    currentValue: intl.formatMessage({id: 'tw.blockEditor.fixed.currentValue',
        defaultMessage: 'Current value',
        description: 'The raw captured value of a fixed input'}),
    colorPicker: intl.formatMessage({id: 'tw.blockEditor.fixed.colorPicker',
        defaultMessage: 'color picker',
        description: 'Accessible name of a fixed color picker'}),
    invalidValue: intl.formatMessage({id: 'tw.blockEditor.fixed.invalidValue',
        defaultMessage: 'Check this value before saving.',
        description: 'A fixed input is invalid'}),
    inactiveDraft: intl.formatMessage({id: 'tw.blockEditor.fixed.inactiveDraft',
        defaultMessage: 'Hidden edits are retained in this dialog and will not be saved while hidden.',
        description: 'A hidden fixed input has unsaved edits'})
});

export const dialogMessages = (intl: PlusIntl): DialogMessages => ({
        title: intl.formatMessage({
            id: 'tw.blockEditor.title', defaultMessage: 'Edit block', description: 'Block editor dialog title'
        }),
        saving: intl.formatMessage({
            id: 'tw.blockEditor.saving', defaultMessage: 'Saving…', description: 'Block editor save is pending'
        }),
        cancel: intl.formatMessage({
            id: 'tw.blockEditor.cancel', defaultMessage: 'Cancel', description: 'Cancel block editing'
        }),
        save: intl.formatMessage({
            id: 'tw.blockEditor.save', defaultMessage: 'Save', description: 'Save block editing'
        }),
        saveAll: intl.formatMessage({
            id: 'tw.blockEditor.saveAll', defaultMessage: 'Save all', description: 'Save all block forms'
        }),
        update: intl.formatMessage({
            id: 'tw.blockEditor.update', defaultMessage: 'Update',
            description: 'Save button when the block already differs from its palette defaults'
        }),
        noChanges: intl.formatMessage({
            id: 'tw.blockEditor.noChanges', defaultMessage: 'No changes',
            description: 'Why Update is disabled: nothing changed'
        }),
        // The dialog fills {count} itself, so it passes through formatting unchanged.
        fixToSave: intl.formatMessage({
            id: 'tw.blockEditor.fixToSave', defaultMessage: 'Fix {count} problems to save',
            description: 'Why the save button is disabled; {count} is the number of problems'
        }, {count: '{count}'}),
        structureError: intl.formatMessage({
            id: 'tw.blockEditor.structureError',
            defaultMessage: 'This hierarchy is invalid or exceeds 500 blocks or 32 levels. No blocks were saved.',
            description: 'A hierarchy cannot be opened safely'
        }),
        conflict: intl.formatMessage({
            id: 'tw.blockEditor.conflict',
            defaultMessage: 'This block changed. Close this dialog and open it again.',
            description: 'Block editor conflict message'
        }),
        failed: intl.formatMessage({
            id: 'tw.blockEditor.failed',
            defaultMessage: 'The block could not be edited. Close this dialog and try again.',
            description: 'Block editor failure message'
        }),
        invalidInput: intl.formatMessage({
            id: 'tw.blockEditor.fixed.invalidValue',
            defaultMessage: 'Check this value before saving.',
            description: 'A fixed input is invalid'
        }),
        structuralNode: intl.formatMessage({
            id: 'tw.blockEditor.structuralNode',
            defaultMessage: 'No form for this block; its nested blocks are included.',
            description: 'An intermediate structural block without an editor'
        })
    });

/** The translations of every message above, for the host's locale data. */
export const plusBlockEditorTranslations: Readonly<Record<'en' | 'ja', Readonly<Record<string, string>>>> = Object.freeze({
    "ja": {
        "tw.blockEditor.open": "ブロックを編集",
        "tw.blockEditor.title": "ブロックを編集",
        "tw.blockEditor.conflict": "ブロックが変更されています。閉じて、もう一度開いてください。",
        "tw.blockEditor.failed": "ブロックを編集できませんでした。閉じて、もう一度試してください。",
        "tw.blockEditor.cancel": "キャンセル",
        "tw.blockEditor.save": "保存",
        "tw.blockEditor.saving": "保存中…",
        "tw.blockEditor.saveAll": "すべて保存",
        "tw.blockEditor.update": "更新",
        "tw.blockEditor.noChanges": "変更はありません",
        "tw.blockEditor.fixToSave": "{count}件の問題を直すと保存できます",
        "tw.blockEditor.structuralNode": "このブロックにフォームはありません。内側のブロックは編集対象に含まれます。",
        "tw.blockEditor.structureError": "不正な階層、または500ブロック・深さ32の上限超過のため開けません。保存は行われていません。",
        "tw.blockEditor.fixed.reset": "リセット",
        "tw.blockEditor.fixed.readOnly": "この入力は編集できません。",
        "tw.blockEditor.fixed.unverified": "式の実行時の有効性は未検証です。",
        "tw.blockEditor.fixed.currentValue": "現在の値",
        "tw.blockEditor.fixed.colorPicker": "色を選択",
        "tw.blockEditor.fixed.invalidValue": "保存する前に値を確認してください。",
        "tw.blockEditor.fixed.inactiveDraft": "非表示の編集内容はこの画面で保持されます。非表示のまま保存しても反映されません。"
    },
    "en": {
        "tw.blockEditor.open": "Edit block",
        "tw.blockEditor.title": "Edit block",
        "tw.blockEditor.conflict": "This block changed. Close this dialog and open it again.",
        "tw.blockEditor.failed": "The block could not be edited. Close this dialog and try again.",
        "tw.blockEditor.cancel": "Cancel",
        "tw.blockEditor.save": "Save",
        "tw.blockEditor.saving": "Saving…",
        "tw.blockEditor.saveAll": "Save all",
        "tw.blockEditor.update": "Update",
        "tw.blockEditor.noChanges": "No changes",
        "tw.blockEditor.fixToSave": "Fix {count} problems to save",
        "tw.blockEditor.structuralNode": "No form for this block; its nested blocks are included.",
        "tw.blockEditor.structureError": "This hierarchy is invalid or exceeds 500 blocks or 32 levels. No blocks were saved.",
        "tw.blockEditor.fixed.reset": "Reset",
        "tw.blockEditor.fixed.readOnly": "This input cannot be edited safely.",
        "tw.blockEditor.fixed.unverified": "The expression is retained without evaluation. Its runtime validity has not been checked.",
        "tw.blockEditor.fixed.currentValue": "Current value",
        "tw.blockEditor.fixed.colorPicker": "color picker",
        "tw.blockEditor.fixed.invalidValue": "Check this value before saving.",
        "tw.blockEditor.fixed.inactiveDraft": "Hidden edits are retained in this dialog and will not be saved while hidden."
    }
});

/** The global class names `plus.css` defines. */
export const plusBlockEditorClassNames = Object.freeze({
    theme: 'tw-plus-block-editor',
    dark: 'tw-plus-block-editor-dark',
    commonLayout: 'tw-plus-block-editor-layout'
});

/** Expose every capability provided by the installed artifact, without URL gating. */
/** The optional capabilities a host may find on an artifact's registration API. */
export type PlusBlockEditorCapabilities = {readonly registerSourceEditor?: unknown; readonly registerFixedInputEditor?: unknown};

export const exposeBlockEditorAPI = <T extends object>(api: T): T & PlusBlockEditorCapabilities => {
    const visible: Record<string, unknown> = {...(api as Record<string, unknown>)};
    let changed = false;
    for (const key of ['registerSourceEditor', 'registerFixedInputEditor']) {
        if (typeof (api as Record<string, unknown>)[key] !== 'function' && key in api) {
            delete visible[key];
            changed = true;
        }
    }
    return changed ? Object.freeze(visible) as T : api;
};

/**
 * Build the wiring, so a test can hand in its own entry points.
 * @param parts `styles` is the dialog stylesheet the host bundles (`react/styles.css`);
 * `createService`, `attach` and `dialog` are for tests and default to the real ones.
 * @returns `createService`, `attach` and `render`.
 */
export const createPlusBlockEditor = ({
    styles,
    createService = createBlockEditorService as (options: any) => any,
    attach = attachTurboWarpBlockEditors as (options: any) => any,
    dialog = BlockEditorDialog as unknown as React.ComponentType<any>
}: {styles?: unknown; createService?: (options: any) => any; attach?: (options: any) => any; dialog?: React.ComponentType<any>} = {}) => Object.freeze({
    /**
     * The editing service for one VM. The GUI supplies its current Intl context; this
     * distribution owns the messages and the API compatibility.
     */
    createService: ({getIntl, fixedInputMessages}: {getIntl?: () => PlusIntl | undefined; fixedInputMessages?: unknown} = {}) => {
        const service = createService({
            commonLayout: true,
            fixedInputs: true,
            fixedInputMessages: fixedInputMessages || (() => {
                const intl = getIntl?.();
                return intl ? fixedMessages(intl) : {};
            })
        });
        return {...service, api: exposeBlockEditorAPI(service.api)};
    },
    /** Put the editors on a workspace, covering nested blocks and fixed inputs. */
    attach: (context: Record<string, unknown>) => attach({enabled: true, descendants: true, ...context}),
    /** Render the dialog inside the GUI's own modal frame, which arrives as `ModalComponent`. */
    render: ({intl, ...props}: {intl?: PlusIntl; className?: string; messages?: unknown; [key: string]: unknown}) => React.createElement(dialog, {
        styles,
        ...props,
        className: `${plusBlockEditorClassNames.theme} ${plusBlockEditorClassNames.commonLayout} ${props.className || ''}`,
        messages: intl ? dialogMessages(intl) : props.messages
    })
});
