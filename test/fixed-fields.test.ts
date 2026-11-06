import assert from 'node:assert/strict';
import {test} from 'node:test';
import {inspectFixedArgument, prepareFixedChange, restoreFixedField, captureFixedFieldState} from '../dist/turbowarp/fixed-fields.js';

class Field {
    constructor(value) {this.value_ = value; this.validator_ = null;}
    getValue() {return this.value_;}
    setValue(value) {this.value_ = value;}
    getValidator() {return this.validator_;}
    classValidator(value) {return value;}
}
class FieldTextInput extends Field {}
class FieldNumber extends FieldTextInput {}
class FieldDropdown extends Field {
    constructor(value) {super(value); this.menuGenerator_ = [['First', 'one'], ['Second', 'two']];}
    getOptions() {return typeof this.menuGenerator_ === 'function' ? this.menuGenerator_() : this.menuGenerator_;}
}
class FieldColourSlider extends Field {
    setValue(value) {
        super.setValue(value);
        if (this.sourceBlock_) this.sourceBlock_.setColour(value, value, 'changed-tertiary', 'changed-quaternary');
        this.hue_ = 99; this.saturation_ = 99; this.brightness_ = 99;
    }
    updateSliderHandles_() {}
    updateDom_() {this.renderedHSV = [this.hue_, this.saturation_, this.brightness_];}
}
const ScratchBlocks = {FieldTextInput, FieldNumber, FieldDropdown, FieldColourSlider};
function fixture(kind = 'text', role = 'editable', raw) {
    const shapes = {text: ['text', 'TEXT', FieldTextInput, 'hello'], number: ['math_number', 'NUM', FieldNumber, '001'],
        color: ['colour_picker', 'COLOUR', FieldColourSlider, '#AABBCC'],
        menu: ['demo_menu_options', 'options', FieldDropdown, 'one'], direct: ['demo_root', 'VALUE', FieldDropdown, 'one']};
    const [type, name, Class, defaultValue] = shapes[kind];
    const value = raw ?? defaultValue;
    const field = new Class(value);
    field.name = name;
    const owner = {id: kind === 'direct' ? 'parent' : 'shadow', type, isShadow: () => kind !== 'direct',
        getField: key => key === name ? field : null, inputList: [{fieldRow: [field]}]};
    const stored = {value};
    const vmOwner = {id: owner.id, opcode: type, parent: kind === 'direct' ? null : 'parent', fields: {[name]: stored}};
    const block = kind === 'direct' ? owner : {id: 'parent', type: 'demo_root', getField: () => null,
        getInput: () => ({connection: {targetBlock: () => owner}})};
    if (kind === 'direct') block.getInput = () => null;
    const vmBlock = kind === 'direct' ? vmOwner : {id: 'parent', opcode: 'demo_root', fields: {},
        inputs: {VALUE: {block: owner.id, shadow: owner.id}}};
    const target = {blocks: {getBlock: id => id === owner.id ? vmOwner : null}};
    const ids = new WeakMap(); let next = 0;
    const identify = item => {if (!ids.has(item)) ids.set(item, ++next); return ids.get(item);};
    const inspect = () => inspectFixedArgument({ScratchBlocks, block, vmBlock, target, argument: 'VALUE', role, identify, extensionId: 'demo'});
    return {field, owner, vmOwner, stored, block, vmBlock, target, inspect};
}
for (const kind of ['text', 'number', 'color', 'menu', 'direct']) {
    test(`captures standard ${kind} field and correct event owner`, () => {
        const f = fixture(kind); const result = f.inspect();
        assert.equal(result.slot.kind, 'literal'); assert.equal(result.slot.value, f.field.getValue());
        assert.equal(result.binding.block, f.owner); assert.equal(result.binding.vmBlock, f.vmOwner);
        assert.equal(result.metadata.source, kind === 'direct' ? 'field' : 'shadow');
        const next = {text: 'new', number: '-0.50e2', color: '#ABC', menu: 'two', direct: 'two'}[kind];
        assert.equal(prepareFixedChange(result.binding, next).next, next);
    });
    test(`readonly ${kind} captures raw without exposing write binding`, () => {
        const f = fixture(kind, 'readonly'); const result = f.inspect();
        assert.equal(result.slot.value, f.field.getValue()); assert.equal(result.metadata.role, 'readonly');
        assert.equal(result.binding, undefined);
    });
}
test('custom subclass, setter, validator and class validator do not execute', () => {
    for (const change of [f => Object.setPrototypeOf(f.field, new (class extends FieldTextInput {})('bad')),
        f => {f.field.setValue = () => {throw Error('must not run');};},
        f => {f.field.validator_ = () => {throw Error('must not run');};},
        f => {f.field.classValidator = () => {throw Error('must not run');};},
        f => Object.defineProperty(f.field, 'validator_', {get() {throw Error('must not run');}}),
        f => Object.defineProperty(f.field, 'value_', {get() {throw Error('must not run');}}),
        f => Object.defineProperty(f.field, 'getValue', {get() {throw Error('must not run');}})]) {
        const f = fixture(); change(f); assert.equal(f.inspect().metadata.source, 'unsupported');
    }
});
test('dynamic and accessor-backed menus are rejected without invoking providers', () => {
    for (const change of [f => {f.field.menuGenerator_ = () => {throw Error('must not run');};},
        f => Object.defineProperty(f.field, 'menuGenerator_', {get() {throw Error('must not run');}}),
        f => Object.defineProperty(f.field.menuGenerator_[0], '1', {get() {throw Error('must not run');}})]) {
        const f = fixture('menu'); change(f); assert.equal(f.inspect().metadata.source, 'unsupported');
    }
});
test('VM stale value and connections are conflicts', () => {
    const f = fixture(); f.stored.value = 'stale'; assert.equal(f.inspect(), null);
    const g = fixture(); g.vmBlock.inputs.VALUE.block = 'other'; assert.equal(g.inspect(), null);
    const h = fixture(); h.vmOwner.parent = 'other'; assert.equal(h.inspect(), null);
});
test('new menu members must exist while existing unknown raw survives no-op', () => {
    const f = fixture('menu', 'editable', 'legacy'); const binding = f.inspect().binding;
    assert.equal(prepareFixedChange(binding, 'legacy').next, 'legacy');
    assert.throws(() => prepareFixedChange(binding, 'new'));
    assert.equal(prepareFixedChange(binding, 'two').next, 'two');
});
test('new number uses finite JSON token without changing legacy raw or coercing types', () => {
    const binding = fixture('number', 'editable', 'Infinity').inspect().binding;
    assert.equal(prepareFixedChange(binding, 'Infinity').next, 'Infinity');
    for (const value of ['NaN', '-Infinity', '1e', '1e9999', '001', '0x10', '', 4, true]) assert.throws(() => prepareFixedChange(binding, value));
    for (const value of ['-0', '-0.5', ' 2.50e1 ']) assert.equal(prepareFixedChange(binding, value).next, value);
});
test('new color validation preserves exact accepted case and short spelling', () => {
    const binding = fixture('color').inspect().binding;
    for (const value of ['#abc', '#aBcDeF']) assert.equal(prepareFixedChange(binding, value).next, value);
    for (const value of ['red', '#aa', '#12zz33', 123]) assert.throws(() => prepareFixedChange(binding, value));
});
test('color rollback restores raw, all block colors and HSV display state', () => {
    const f = fixture('color');
    f.owner.colors = ['#111111', '#222222', '#333333', '#444444'];
    for (const [index, method] of ['getColour', 'getColourSecondary', 'getColourTertiary', 'getColourQuaternary'].entries()) {
        f.owner[method] = () => f.owner.colors[index];
    }
    f.owner.setColour = (...colors) => {f.owner.colors = colors;}; f.field.sourceBlock_ = f.owner;
    f.field.hue_ = 1; f.field.saturation_ = 2; f.field.brightness_ = 3;
    const binding = f.inspect().binding;
    f.field.setValue('#abc'); restoreFixedField(binding);
    assert.equal(f.field.getValue(), '#AABBCC');
    assert.deepEqual(f.owner.colors, ['#111111', '#222222', '#333333', '#444444']);
    assert.deepEqual(f.field.renderedHSV, [1, 2, 3]);
});
test('missing input gets explicit metadata without fabricating a literal', () => {
    const f = fixture(); f.block.getInput = () => null; f.vmBlock.inputs = {};
    const result = f.inspect(); assert.equal(result.metadata.source, 'missing');
    assert.equal(result.slot.kind, 'reporter'); assert.equal(result.binding, undefined);
});
test('connected reporter identity is captured without reading reporter values', () => {
    const f = fixture(); f.owner.isShadow = () => false;
    f.owner.getField = () => {throw Error('reporter evaluation');};
    const result = f.inspect(); assert.equal(result.metadata.source, 'reporter');
    assert.equal(result.slot.kind, 'reporter'); assert.equal(result.binding, undefined);
});

test('prepare detects a static menu replaced with a callback after capture', () => {
    const f = fixture('menu'); const binding = f.inspect().binding;
    f.field.menuGenerator_ = () => {throw Error('must not run');};
    assert.throws(() => prepareFixedChange(binding, 'two'), /static menu changed/);
});

test('rollback restores raw descriptors even when native color rendering throws', () => {
    const f = fixture('color'); f.field.hue_ = 5;
    const binding = f.inspect().binding;
    f.field.value_ = '#new'; f.field.hue_ = 90;
    binding.restoreValue = () => {f.field.value_ = '#partial'; throw Error('renderer');};
    assert.throws(() => restoreFixedField(binding), /renderer/);
    assert.equal(f.field.value_, '#AABBCC'); assert.equal(f.field.hue_, 5);
});

test('unsupported raw and VM field identities remain observable for dependency conflicts', () => {
    const f = fixture(); f.owner.type = 'custom_shadow'; f.vmOwner.opcode = 'custom_shadow';
    const first = f.inspect(); f.stored.value = 'external change'; const second = f.inspect();
    assert.equal(first.metadata.source, 'unsupported');
    assert.notDeepEqual(first.signatureParts, second.signatureParts);
});

test('open-time native prototype method identities reject later patches without callback execution', () => {
    for (const [prototype, name] of [[FieldTextInput.prototype, 'getValue'], [FieldTextInput.prototype, 'classValidator'],
        [Field.prototype, 'setValue'], [FieldDropdown.prototype, 'getOptions'], [FieldColourSlider.prototype, 'updateDom_']]) {
        const f = fixture(prototype === FieldDropdown.prototype ? 'menu' : prototype === FieldColourSlider.prototype ? 'color' : 'text');
        const binding = f.inspect().binding;
        const saved = Object.getOwnPropertyDescriptor(prototype, name); let calls = 0;
        Object.defineProperty(prototype, name, {configurable: true, writable: true, value: () => {calls++; throw Error('custom callback');}});
        try {
            assert.equal(f.inspect().metadata.source, 'unsupported');
            assert.throws(() => prepareFixedChange(binding, 'new'));
            assert.equal(calls, 0);
        } finally {
            if (saved) Object.defineProperty(prototype, name, saved); else delete prototype[name];
        }
    }
});

test('external field capture preserves later raw without reusing opening data', () => {
    for (const kind of ['text', 'number', 'menu', 'direct', 'color']) {
        const f = fixture(kind); const opening = f.inspect().binding;
        f.field.setValue(kind === 'color' ? '#AbC' : ' external raw ');
        const external = captureFixedFieldState(opening);
        f.field.setValue(kind === 'color' ? '#123456' : 'editor candidate');
        restoreFixedField(external);
        assert.equal(f.field.getValue(), kind === 'color' ? '#AbC' : ' external raw ');
        assert.equal(opening.value, {text: 'hello', number: '001', menu: 'one', direct: 'one', color: '#AABBCC'}[kind]);
    }
});

test('external color capture restores later display colors and HSV', () => {
    const f = fixture('color'); f.owner.colors = ['#111111', '#222222', '#333333', '#444444'];
    for (const [index, method] of ['getColour', 'getColourSecondary', 'getColourTertiary', 'getColourQuaternary'].entries()) {
        f.owner[method] = () => f.owner.colors[index];
    }
    f.owner.setColour = (...colors) => {f.owner.colors = colors;}; f.field.sourceBlock_ = f.owner;
    const opening = f.inspect().binding;
    f.field.setValue('#AbC'); f.owner.colors = ['#aaa', '#bbb', '#ccc', '#ddd'];
    f.field.hue_ = 11; f.field.saturation_ = 22; f.field.brightness_ = 33;
    const external = captureFixedFieldState(opening);
    f.field.setValue('#123456'); restoreFixedField(external);
    assert.equal(f.field.getValue(), '#AbC'); assert.deepEqual(f.owner.colors, ['#aaa', '#bbb', '#ccc', '#ddd']);
    assert.deepEqual(f.field.renderedHSV, [11, 22, 33]);
});

test('external capture does not invoke newly installed unknown field getters', () => {
    const f = fixture(); const binding = f.inspect().binding; let calls = 0;
    Object.defineProperty(f.field, 'getValue', {get() {calls++; throw Error('unknown getter');}});
    assert.throws(() => captureFixedFieldState(binding), /unsupported native field/); assert.equal(calls, 0);
});
