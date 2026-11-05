import type {StatementBranch, SubtreeNodeSnapshot, SubtreeSnapshot} from '../descendant-types.js';
import type {BlockReference} from '../types.js';
import type {BlockRecord, NativeScratchBlocks} from './native-types.js';
import {BlockEditorStructureError, DEFAULT_DESCENDANT_LIMITS} from '../index.js';

// Traverse statement inputs and their internal next chains; never the root's outer next or reporters.
const collectBlockEditorSubtree = ({ScratchBlocks, reference, inspect, generation}: {
    ScratchBlocks: NativeScratchBlocks;
    reference: BlockReference;
    inspect(reference: BlockReference, structural: boolean): BlockRecord | null;
    generation: number;
}): {snapshot: SubtreeSnapshot; records: Map<string, BlockRecord>} | null => {
    const nodes: SubtreeNodeSnapshot[] = [];
    const records = new Map<string, BlockRecord>();
    const pending = {};
    function invalid(message: string): never {
        throw new BlockEditorStructureError(message, 'invalid-structure');
    };
    const visit = (id: string, depth: number): void => {
        if (records.has(id)) {
            throw new BlockEditorStructureError('A statement block is connected more than once.', 'cycle');
        }
        if (depth > DEFAULT_DESCENDANT_LIMITS.maxDepth || nodes.length >= DEFAULT_DESCENDANT_LIMITS.maxNodes) {
            throw new BlockEditorStructureError('The block hierarchy exceeds the editing limit.', 'limit');
        }
        const record = inspect({targetId: reference.targetId, blockId: id}, true);
        if (!record) throw pending;
        if (record.block.outputConnection) invalid('A reporter cannot be a statement descendant.');
        records.set(id, record);
        const branches: StatementBranch[] = [];
        nodes.push({block: record.snapshot, branches});
        for (const input of record.block.inputList) {
            if (input.type !== ScratchBlocks.NEXT_STATEMENT) continue;
            const branch = {input: input.name, blockIds: [] as string[]};
            branches.push(branch);
            let child = input.connection && input.connection.targetBlock();
            const vmInput = record.vmBlock.inputs[input.name];
            if ((child ? child.id : null) !== (vmInput && vmInput.block ? vmInput.block : null)) throw pending;
            let previous = input.connection;
            while (child) {
                if (!child.previousConnection || child.previousConnection.targetConnection !== previous) {
                    invalid('Invalid statement connection.');
                }
                branch.blockIds.push(child.id);
                visit(child.id, depth + 1);
                const next = child.getNextBlock();
                if ((next ? next.id : null) !== (records.get(child.id)!.vmBlock.next || null)) throw pending;
                previous = child.nextConnection;
                child = next;
            }
        }
    };
    try {
        visit(reference.blockId, 0);
    } catch (error) {
        if (error === pending) return null;
        throw error;
    }
    return {snapshot: {...reference, generation: String(generation), nodes}, records};
};

export default collectBlockEditorSubtree;
