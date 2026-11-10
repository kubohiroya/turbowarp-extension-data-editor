// The fixed-input fixture: a test-only extension that registers a fixed input editor, and a project
// with one of its blocks on the stage. It came from the TurboWarp Plus Editor's E2E fixture
// (test/e2e/turbowarp/fixed-project.cts), which loads the same extension through the Editor's GUI.
export const register = (Scratch: any) => {
    const id = 'fixedfixture';
    const canonical = {repository: 'turbowarp-extension-data-editor', path: 'test/runtime/fixed-fixture.ts'};
    const schema = (argument: string, document: object) => ({
        identity: {ownerId: id, contractId: 'fixed-fixture.controls', revision: '1', variantId: argument}, dialect: 'draft-07',
        root: {retrievalUri: `https://fixture.invalid/${argument}`, document,
            artifact: {role: 'canonical-schema', source: canonical}}, resources: [],
        provenance: {canonicalSources: [canonical], generatedFiles: [], referenceSchemas: [], generationSources: []}
    });
    const numeric = (argument: string) => ({argument, schemaBundle: schema(argument, {type: 'number', minimum: 0, maximum: 100}),
        control: {kind: 'number'}, read: Number, encode: value => String(value), validateCandidate: () => []});
    const api = Scratch.gui && Scratch.gui.blockEditors;
    globalThis.__fixedFixtureCapabilities = {dialogs: Boolean(api), sourceForms: Boolean(api && typeof api.registerSourceEditor === 'function'),
        fixedInputs: Boolean(api && typeof api.registerFixedInputEditor === 'function')};
    globalThis.__fixedFixtureAvailable = Boolean(api && typeof api.registerFixedInputEditor === 'function');
    globalThis.__fixedFixtureExecutions = 0;
    if (globalThis.__fixedFixtureAvailable) api.registerFixedInputEditor({
        apiVersion: 1, extensionId: id, editorId: 'controls', opcodes: [`${id}_controls`],
        contractId: 'fixed-fixture.controls', contractRevision: '1', readOnlyArguments: ['CONDITION'],
        dependencies: [{selector: 'MODE', dependents: ['TIMEOUT']}],
        branchPolicies: [{selector: 'MODE', cases: [
            {values: ['timeout'], activeDependents: ['TIMEOUT']}, {values: ['forever'], activeDependents: []}
        ]}],
        bindings: [
            {argument: 'MODE', schemaBundle: schema('MODE', {type: 'string', enum: ['timeout', 'forever']}),
                control: {kind: 'enum', choices: [{value: 'timeout', label: 'Timeout'}, {value: 'forever', label: 'Forever'}]},
                read: value => value, encode: value => value, validateCandidate: () => []},
            numeric('NUMBER'), numeric('TIMEOUT'),
            {argument: 'COLOR', schemaBundle: schema('COLOR', {type: 'string', pattern: '^#[0-9a-f]{6}$'}),
                control: {kind: 'color'}, read: value => value, encode: value => value, validateCandidate: () => []}
        ], validationContext: () => ({consumerId: id, nowMs: 0, settings: null})
    });
    const icon = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><path fill="white" d="M5 5h30v30H5z"/></svg>')}`;
    Scratch.extensions.register(new class {
        getInfo () {
            return {id, name: 'Fixed input fixture', color1: '#087f8c', blockIconURI: icon,
                blocks: [{opcode: 'controls', blockType: Scratch.BlockType.COMMAND,
                    text: 'fixed [MODE] number [NUMBER] color [COLOR] timeout [TIMEOUT] condition [CONDITION]',
                    arguments: {MODE: {type: Scratch.ArgumentType.STRING, menu: 'modes'},
                        NUMBER: {type: Scratch.ArgumentType.NUMBER, defaultValue: 10},
                        COLOR: {type: Scratch.ArgumentType.COLOR, defaultValue: '#112233'},
                        TIMEOUT: {type: Scratch.ArgumentType.NUMBER, defaultValue: 10},
                        CONDITION: {type: Scratch.ArgumentType.STRING, defaultValue: 'ready'}}},
                {opcode: 'context', blockType: Scratch.BlockType.REPORTER, text: 'retained expression'}],
                menus: {modes: {acceptReporters: false, items: [{text: 'Timeout', value: 'timeout'}, {text: 'Forever', value: 'forever'}]}}};
        }
        controls () {}
        context () {globalThis.__fixedFixtureExecutions++;return 'never evaluated by the editor';}
    }());
};

export const projectJSON = () => ({targets: [{isStage: true, name: 'Stage', variables: {}, lists: {}, broadcasts: {}, comments: {},
    blocks: {
        'fixed-root': {opcode: 'fixedfixture_controls', next: null, parent: null, topLevel: true, shadow: false, x: 40, y: 40,
            fields: {MODE: ['timeout', null]}, inputs: {NUMBER: [1, [4, '10']], COLOR: [1, [9, '#112233']],
                TIMEOUT: [1, [4, '10']], CONDITION: [3, 'fixed-context', [10, 'ready']]}},
        'fixed-context': {opcode: 'fixedfixture_context', next: null, parent: 'fixed-root', topLevel: false, shadow: false,
            fields: {}, inputs: {}}
    },
    currentCostume: 0, costumes: [], sounds: [], volume: 100, tempo: 60}],
    monitors: [], extensions: ['fixedfixture'], meta: {semver: '3.0.0', agent: 'fixed-input-runtime-fixture'}});
