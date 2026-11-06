import type {BlockSnapshot} from '../types.js';

// The adapter uses only this portion of the host's private VM and ScratchBlocks APIs.
export interface NativeField {
    name?: string;
    getValue(): unknown;
    getText(): string;
    setValue(value: string): void;
    getValidator(): unknown;
}
interface ImageField extends NativeField {
    fieldGroup_: SVGElement;
    imageElement_: {tooltip: unknown};
    setTooltip(label: string): void;
}
export interface NativeFieldClass {
    new (...args: never[]): NativeField;
    prototype: NativeField;
}
interface Connection {
    targetConnection: Connection | null;
    targetBlock(): NativeBlock | null;
}
export interface NativeBlock {
    id: string;
    type: string;
    isInFlyout?: boolean;
    inputList: Array<{name: string; type: number; fieldRow: NativeField[]; connection: Connection | null}>;
    previousConnection: Connection | null;
    nextConnection: Connection | null;
    outputConnection: Connection | null;
    isShadow(): boolean;
    isEditable(): boolean;
    getInput(name: string): NativeBlock['inputList'][number] | null;
    getField(name: string): NativeField | null;
    getParent(): NativeBlock | null;
    getNextBlock(): NativeBlock | null;
    getColour(): unknown;
    getColourSecondary(): unknown;
    getColourTertiary(): unknown;
    getColourQuaternary(): unknown;
    setColour(...colors: string[]): void;
}
export interface NativeChange {
    type: string;
    element?: string;
    name?: string;
    blockId?: string;
    ids?: string[];
    isUiEvent?: boolean;
    oldValue?: unknown;
    recordUndo: boolean;
}
export interface NativeScratchBlocks {
    INPUT_VALUE: number;
    NEXT_STATEMENT: number;
    FieldImage: new (...args: never[]) => ImageField;
    FieldTextInput: NativeFieldClass;
    FieldNumber: NativeFieldClass;
    FieldDropdown: NativeFieldClass;
    FieldColourSlider: NativeFieldClass;
    hideChaff(): void;
    Events: {
        Change: new (block: NativeBlock, element: string, name: string, before: string, after: string) => NativeChange;
        recordUndo: boolean;
        isEnabled(): boolean;
        getGroup(): string | boolean;
        setGroup(group: string | boolean): void;
        disable(): void;
        enable(): void;
    };
}
export interface NativeWorkspace {
    isFlyout?: boolean;
    options: {readOnly?: boolean};
    isDragging?(): boolean;
    getBlockById(id: string): NativeBlock | null;
    getAllBlocks(ordered: boolean): NativeBlock[];
    addChangeListener(listener: (event: NativeChange) => void): void;
    removeChangeListener(listener: (event: NativeChange) => void): void;
    undoStack_: NativeChange[];
    redoStack_: NativeChange[];
    fireChangeListener(event: NativeChange): void;
}
export interface VMField {
    [name: string]: unknown;
    id?: string;
    value: unknown;
}
export interface VMBlock {
    opcode: string;
    parent?: string | null;
    next?: string | null;
    fields: Record<string, VMField>;
    inputs: Record<string, {block?: string; shadow?: string}>;
    mutation?: unknown;
}
export interface NativeTarget {
    id: string;
    blocks: {
        getBlock(id: string): VMBlock | null;
        blocklyListen(event: NativeChange): void;
        resetCache?(): void;
    };
}
export interface NativeVM {
    editingTarget: NativeTarget | null;
    runtime: {emitProjectChanged(): void};
    on(name: string, listener: () => void): void;
    removeListener(name: string, listener: () => void): void;
}

export interface TextBinding {
    shadow: NativeBlock;
    field: NativeField;
    value: string;
}
export interface BlockRecord {
    block: NativeBlock;
    vmBlock: VMBlock;
    fields: Map<string, TextBinding>;
    snapshot: BlockSnapshot;
}
export type Identify = (value: object) => number;
