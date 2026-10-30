const owns = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const own = (object, key) => {
    const descriptor = object && Object.getOwnPropertyDescriptor(object, key);
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
};
const primitive = value => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
const token = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/u;

// Inspect data properties without invoking custom field accessors or menu providers.
const inherited = (object, name) => {
    for (let current = object; current; current = Object.getPrototypeOf(current)) {
        const descriptor = Object.getOwnPropertyDescriptor(current, name);
        if (descriptor) return 'value' in descriptor ? descriptor.value : undefined;
    }
    return undefined;
};
const storage = ['text_', 'value_', 'colour_', 'validator_', 'sourceBlock_', 'hue_', 'saturation_', 'brightness_'];
const methods = ['getValue', 'getText', 'setValue', 'setText', 'getValidator', 'classValidator', 'callValidator',
    'getOptions', 'forceRerender', 'updateSliderHandles_', 'updateDom_'];
const trustedClasses = new WeakMap();
/** Freeze native method identities once when the host attaches, before opening editors. */
export function initializeFixedFields(ScratchBlocks) {
    for (const key of ['FieldTextInput', 'FieldNumber', 'FieldDropdown', 'FieldColourSlider']) {
        const Class = ScratchBlocks[key];
        if (typeof Class !== 'function' || trustedClasses.has(Class)) continue;
        const chain = [];
        for (let prototype = Class.prototype; prototype && prototype !== Object.prototype;
            prototype = Object.getPrototypeOf(prototype)) {
            chain.push({prototype, own: methods.map(name => [name, Object.getOwnPropertyDescriptor(prototype, name)])});
        }
        trustedClasses.set(Class, {prototype: Class.prototype, chain,
            methods: methods.map(name => [name, inherited(Class.prototype, name)])});
    }
}
const safeField = (field, Class) => {
    const trusted = Class && trustedClasses.get(Class);
    if (!trusted || Class.prototype !== trusted.prototype || Object.getPrototypeOf(field) !== trusted.prototype) return false;
    let currentPrototype = trusted.prototype;
    for (const entry of trusted.chain) {
        if (currentPrototype !== entry.prototype) return false;
        for (const [name, expected] of entry.own) {
            const actual = Object.getOwnPropertyDescriptor(currentPrototype, name);
            if (Boolean(actual) !== Boolean(expected) ||
                (actual && (!('value' in actual) || !expected || !('value' in expected) || actual.value !== expected.value))) return false;
        }
        currentPrototype = Object.getPrototypeOf(currentPrototype);
    }
    if (currentPrototype !== Object.prototype && currentPrototype !== null) return false;
    for (const name of storage) {
        for (let current = field; current; current = Object.getPrototypeOf(current)) {
            const descriptor = Object.getOwnPropertyDescriptor(current, name);
            if (!descriptor) continue;
            if (!('value' in descriptor)) return false;
            break;
        }
    }
    for (const [name, expected] of trusted.methods) {
        if (owns(field, name) || inherited(field, name) !== expected) return false;
    }
    for (let current = field; current; current = Object.getPrototypeOf(current)) {
        const descriptor = Object.getOwnPropertyDescriptor(current, 'validator_');
        if (descriptor) return 'value' in descriptor && descriptor.value == null;
    }
    return false;
};
const arrayData = value => {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
    const result = [];
    for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !('value' in descriptor)) return null;
        result.push(descriptor.value);
    }
    return result;
};
const staticValues = field => {
    const items = arrayData(own(field, 'menuGenerator_'));
    if (!items || items.length === 0) return null;
    const values = [];
    for (const item of items) {
        const tuple = arrayData(item);
        if (!tuple || tuple.length !== 2 || typeof tuple[0] !== 'string' || typeof tuple[1] !== 'string') return null;
        values.push(tuple[1]);
    }
    return Object.freeze(values);
};
const rawKeys = ['text_', 'value_', 'colour_', 'hue_', 'saturation_', 'brightness_'];
const ownState = (object, keys) => keys.map(name => [name, Object.getOwnPropertyDescriptor(object, name)]);
const restoreOwnState = (object, state) => {
    for (const [name, descriptor] of state) {
        if (descriptor) Object.defineProperty(object, name, descriptor);
        else delete object[name];
    }
};
const vmFieldsIdentity = (fields, identify) => Object.keys(fields || {}).sort().map(name => {
    const descriptor = Object.getOwnPropertyDescriptor(fields, name);
    if (!descriptor || !('value' in descriptor)) return [name, 'accessor'];
    const stored = descriptor.value;
    if (!stored || typeof stored !== 'object') return [name, typeof stored, String(stored)];
    return [name, identify(stored), ...Object.keys(stored).sort().map(key => {
        const item = Object.getOwnPropertyDescriptor(stored, key);
        if (!item || !('value' in item)) return [key, 'accessor'];
        const value = item.value;
        return [key, typeof value, primitive(value) ? (Object.is(value, -0) ? '-0' : String(value)) :
            value && (typeof value === 'object' || typeof value === 'function') ? identify(value) : String(value)];
    })];
});
const colorState = (block, field) => {
    const colors = ['getColour', 'getColourSecondary', 'getColourTertiary', 'getColourQuaternary'];
    return {
        colors: colors.map(name => typeof block[name] === 'function' ? block[name]() : undefined),
        hsv: ['hue_', 'saturation_', 'brightness_'].map(name => [name, own(field, name)]),
        blockProperties: ownState(block, ['colour_', 'colourSecondary_', 'colourTertiary_', 'colourQuaternary_'])
    };
};

/** Native objects stay local; only primitive metadata is returned in snapshots. */
export function inspectFixedArgument({ScratchBlocks, block, vmBlock, target, argument, role, identify, extensionId}) {
    initializeFixedFields(ScratchBlocks);
    const sourceIdentity = [argument, identify(block), identify(vmBlock)];
    let observedFields = [];
    const unavailable = (source, reason, raw) => ({
        slot: primitive(raw) ? {kind: 'literal', value: raw} : {kind: 'reporter'},
        metadata: {role, source, identity: JSON.stringify([...sourceIdentity, source]), reason},
        signatureParts: [...sourceIdentity, observedFields]
    });
    const direct = block.getField(argument);
    const input = block.getInput(argument);
    const connected = input && input.connection && input.connection.targetBlock();
    const vmInput = vmBlock.inputs && vmBlock.inputs[argument];
    if ((connected ? connected.id : null) !== (vmInput && vmInput.block ? vmInput.block : null)) return null;
    if (direct && connected) return null;
    if (connected && !connected.isShadow()) {
        const vmReporter = target.blocks.getBlock(connected.id);
        if (!vmReporter || vmReporter.opcode !== connected.type || vmReporter.parent !== block.id) return null;
        sourceIdentity.push(identify(connected), identify(vmReporter), connected.id, connected.type);
        return {slot: {kind: 'reporter'}, metadata: {role, source: 'reporter', identity: JSON.stringify(sourceIdentity)},
            signatureParts: sourceIdentity};
    }
    let owner = direct ? block : connected;
    if (!owner) {
        if (vmBlock.fields && owns(vmBlock.fields, argument)) return null;
        return unavailable('missing', 'The declared field or input is missing.');
    }
    const vmOwner = direct ? vmBlock : target.blocks.getBlock(owner.id);
    if (!vmOwner || vmOwner.opcode !== owner.type) return null;
    sourceIdentity.push(identify(owner), identify(vmOwner), owner.id, owner.type);
    observedFields = vmFieldsIdentity(vmOwner.fields, identify);
    if (!direct && (!vmInput || vmInput.shadow !== owner.id || vmOwner.parent !== block.id)) return null;
    let kind;
    let name;
    let Class;
    if (direct) {
        kind = 'menu'; name = argument; Class = ScratchBlocks.FieldDropdown;
    } else if (owner.type === 'text') {
        kind = 'text'; name = 'TEXT'; Class = ScratchBlocks.FieldTextInput;
    } else if (owner.type === 'math_number') {
        kind = 'number'; name = 'NUM'; Class = ScratchBlocks.FieldNumber;
    } else if (owner.type === 'colour_picker') {
        kind = 'color'; name = 'COLOUR'; Class = ScratchBlocks.FieldColourSlider;
    } else if (typeof extensionId === 'string' && owner.type.startsWith(`${extensionId}_menu_`)) {
        kind = 'menu'; Class = ScratchBlocks.FieldDropdown;
        const names = [];
        for (const row of owner.inputList) for (const candidate of row.fieldRow) {
            const candidateName = own(candidate, 'name');
            if (typeof candidateName === 'string' && candidateName) names.push(candidateName);
        }
        if (names.length !== 1) return unavailable('unsupported', 'The menu shadow does not have one standard field.');
        [name] = names;
    } else return unavailable('unsupported', 'The shadow field family is unsupported.');
    const field = direct || owner.getField(name);
    const stored = vmOwner.fields && vmOwner.fields[name];
    if (!field || !stored) return null;
    sourceIdentity.push(identify(field), name);
    const raw = own(stored, 'value');
    if (!safeField(field, Class)) return unavailable('unsupported', 'The field class, methods or validator is unsupported.', raw);
    const value = inherited(Class.prototype, 'getValue').call(field);
    // SB3 numeric primitives remain numbers in the VM while FieldNumber displays a string.
    // Preserve the original VM primitive in the snapshot; only equivalent native numeric text
    // is a synchronized representation. Other field families still require exact raw identity.
    const numericPrimitive = kind === 'number' && typeof raw === 'number' && Number.isFinite(raw) &&
        typeof value === 'string' && token.test(value.trim()) && Number(value) === raw;
    if (!Object.is(value, raw) && !numericPrimitive) return null;
    if (typeof value !== 'string') return unavailable('unsupported', 'The native field value is not a string.', raw);
    const allowedValues = kind === 'menu' ? staticValues(field) : undefined;
    if (kind === 'menu' && !allowedValues) return unavailable('unsupported', 'Dynamic or nonstandard menus are unsupported.', raw);
    sourceIdentity.push(kind, ...(allowedValues || []));
    const binding = {block: owner, field, fieldName: name, value, vmBlock: vmOwner, kind,
        Class, prototype: Class.prototype, allowedValues,
        restoreValue: inherited(Class.prototype, 'setValue'), rawState: ownState(field, rawKeys),
        restoreHandles: inherited(Class.prototype, 'updateSliderHandles_'),
        restoreDom: inherited(Class.prototype, 'updateDom_'),
        ...(kind === 'color' ? {restoreState: colorState(owner, field)} : {})};
    return {slot: {kind: 'literal', value: numericPrimitive ? raw : value}, metadata: {role, source: direct ? 'field' : 'shadow',
        identity: JSON.stringify(sourceIdentity), field: {blockId: owner.id, name, type: {text: 'FieldTextInput', number: 'FieldNumber', menu: 'FieldDropdown', color: 'FieldColourSlider'}[kind]}},
    ...(role === 'editable' ? {binding} : {}), signatureParts: [...sourceIdentity, observedFields]};
}

/** Validate the exact saved primitive; native setters must not silently normalize it. */
export function prepareFixedChange(binding, value) {
    if (!binding || !safeField(binding.field, binding.Class) || typeof value !== 'string') {
        throw new TypeError('Only standard native string field writes are supported.');
    }
    if (binding.kind === 'menu') {
        const currentValues = staticValues(binding.field);
        if (!currentValues || currentValues.length !== binding.allowedValues.length ||
            currentValues.some((item, index) => item !== binding.allowedValues[index])) {
            throw new TypeError('The static menu changed before preparing the write.');
        }
    }
    if (value !== binding.value) {
        if (binding.kind === 'number' && (!token.test(value.trim()) || !Number.isFinite(Number(value)))) {
            throw new TypeError('Expected a finite numeric field token.');
        }
        if (binding.kind === 'color' && !/^#(?:[a-f0-9]{3}|[a-f0-9]{6})$/iu.test(value)) {
            throw new TypeError('Expected a hexadecimal color field token.');
        }
        if (binding.kind === 'menu' && !binding.allowedValues.includes(value)) {
            throw new TypeError('Expected a declared static menu value.');
        }
    }
    return {...binding, next: value};
}

/** Capture a later external value without invoking replacement field methods. */
export function captureFixedFieldState(binding) {
    if (!binding || !safeField(binding.field, binding.Class)) {
        throw new TypeError('Cannot capture an unsupported native field.');
    }
    const value = inherited(binding.prototype, 'getValue').call(binding.field);
    if (typeof value !== 'string') throw new TypeError('Expected a native string field.');
    return {...binding, value, rawState: ownState(binding.field, rawKeys),
        ...(binding.kind === 'color' ? {restoreState: colorState(binding.block, binding.field)} : {})};
}

/** Restore raw text and the standard color field's additional block/UI state. */
export function restoreFixedField(binding) {
    let failure;
    try {binding.restoreValue.call(binding.field, binding.value);} catch (error) {failure = error;}
    // The standard setters can update raw data before renderer code throws.
    // Restore primitive descriptors independently so renderer failure cannot retain new data.
    restoreOwnState(binding.field, binding.rawState);
    if (binding.restoreState) {
        const colors = binding.restoreState.colors;
        try {
            if (colors.every(value => typeof value === 'string')) binding.block.setColour(...colors);
        } catch (error) {failure = failure || error;}
        restoreOwnState(binding.block, binding.restoreState.blockProperties);
        try {binding.restoreHandles.call(binding.field);} catch (error) {failure = failure || error;}
        try {binding.restoreDom.call(binding.field);} catch (error) {failure = failure || error;}
    }
    if (failure) throw failure;
}
