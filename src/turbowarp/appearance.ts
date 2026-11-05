import type {NativeBlock, NativeScratchBlocks} from './native-types.js';

// Presentation metadata stays outside snapshots, drafts and saved project data.
const readBlockEditorAppearance = (block: NativeBlock | null, ScratchBlocks: NativeScratchBlocks, editableArguments?: readonly string[]) => {
    const appearance: {name?: string; colour?: string; tint?: string; iconURI?: string} = {};
    if (!block) return appearance;
    try {
        // Registered editor inputs contain the document; other literal inputs identify the block.
        const name = block.inputList.filter(input => input.type !== ScratchBlocks.NEXT_STATEMENT)
            .map(input => {
                const label = input.fieldRow.filter(field => !(field instanceof ScratchBlocks.FieldImage))
                    .map(field => field.getText()).join(' ');
                if (!editableArguments || editableArguments.includes(input.name) ||
                    input.type !== ScratchBlocks.INPUT_VALUE) return label;
                try {
                    const child = input.connection && input.connection.targetBlock();
                    // Read only literal shadows, never evaluate or traverse reporter expressions.
                    if (!child || !child.isShadow() || child.inputList.some(part => part.connection)) return label;
                    const value = child.inputList.flatMap(part => part.fieldRow)
                        .filter(field => !(field instanceof ScratchBlocks.FieldImage))
                        .map(field => field.getText()).join(' ').replace(/\s+/g, ' ').trim();
                    return value ? `${label} (${value})` : label;
                } catch (error) {
                    // An unavailable identifier must not discard the block's own labels.
                    return label;
                }
            })
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (name) appearance.name = name;
    } catch (error) {
        // The opcode remains available as a name fallback.
    }
    try {
        const colour = block.getColour();
        if (typeof colour === 'string' && /^#[0-9a-f]{6}$/i.test(colour)) {
            appearance.colour = colour;
            const channels = [1, 3, 5].map(offset => parseInt(colour.slice(offset, offset + 2), 16));
            appearance.tint = `rgba(${channels.join(', ')}, 0.08)`;
        }
    } catch (error) {
        // Missing presentation data must not prevent opening an otherwise editable tree.
    }
    try {
        const input = block.inputList[0];
        const field = input && input.fieldRow[0];
        if (field instanceof ScratchBlocks.FieldImage) {
            const uri = field.getValue();
            if (typeof uri === 'string' && uri.trim()) appearance.iconURI = uri;
        }
    } catch (error) {
        // Keep the colour even when the leading image is unavailable.
    }
    return appearance;
};

export default readBlockEditorAppearance;
