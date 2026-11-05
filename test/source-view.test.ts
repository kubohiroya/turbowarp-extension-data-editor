import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {createRequire} from 'node:module';
import {JSDOM} from 'jsdom';
import {parse} from 'yaml';
const dom = new JSDOM('<!doctype html><html><body></body></html>', {url: 'http://localhost/'});
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'MutationObserver']) Object.defineProperty(globalThis, name, {value: dom.window[name], configurable: true});
Object.defineProperty(globalThis, 'MessageChannel', {value: undefined, configurable: true});
after(() => dom.window.close());
const {createBlockEditorService} = await import('../dist/rjsf.js');
const {act, Simulate} = createRequire(import.meta.url)('react-dom/test-utils');
const source = {repository: 'owner', path: 'schema.ts'};
function bundle(document = true, dialect = '2020-12') {
  return {identity: {ownerId: 'owner', contractId: 'document', revision: '1', variantId: 'plain'}, dialect,
    root: {retrievalUri: 'https://owner.invalid/document', document, artifact: {role: 'canonical-schema', source}},
    resources: [], provenance: {canonicalSources: [source], generatedFiles: [], referenceSchemas: [], generationSources: []}};
}
async function fixture(t, raw = '{"x":"old"}', options = {}) {
  const format = options.format ?? 'json';
  const argument = options.argument ?? 'SOURCE';
  const service = createBlockEditorService();
  service.api.registerSourceEditor({apiVersion: 1, extensionId: 'owner', editorId: 'source', opcodes: ['owner_source'],
    validationContext: () => ({consumerId: 'test', nowMs: 1, settings: null}), bindings: [{argument,
      variants: [{variantId: 'plain', format, schemaBundle: options.bundle ?? bundle(), ...(options.uiSchema ? {uiSchema: options.uiSchema} : {})}],
      decode: source => ({source, variantId: 'plain', format, data: format === 'json' ? JSON.parse(source) : parse(source)}),
      validateSource: source => {
        try {(format === 'json' ? JSON.parse : parse)(source);return {source, result: {kind: 'valid', diagnostics: []}};}
        catch {return {source, result: {kind: 'invalid', diagnostics: [{code: 'invalid'}]}};}
      }
    }]});
  const block = {targetId: 'sprite', blockId: 'source', opcode: 'owner_source', revision: '1', arguments: {[argument]: {kind: 'literal', value: raw}}};
  const requests = [];
  const session = service.registry.open(block, {readBlock: () => block, commit: request => {requests.push(request);block.arguments[argument].value = request.changes[0].value;}});
  const container = document.createElement('div');document.body.append(container);
  let unmount;await act(async () => {unmount = session.mount(container);});
  t.after(() => {session.dispose();container.remove();});
  const byLabel = label => container.querySelector(`[aria-label="${label}"]`);
  const button = text => [...container.querySelectorAll('button')].find(el => el.textContent === text);
  const change = async (el, value) => {assert.ok(el);await act(async () => Simulate.change(el, {target: {value}}));};
  const click = async el => {assert.ok(el);await act(async () => Simulate.click(el));};
  const save = async () => {let result;await act(async () => {result = await session.save();});return result;};
  return {session, block, requests, container, byLabel, button, change, click, save, unmount: () => act(() => unmount())};
}

test('form edits preserve unknown keys and exact untouched JSON spans', async t => {
  const f = await fixture(t, ' { "x" : "old", "unknown": [1,1,null], "zero": -0 } \n');
  await f.change(f.byLabel('/x'), 'new');
  assert.equal((await f.save()).status, 'saved');
  assert.equal(f.block.arguments.SOURCE.value, ' { "x" : "new", "unknown": [1,1,null], "zero": -0 } \n');
  assert.equal(f.requests.length, 1);
});

test('invalid raw source opens Source and can be repaired before Form', async t => {
  const f = await fixture(t, '{broken');
  assert.ok(f.byLabel('SOURCE Source'));assert.equal(f.session.getState().canSave, false);
  assert.equal((await f.save()).status, 'invalid');
  await f.change(f.byLabel('SOURCE Source'), '{"x":"repaired"}');
  await f.click(f.button('Form'));assert.ok(f.byLabel('/x'));
  assert.equal((await f.save()).status, 'saved');
  assert.equal(f.block.arguments.SOURCE.value, '{"x":"repaired"}');
});

test('Form to Source and back retains pending edits and edit/revert preserves original bytes', async t => {
  const f = await fixture(t, '{ "x" : "old" }');
  await f.change(f.byLabel('/x'), 'new');await f.click(f.button('Source'));
  assert.equal(f.byLabel('SOURCE Source').value, '{ "x" : "new" }');
  await f.click(f.button('Form'));await f.change(f.byLabel('/x'), 'old');
  assert.equal((await f.save()).status, 'saved');assert.equal(f.requests.length, 0);
  assert.equal(f.block.arguments.SOURCE.value, '{ "x" : "old" }');
});

test('closed enum and compatible raw enum values use a select without rewriting no-op', async t => {
  const f = await fixture(t, '{"severity":" WARNING "}', {bundle: bundle({type: 'object', properties: {severity: {type: 'string'}}}), uiSchema: {severity: {'ui:enum': ['info','warning','error','fatal']}}});
  const select = f.byLabel('/severity');assert.equal(select.tagName, 'SELECT');
  assert.equal(JSON.parse(select.value), ' WARNING ');
  assert.equal((await f.save()).changed, false);assert.equal(f.requests.length, 0);
});

test('schema enum values maintain scalar types', async t => {
  const f = await fixture(t, '{"value":1}', {bundle: bundle({type: 'object', properties: {value: {enum: [1,2,null]}}})});
  await f.change(f.byLabel('/value'), 'null');
  assert.equal((await f.save()).status, 'saved');assert.equal(JSON.parse(f.block.arguments.SOURCE.value).value, null);
});

test('defaults, const and minItems never add absent properties on mount or remount', async t => {
  const f = await fixture(t, '{}', {bundle: bundle({type: 'object', properties: {n: {type: 'number', default: 4}, version: {const: 1}, values: {type: 'array', minItems: 2, items: {type: 'number', default: 3}}}})});
  assert.deepEqual(f.session.getDraft().sources.SOURCE.data, {});
  f.unmount();await act(async () => f.session.mount(f.container));
  assert.deepEqual(f.session.getDraft().sources.SOURCE.data, {});
  assert.equal((await f.save()).changed, false);
});

test('recursive objects and prefixItems mount finite forms while canonical validation is retained', async t => {
  const schema = {$id: 'https://owner.invalid/document', type: 'object', properties: {value: {type: 'number'}, next: {$ref: '#'}, pair: {type: 'array', prefixItems: [{type: 'string'}, {type: 'number'}], items: false}}};
  const f = await fixture(t, '{"value":1,"next":{"value":2},"pair":["a",2]}', {bundle: bundle(schema)});
  assert.ok(f.byLabel('/next/value'));assert.ok(f.byLabel('/pair/1'));
  await f.change(f.byLabel('/next/value'), '3');
  assert.equal((await f.save()).status, 'saved');assert.equal(JSON.parse(f.block.arguments.SOURCE.value).next.value, 3);
});

test('root null, arrays, booleans, numbers and strings are editable without an object wrapper', async t => {
  for (const raw of ['null','[1,1]','false','2','"text"']) {
    const f = await fixture(t, raw);assert.ok(f.byLabel('Type /'));
    assert.equal((await f.save()).changed, false);assert.equal(f.requests.length, 0);
  }
});

test('YAML scalar edits retain comments and unknown values', async t => {
  const f = await fixture(t, '# header\nx: old # note\nunknown: [1, 1, null]\n', {format: 'yaml'});
  await f.change(f.byLabel('/x'), 'new');
  assert.equal((await f.save()).status, 'saved');
  assert.equal(f.block.arguments.SOURCE.value, '# header\nx: "new" # note\nunknown: [1, 1, null]\n');
});

test('invalid numeric input cannot save the previous value and remains repairable', async t => {
  const f = await fixture(t, '{"x":1}');
  await f.change(f.byLabel('/x'), '-');
  assert.equal((await f.save()).status, 'invalid');assert.equal(f.requests.length, 0);
  await f.change(f.byLabel('/x'), '2');assert.equal((await f.save()).status, 'saved');
});

test('a valid sibling edit cannot clear a pending invalid numeric value', async t => {
  const f = await fixture(t, '{"x":1,"y":2}');
  await f.change(f.byLabel('/x'), '-');await f.change(f.byLabel('/y'), '3');
  assert.equal((await f.save()).status, 'invalid');assert.equal(f.requests.length, 0);
  await f.change(f.byLabel('/x'), '4');assert.equal((await f.save()).status, 'saved');
});

test('Cancel discards edits and unmount releases the mounted form', async t => {
  const f = await fixture(t);await f.change(f.byLabel('/x'), 'discard');
  await act(async () => f.session.cancel());assert.equal(f.requests.length, 0);assert.equal(f.container.children.length, 0);
});


test('removing or replacing an invalid numeric subtree clears only its pending input', async t => {
  const f = await fixture(t, '{"a":[1,2],"b":3}');
  await f.change(f.byLabel('/a/1'), '-');
  await f.click(f.byLabel('Remove /a/1'));
  assert.equal(f.session.getDraft().sources.SOURCE.invalidForm, false);
  await f.change(f.byLabel('/b'), '-');await f.change(f.byLabel('Type /b'), 'string');
  assert.equal((await f.save()).status, 'saved');
  assert.deepEqual(JSON.parse(f.block.arguments.SOURCE.value), {a:[1],b:''});
});

test('array removal and reorder keep invalid numeric text attached to the moved item', async t => {
  const f = await fixture(t, '{"a":[1,2,3]}');
  await f.change(f.byLabel('/a/2'), '-');await f.click(f.byLabel('Remove /a/0'));
  assert.equal(f.byLabel('/a/1').value, '-');assert.equal((await f.save()).status, 'invalid');
  await f.click(f.byLabel('Move up /a/1'));
  assert.equal(f.byLabel('/a/0').value, '-');assert.equal((await f.save()).status, 'invalid');
  await f.change(f.byLabel('/a/0'), '4');assert.equal((await f.save()).status, 'saved');
  assert.deepEqual(JSON.parse(f.block.arguments.SOURCE.value), {a:[4,2]});
});

test('edit/revert across tabs preserves noncanonical original numeric lexemes', async t => {
  const f = await fixture(t, '{ "x": 1e0 }');
  await f.change(f.byLabel('/x'), '2');await f.click(f.button('Source'));await f.click(f.button('Form'));
  await f.change(f.byLabel('/x'), '1');assert.equal((await f.save()).changed, false);
  assert.equal(f.block.arguments.SOURCE.value, '{ "x": 1e0 }');
});


test('new documents require an explicit format/variant choice and do not synthesize defaults', async t => {
  const f = await fixture(t, '', {bundle: bundle({type: 'object', properties: {n: {type: 'number', default: 4}}})});
  assert.ok(f.byLabel('SOURCE Source'));assert.equal(f.button('Create document (replace source)').disabled, true);
  await f.change(f.byLabel('SOURCE New format and variant'), JSON.stringify(['json','plain']));
  await f.click(f.button('Create document (replace source)'));
  assert.deepEqual(f.session.getDraft().sources.SOURCE.data, {});
  assert.equal((await f.save()).status, 'saved');assert.equal(f.block.arguments.SOURCE.value, '{}');
});

test('discarding a new form returns to the original invalid Source', async t => {
  const f = await fixture(t, '{broken');
  await f.change(f.byLabel('SOURCE New format and variant'), JSON.stringify(['json','plain']));
  await f.click(f.button('Create document (replace source)'));await f.click(f.button('Discard form edits'));
  assert.equal(f.byLabel('SOURCE Source').value, '{broken');assert.equal(f.requests.length, 0);
});

test('relative, anchor and external-local refs retain fixed enum widgets without mutating canonical schemas', async t => {
  for (const style of ['relative', 'anchor', 'local']) {
    const b = bundle({$id:'https://owner.invalid/document',type:'object', properties:{mode:{$ref: style === 'relative' ? 'enums#/$defs/mode' : 'https://owner.invalid/enums'+(style==='anchor'?'#mode':'#/$defs/mode')}}});
    const external = {repository:'owner',path:'enums.json'};b.provenance.canonicalSources.push(external);
    b.resources.push({retrievalUri:'https://owner.invalid/enums', document:{$id:'https://owner.invalid/enums',$defs:{mode:style==='local'?{$ref:'#/$defs/actual'}:{$anchor:'mode',type:'string',enum:['a','b']},actual:{type:'string',enum:['a','b']}}},artifact:{role:'canonical-schema',source:external}});
    const before = JSON.stringify(b);const f = await fixture(t,'{"mode":"a"}',{bundle:b});
    assert.equal(f.byLabel('/mode').tagName,'SELECT');await f.change(f.byLabel('/mode'),'"b"');
    assert.equal((await f.save()).status,'saved');assert.equal(JSON.stringify(b),before);
  }
});


test('literal unions render closed choices without inserting absent constants', async t => {
  const f = await fixture(t,'{"method":"GET"}',{bundle:bundle({type:'object',properties:{method:{anyOf:[{type:'string',const:'GET'},{type:'string',const:'POST'}]},version:{const:1}}})});
  assert.equal(f.byLabel('/method').tagName,'SELECT');
  assert.equal(f.byLabel('/version'),null);await f.change(f.byLabel('/method'),'"POST"');
  assert.equal((await f.save()).status,'saved');assert.deepEqual(JSON.parse(f.block.arguments.SOURCE.value),{method:'POST'});
});


test('prototype-like binding names require explicit creation selection', async t => {
  for (const argument of ['__proto__','constructor','toString']) {
    const f=await fixture(t,'{broken',{argument});
    assert.equal(f.button('Create document (replace source)').disabled,true);
    await f.change(f.byLabel(`${argument} New format and variant`),JSON.stringify(['json','plain']));
    assert.equal(f.button('Create document (replace source)').disabled,false);
    await f.click(f.button('Create document (replace source)'));
    assert.equal((await f.save()).status,'saved');assert.equal(f.requests.length,1);
  }
});
