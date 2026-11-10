// The theme fixture: two test-only extensions, a parent and a child with different colours, each with a
// source editor for its PROPERTIES argument, and a project nesting their blocks with one invalid child.
// It came from the TurboWarp Plus Editor's E2E fixture (test/e2e/turbowarp/theme-project.cts).
export const definitions = [{id: 'themeparent', colour: '#087f8c'}, {id: 'themechild', colour: '#663399'}];

const valid = () => ({name: 'Valid name',
    amount: 2,
    mode: 'a',
    notes: 'OK notes',
    shortcuts: {ArrowRight: 'rehearsal.skipAction'},
    nested: {valid: 'Keep this unchanged', invalid: 'OK'},
    group: {valid: 'Keep this group value', other: 'Another property'},
    items: [{label: 'First valid item'}, {label: 'Second valid item'}]});
const invalid = () => ({...valid(),
    name: '',
    amount: 0,
    mode: 'outside',
    notes: 'bad',
    nested: {valid: 'Keep this unchanged', invalid: 'bad'}});

export const register = (Scratch: any, {id, colour}: {id: string; colour: string}) => {
    const schema = {type: 'object',
        required: ['name', 'amount', 'mode', 'notes'],
        properties: {
            name: {type: 'string', title: 'Name', minLength: 1},
            amount: {type: 'integer', title: 'Amount', minimum: 1, maximum: 10},
            mode: {type: 'string', title: 'Mode', enum: ['a', 'b']},
            notes: {type: 'string', title: 'Notes', pattern: '^OK'},
            shortcuts: {type: 'object', title: 'Shortcuts', additionalProperties: {type: 'string'}},
            nested: {type: 'object',
                title: 'Nested settings',
                properties: {
                    valid: {type: 'string', title: 'Valid sibling'},
                    invalid: {type: 'string', title: 'Code', pattern: '^OK$'}
                }},
            group: {type: 'object',
                title: 'Group constraint',
                minProperties: 2,
                properties: {
                    valid: {type: 'string', title: 'Valid group child'},
                    other: {type: 'string', title: 'Optional property'}
                }},
            items: {type: 'array',
                title: 'Items',
                minItems: 2,
                items: {
                    type: 'object',
                    required: ['label'],
                    properties: {
                        label: {type: 'string', title: 'Item label', minLength: 1}
                    }
                }}
        }};
    const icon = `data:image/svg+xml,${encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><path fill="white" d="M5 5h30v30H5z"/></svg>'
    )}`;
    Scratch.gui.blockEditors.register({apiVersion: 1,
        extensionId: id,
        editorId: `${id}-properties`,
        opcodes: [`${id}_group`, `${id}_item`],
        argument: 'PROPERTIES',
        schema,
        uiSchema: {notes: {'ui:widget': 'textarea'}}});
    Scratch.extensions.register(new class {
        getInfo () {
            const args = {PROPERTIES: {type: Scratch.ArgumentType.STRING, defaultValue: '{}'}};
            return {id,
                name: id,
                color1: colour,
                color2: colour,
                color3: colour,
                blockIconURI: icon,
                blocks: [
                    {opcode: 'group',
                        blockType: Scratch.BlockType.CONDITIONAL,
                        branchCount: 2,
                        text: 'Theme group [PROPERTIES]',
                        arguments: args},
                    {opcode: 'item',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'Theme item [PROPERTIES]',
                        arguments: args}
                ]};
        }
        group (_args: unknown, util: any) {
            util.startBranch(1, false);
        }
        item () {}
    }());
};
export const projectJSON = () => {
    const blocks: Record<string, object> = {};
    const add = (id: string, opcode: string, data: object, parent: string | null, inputs: object = {}) => {
        blocks[id] = {opcode,
            next: null,
            parent,
            inputs: {...inputs, PROPERTIES: [1, [10, JSON.stringify(data)]]},
            fields: {},
            shadow: false,
            topLevel: parent === null,
            ...(parent === null ? {x: 40, y: 40} : {})};
    };
    add('theme-root', 'themeparent_group', valid(), null,
        {SUBSTACK: [2, 'theme-middle'], SUBSTACK2: [2, 'theme-sibling']});
    blocks['theme-middle'] = {opcode: 'control_if',
        next: null,
        parent: 'theme-root',
        inputs: {SUBSTACK: [2, 'theme-grand']},
        fields: {},
        shadow: false,
        topLevel: false};
    add('theme-grand', 'themechild_item', invalid(), 'theme-middle');
    add('theme-sibling', 'themeparent_item', valid(), 'theme-root');
    return {targets: [{isStage: true, name: 'Stage', variables: {}, lists: {}, broadcasts: {}, blocks, comments: {},
        currentCostume: 0, costumes: [], sounds: [], volume: 100, tempo: 60}],
    monitors: [], extensions: ['themeparent', 'themechild'], meta: {semver: '3.0.0', agent: 'block-editor-theme-runtime-fixture'}};
};
