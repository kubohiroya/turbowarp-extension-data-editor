import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {
    createPlusBlockEditor,
    dialogMessages,
    exposeBlockEditorAPI,
    fixedMessages,
    plusBlockEditorClassNames,
    plusBlockEditorTranslations
} from '../dist/plus.js';

/** react-intl's formatMessage, reduced to what the messages use: a lookup with a fallback. */
const intlFor = (locale: 'en' | 'ja', seen: string[] = []) => ({
    formatMessage: ({id, defaultMessage}: {id: string; defaultMessage: string}, values?: Record<string, string>) => {
        seen.push(id);
        let text = plusBlockEditorTranslations[locale][id] ?? defaultMessage;
        for (const [key, value] of Object.entries(values ?? {})) text = text.replace(`{${key}}`, value);
        return text;
    }
});

test('every Plus block editor message has an English and a Japanese translation', () => {
    const seen: string[] = [];
    for (const locale of ['en', 'ja'] as const) {
        fixedMessages(intlFor(locale, seen));
        dialogMessages(intlFor(locale, seen));
    }
    const ids = new Set(seen);
    assert.ok(ids.size > 0);
    for (const locale of ['en', 'ja'] as const) {
        for (const id of ids) assert.equal(typeof plusBlockEditorTranslations[locale][id], 'string', `${locale} ${id}`);
    }
    assert.deepEqual(Object.keys(plusBlockEditorTranslations.ja).sort(), Object.keys(plusBlockEditorTranslations.en).sort());
});

test('fixed input labels follow the GUI locale', () => {
    for (const locale of ['en', 'ja'] as const) {
        const labels = fixedMessages(intlFor(locale));
        for (const key of ['reset', 'readOnly', 'unverified', 'currentValue', 'colorPicker', 'invalidValue', 'inactiveDraft'] as const) {
            assert.equal(labels[key], plusBlockEditorTranslations[locale][`tw.blockEditor.fixed.${key}`]);
        }
    }
    // The dialog fills {count} itself, so it must survive formatting.
    assert.match(dialogMessages(intlFor('en')).fixToSave!, /\{count\}/);
});

test('capabilities the installed artifact does not provide are hidden, others are kept as is', () => {
    const legacy = {apiVersion: 1, register() {}};
    assert.equal(exposeBlockEditorAPI(legacy), legacy);
    for (const key of ['registerSourceEditor', 'registerFixedInputEditor']) {
        const hidden = exposeBlockEditorAPI({...legacy, [key]: true});
        assert.equal(key in hidden, false);
        assert.ok(Object.isFrozen(hidden));
        const real = {...legacy, [key]() {}};
        assert.equal(exposeBlockEditorAPI(real), real);
    }
});

test('the service enables fixed inputs with the GUI strings and exposes only real capabilities', () => {
    let options: any;
    const editor = createPlusBlockEditor({createService: given => {
        options = given;
        return {api: {apiVersion: 1, register() {}, registerFixedInputEditor: 'missing'}, other: 1};
    }});
    const service = editor.createService({getIntl: () => intlFor('ja')});
    assert.equal(options.commonLayout, true);
    assert.equal(options.fixedInputs, true);
    assert.equal(options.fixedInputMessages().reset, plusBlockEditorTranslations.ja['tw.blockEditor.fixed.reset']);
    assert.equal('registerFixedInputEditor' in service.api, false);
    assert.equal(service.other, 1);
    // Without an Intl context the editor falls back to its own defaults.
    editor.createService();
    assert.deepEqual(options.fixedInputMessages(), {});
    // An older GUI hands in its own message source, which is used unchanged.
    const legacy = () => ({reset: 'R'});
    editor.createService({fixedInputMessages: legacy});
    assert.equal(options.fixedInputMessages, legacy);
});

test('attaching covers nested blocks and lets the GUI context decide the rest', () => {
    let options: any;
    const editor = createPlusBlockEditor({attach: given => (options = given, {dispose() {}})});
    editor.attach({workspace: 'w', enabled: false});
    assert.equal(options.descendants, true);
    assert.equal(options.workspace, 'w');
    assert.equal(options.enabled, false);
});

test('the dialog renders with the host stylesheet, the Plus classes and localized messages', () => {
    const styles = {dialog: 'x'};
    const Dialog = () => null;
    const editor = createPlusBlockEditor({styles, dialog: Dialog});
    const element: any = editor.render({intl: intlFor('ja'), className: plusBlockEditorClassNames.dark, session: 's'});
    assert.equal(element.type, Dialog);
    assert.equal(element.props.styles, styles);
    assert.equal(element.props.session, 's');
    assert.equal(element.props.messages.title, plusBlockEditorTranslations.ja['tw.blockEditor.title']);
    for (const name of Object.values(plusBlockEditorClassNames)) assert.ok(element.props.className.split(' ').includes(name), name);
    const messages = {title: 'given'};
    assert.equal((editor.render({messages}) as any).props.messages, messages);
});

test('plus.css defines every class the render uses', async () => {
    const css = await readFile(new URL('../dist/plus.css', import.meta.url), 'utf8');
    for (const name of Object.values(plusBlockEditorClassNames)) assert.match(css, new RegExp(`\\.${name}\\b`));
});
