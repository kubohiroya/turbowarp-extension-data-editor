// The block preview fixture: a test-only extension with a fixed input editor on two blocks and a preview
// on one of them, and a project with both on the stage. It came from the TurboWarp Plus Editor's E2E
// fixture (test/e2e/turbowarp/preview-project.cts).
export const register = (Scratch: any) => {
    const id = 'previewfixture';
    const canonical = {repository: 'turbowarp-extension-data-editor', path: 'test/runtime/preview-fixture.ts'};
    const schema = (argument: string) => ({
        identity: {ownerId: id, contractId: 'preview-fixture.controls', revision: '1', variantId: argument}, dialect: 'draft-07',
        root: {retrievalUri: `https://fixture.invalid/${argument}`, document: {type: 'number', minimum: 0, maximum: 100},
            artifact: {role: 'canonical-schema', source: canonical}}, resources: [],
        provenance: {canonicalSources: [canonical], generatedFiles: [], referenceSchemas: [], generationSources: []}
    });
    const api = Scratch.gui && Scratch.gui.blockEditors;
    const state: any = (globalThis as any).__previewFixture = {
        capabilities: {preview: Boolean(api && typeof api.registerPreview === 'function'),
            fixed: Boolean(api && typeof api.registerFixedInputEditor === 'function'),
            isolatedVm: Boolean(Scratch.gui && typeof Scratch.gui.createPreviewVm === 'function')},
        hovers: 0, hoverReleases: 0, mounts: 0, unmounts: 0, quits: 0, previewVms: []
    };
    if (state.capabilities.fixed) api.registerFixedInputEditor({
        apiVersion: 1, extensionId: id, editorId: 'controls', opcodes: [`${id}_place`, `${id}_plain`],
        contractId: 'preview-fixture.controls', contractRevision: '1', readOnlyArguments: [], dependencies: [], branchPolicies: [],
        bindings: [{argument: 'NUMBER', schemaBundle: schema('NUMBER'), control: {kind: 'number'},
            read: Number, encode: (value: unknown) => String(value), validateCandidate: () => []}],
        validationContext: () => ({consumerId: id, nowMs: 0, settings: null})
    });
    // Only the place block has a preview; the plain block keeps the existing form alone.
    if (state.capabilities.preview) api.registerPreview({
        extensionId: id, opcodes: [`${id}_place`],
        mount (container: HTMLElement, context: any) {
            state.mounts++;
            const preview = Scratch.gui.createPreviewVm();
            state.previewVms.push(preview);
            const document = container.ownerDocument;
            const value = document.createElement('output');
            value.dataset.previewFixtureValue = '';
            const add = document.createElement('button');
            add.type = 'button';
            add.textContent = 'Add 5';
            add.addEventListener('click', () => {
                const draft = context.getDraft();
                context.setDraft({...draft, inputs: {...draft.inputs,
                    NUMBER: {value: Number(draft.inputs.NUMBER.value) + 5, changed: true}}});
            });
            const render = () => { value.textContent = String(context.getDraft().inputs.NUMBER.value); };
            container.append(value, add);
            render();
            const stop = context.subscribe(render);
            return () => {
                stop();
                value.remove();
                add.remove();
                preview.quit();
                state.quits++;
                state.unmounts++;
            };
        },
        hover (anchor: HTMLElement, snapshot: any) {
            state.hovers++;
            const tip = anchor.ownerDocument.createElement('div');
            tip.dataset.previewFixtureHover = '';
            tip.textContent = `NUMBER ${snapshot.arguments.NUMBER.value}`;
            anchor.ownerDocument.body.append(tip);
            return () => {
                tip.remove();
                state.hoverReleases++;
            };
        }
    });
    const icon = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><path fill="white" d="M5 5h30v30H5z"/></svg>')}`;
    Scratch.extensions.register(new class {
        getInfo () {
            return {id, name: 'Preview fixture', color1: '#6b49a8', blockIconURI: icon,
                blocks: [{opcode: 'place', blockType: Scratch.BlockType.COMMAND, text: 'place at [NUMBER]',
                    arguments: {NUMBER: {type: Scratch.ArgumentType.NUMBER, defaultValue: 10}}},
                {opcode: 'plain', blockType: Scratch.BlockType.COMMAND, text: 'plain [NUMBER]',
                    arguments: {NUMBER: {type: Scratch.ArgumentType.NUMBER, defaultValue: 10}}}]};
        }
        place () {}
        plain () {}
    }());
};

const command = (opcode: string, shadow: string, y: number) => ({opcode: `previewfixture_${opcode}`, next: null, parent: null,
    topLevel: true, shadow: false, x: 40, y, fields: {}, inputs: {NUMBER: [1, shadow]}});
const number = (parent: string) => ({opcode: 'math_number', next: null, parent, topLevel: false, shadow: true,
    fields: {NUM: ['10', null]}, inputs: {}});
export const projectJSON = () => ({targets: [{isStage: true, name: 'Stage', variables: {}, lists: {}, broadcasts: {}, comments: {},
    blocks: {'preview-root': command('place', 'preview-number', 40), 'preview-number': number('preview-root'),
        'plain-root': command('plain', 'plain-number', 140), 'plain-number': number('plain-root')},
    currentCostume: 0, costumes: [], sounds: [], volume: 100, tempo: 60}],
    monitors: [], extensions: ['previewfixture'], meta: {semver: '3.0.0', agent: 'block-preview-runtime-fixture'}});
