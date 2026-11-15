import type {NativeVM} from './native-types.js';

/** Each argument's palette default, from the extension's `getInfo`, or undefined when it cannot be read. */
export const blockDefaults = (vm: NativeVM, extensionId: string, opcode: string):
    Record<string, string | number | boolean> | undefined => {
    try {
        const extension = (vm.runtime._blockInfo || []).find(item => (item as {id?: unknown})?.id === extensionId) as
            {blocks?: readonly {info?: {opcode?: unknown; arguments?: Record<string, {defaultValue?: unknown}>}}[]} | undefined;
        const short = opcode.slice(extensionId.length + 1);
        const info = extension?.blocks?.find(item => item?.info?.opcode === short)?.info;
        if (!info) return undefined;
        const defaults: Record<string, string | number | boolean> = Object.create(null);
        for (const [name, argument] of Object.entries(info.arguments || {})) {
            const value = argument?.defaultValue;
            defaults[name] = typeof value === 'number' || typeof value === 'boolean' ? value : value === undefined ? '' : String(value);
        }
        return defaults;
    } catch {
        return undefined;
    }
};
