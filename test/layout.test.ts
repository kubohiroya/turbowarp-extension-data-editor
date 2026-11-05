import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {JSDOM} from 'jsdom';
import {parse} from 'yaml';
import {resolveEditorLayout} from '../dist/layout.js';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {url: 'http://localhost/'});
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'MutationObserver']) Object.defineProperty(globalThis, name, {value: dom.window[name], configurable: true});
Object.defineProperty(globalThis, 'MessageChannel', {value: undefined, configurable: true});
after(() => dom.window.close());
const {createBlockEditorService} = await import('../dist/rjsf.js');
const {act, Simulate} = createRequire(import.meta.url)('react-dom/test-utils');
const metadata = items => ({'ui:options': {extensionDataLayout: {version: 1, items}}});
const layout = metadata([{tabs: [
  {label: '基本', items: [{group: '識別', items: [{field: 'name'}]}]},
  {label: '画像', items: [{grid: 2, items: [{field: 'width'}, {field: 'height'}]}]}
]}]);
const schema = {type: 'object', properties: {name: {type: 'string', title: 'Name'},
  width: {type: 'number', minimum: 1, title: 'Width'}, height: {type: 'number', title: 'Height'}}, required: ['name', 'width'], additionalProperties: {type: 'string'}};
const source = {repository: 'test', path: 'layout.mjs'};
function bundle(document, dialect = 'draft-07') {
  return {identity: {ownerId: 'owner', contractId: 'layout', revision: '1', variantId: 'plain'}, dialect,
    root: {retrievalUri: 'https://owner.invalid/layout', document, artifact: {role: 'canonical-schema', source}},
    resources: [], provenance: {canonicalSources: [source], generatedFiles: [], referenceSchemas: [], generationSources: []}};
}
async function fixture(t, route, options = {}) {
  const flags = {commonLayout: options.enabled ?? true};
  const service = createBlockEditorService(flags);
  flags.commonLayout = false;
  const raw = options.raw ?? '{ "name":"camera", "width":640, "height":480, "extra":"kept" }';
  const uiSchema = options.uiSchema ?? layout;
  const schemaDocument = options.schema ?? schema;
  const definition = {apiVersion: 1, extensionId: 'owner', editorId: 'layout', opcodes: ['owner_layout']};
  if (route === 'source') service.api.registerSourceEditor({...definition,
    validationContext: () => ({consumerId: 'test', nowMs: 1, settings: null}), bindings: [{argument: 'SOURCE',
      variants: [{variantId: 'plain', format: options.format ?? 'json', schemaBundle: bundle(schemaDocument, options.dialect), uiSchema}],
      decode: source => ({source, variantId: 'plain', format: options.format ?? 'json', data: options.format === 'yaml' ? parse(source) : JSON.parse(source)}),
      validateSource: source => ({source, result: {kind: 'valid', diagnostics: []}})
    }]});
  else if (route === 'bundle') service.api.registerSchemaBundle({...definition, argument: 'SOURCE', schemaBundle: bundle(schemaDocument), uiSchema,
    validationContext: () => ({consumerId: 'test', nowMs: 1, settings: null})});
  else service.api.registerSchema({...definition, argument: 'SOURCE', schema: schemaDocument, uiSchema});
  const block = {targetId: 'sprite', blockId: 'layout', opcode: 'owner_layout', revision: '1', arguments: {SOURCE: {kind: 'literal', value: raw}}};
  const requests = [];
  const session = service.registry.open(block, {readBlock: () => block, commit: request => {requests.push(request);block.arguments.SOURCE.value = request.changes[0].value;}});
  const container = document.createElement('div');document.body.append(container);
  await act(async () => {session.mount(container);});
  t.after(() => {session.dispose();container.remove();});
  const tabs = () => [...container.querySelectorAll('[role="tab"]')];
  const input = name => container.querySelector(`[data-layout-field="${name}"] input:not([type="hidden"]), [data-layout-field="${name}"] textarea`);
  const click = async el => {assert.ok(el);await act(async () => Simulate.click(el));};
  const change = async (el, value) => {assert.ok(el);await act(async () => Simulate.change(el, {target: {value}}));};
  const save = async () => {let result;await act(async () => {result = await session.save();});await act(async () => {await new Promise(resolve => setTimeout(resolve, 10));});return result;};
  return {container, session, block, requests, tabs, input, click, change, save};
}

test('layout resolver rejects malformed, duplicate, unknown, excessive and non-v1 declarations as a whole', () => {
  let deep = {field: 'x'};for (let i = 0; i < 10; i++) deep = {group: 'Group', items: [deep]};
  for (const items of [[{field: 'x'}, {field: 'x'}], [{field: 'missing'}], [{grid: 5, items: []}], [deep], Array(257).fill({group: 'Group', items: []}), [{tabs: []}], [{field: 'x', render: 'code'}]]) {
    assert.equal(resolveEditorLayout(metadata(items), ['x']).kind, 'invalid');
  }
  assert.equal(resolveEditorLayout({'ui:options': {extensionDataLayout: {version: 2, items: []}}}, []).kind, 'invalid');
  assert.equal(resolveEditorLayout({}, []).kind, 'absent');
});

test('public layout types compose with both existing JSON uiSchema contracts and service overloads', () => {
  const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
  const result = spawnSync(process.execPath, [tsc, '--ignoreConfig', '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2022', '--module', 'NodeNext', '--types', 'react,react-dom', 'test/types/layout-consumer.ts'], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

for (const route of ['rjsf', 'bundle', 'source']) {
  test(`${route}: default OFF, startup capture, fallback, groups/grid and unclassified properties`, async t => {
    const off = await fixture(t, route, {enabled: false});assert.equal(off.tabs().length, 0);
    const f = await fixture(t, route);
    assert.equal(f.tabs().length, 2);assert.equal(f.tabs()[0].getAttribute('aria-selected'), 'true');
    assert.ok([...f.container.querySelectorAll('legend')].some(el => el.textContent === '識別'));
    assert.equal(f.container.querySelector('.block-editor-layout-grid').style.getPropertyValue('--editor-columns'), '2');
    assert.ok(f.container.querySelector('[data-layout-field="extra"]'));
    const bad = await fixture(t, route, {uiSchema: metadata([{field: 'missing'}])});
    assert.equal(bad.tabs().length, 0);assert.ok(bad.container.querySelector('[data-layout-diagnostic]'));
    assert.ok(bad.container.textContent.includes('Width'));
    const noLayout = await fixture(t, route, {uiSchema: {}});assert.equal(noLayout.tabs().length, 0);
    assert.equal((await noLayout.save()).status, 'saved');assert.equal(noLayout.requests.length, 0);
  });

  test(`${route}: mounted panels, keyboard, unique aria IDs, no-op and one atomic save across tabs`, async t => {
    const f = await fixture(t, route);const other = await fixture(t, route);
    assert.notEqual(f.tabs()[0].id, other.tabs()[0].id);
    assert.equal(f.container.querySelectorAll('form').length, 0);
    const width = f.input('width');assert.ok(width.closest('[hidden]'));
    await f.change(f.input('name'), 'new');
    await act(async () => Simulate.keyDown(f.tabs()[0], {key: 'End'}));
    assert.equal(f.tabs()[1].getAttribute('aria-selected'), 'true');assert.equal(document.activeElement === f.tabs()[1], true);
    assert.equal(f.input('width'), width);await f.change(width, '800');
    await f.click(f.tabs()[0]);assert.equal(f.input('name').value, 'new');
    assert.equal((await f.save()).status, 'saved');assert.equal(f.requests.length, 1);
    assert.deepEqual(JSON.parse(f.block.arguments.SOURCE.value), {name: 'new', width: 800, height: 480, extra: 'kept'});
    await other.click(other.tabs()[1]);assert.equal((await other.save()).changed, false);assert.equal(other.requests.length, 0);
  });

  test(`${route}: hidden errors have badges and failed save reveals/focuses the field`, async t => {
    const f = await fixture(t, route);
    await f.click(f.tabs()[1]);await f.change(f.input('width'), '0');await f.click(f.tabs()[0]);
    assert.equal(f.session.getState().canSave, false);assert.ok(f.tabs()[1].querySelector('[aria-label^="エラー"]'));
    assert.equal((await f.save()).status, 'invalid');assert.equal(f.tabs()[1].getAttribute('aria-selected'), 'true');
    assert.equal(document.activeElement === f.input('width'), true);assert.equal(f.requests.length, 0);
    await f.change(f.input('width'), '320');assert.equal(f.session.getState().canSave, true);
    await act(async () => {f.session.cancel();});assert.equal(f.container.childNodes.length, 0);assert.equal(f.requests.length, 0);
  });

  test(`${route}: literal keys containing dot, slash, tilde and prototype names stay distinct`, async t => {
    const keys = route === 'source' ? ['a.b', 'a/b', 'a~b', '__proto__'] : ['a.b', 'a/b', 'a~b'];
    const document = {type: 'object', properties: Object.fromEntries(keys.map(key => [key, {type: 'string'}]))};
    const f = await fixture(t, route, {schema: document, raw: JSON.stringify(Object.fromEntries(keys.map(key => [key, key]))),
      uiSchema: metadata([{tabs: keys.map(key => ({label: key, items: [{field: key}]}))}])});
    assert.equal(f.tabs().length, keys.length);
    for (let i = 0; i < keys.length; i++) {await f.click(f.tabs()[i]);assert.equal(f.input(keys[i]).value, keys[i]);}
    assert.equal((await f.save()).changed, false);
  });
}

test('Source tabs keep invalid numeric text, comments and noncanonical spans; Source repair and discard remain available', async t => {
  const f = await fixture(t, 'source', {format: 'yaml', schema: {...schema, additionalProperties: true}, raw: '# retained\nname: camera\nwidth: 640 # pixels\nheight: 480\nunknown: -0\n'});
  await f.click(f.tabs()[1]);await f.change(f.input('width'), '1e');await f.click(f.tabs()[0]);
  await f.change(f.input('name'), 'new');await f.click(f.tabs()[1]);assert.equal(f.input('width').value, '1e');
  assert.equal((await f.save()).status, 'invalid');await f.change(f.input('width'), '800');
  assert.equal((await f.save()).status, 'saved');assert.equal(f.requests.length, 1);
  assert.equal(f.block.arguments.SOURCE.value, '# retained\nname: "new"\nwidth: 800 # pixels\nheight: 480\nunknown: -0\n');
});

test('Source repair and Discard form edits retain their behavior with the layout enabled', async t => {
  const f = await fixture(t, 'source', {raw: '{broken'});
  assert.equal(f.tabs().length, 0);
  const raw = '{ "name":"camera", "width":640, "height":480 }';
  await f.change(f.container.querySelector('textarea[aria-label="SOURCE Source"]'), raw);
  const button = label => [...f.container.querySelectorAll('button')].find(element => element.textContent === label);
  await f.click(button('Form'));assert.equal(f.tabs().length, 2);
  await f.click(f.tabs()[1]);await f.change(f.input('width'), '1e');
  await f.click(button('Source'));assert.equal(f.input('width').value, '1e');
  await f.click(button('Discard form edits'));
  assert.equal(f.container.querySelector('textarea[aria-label="SOURCE Source"]').value, raw);
  await f.click(button('Form'));await f.click(f.tabs()[1]);assert.equal(f.input('width').value, '640');
  assert.equal((await f.save()).changed, true);assert.equal(f.requests.length, 1);
  assert.equal(f.block.arguments.SOURCE.value, raw);
});

for (const route of ['rjsf', 'bundle', 'source']) test(`${route}: nested hidden panels reveal the actual invalid child`, async t => {
  const schemaDocument = {type: 'object', properties: {name: {type: 'string'}, inner: {type: 'object', properties: {
    width: {type: 'number'}, height: {type: 'number', minimum: 1}
  }}}};
  const uiSchema = {...metadata([{tabs: [{label: '外側A', items: [{field: 'name'}]}, {label: '外側B', items: [{field: 'inner'}]}]}]),
    inner: metadata([{tabs: [{label: '内側A', items: [{field: 'width'}]}, {label: '内側B', items: [{field: 'height'}]}]}])};
  const f = await fixture(t, route, {schema: schemaDocument, uiSchema, raw: '{"name":"camera","inner":{"width":10,"height":5}}'});
  await f.click(f.tabs()[1]);await f.click(f.tabs()[3]);await f.change(f.input('height'), '0');
  await f.click(f.tabs()[2]);await f.click(f.tabs()[0]);
  assert.equal((await f.save()).status, 'invalid');
  assert.equal(f.tabs()[1].getAttribute('aria-selected'), 'true');assert.equal(f.tabs()[3].getAttribute('aria-selected'), 'true');
  assert.equal(document.activeElement === f.input('height'), true);
});

test('Source schema-shaped fields hide redundant controls without rewriting fixed or unknown values', async t => {
  const schema = {type: 'object', properties: {cameraId: {type: 'string'}, enabled: {type: 'boolean'},
    kind: {const: 'camera'}, matrix: {type: 'array', items: {type: 'number'}, minItems: 2, maxItems: 2}},
    required: ['cameraId', 'enabled', 'kind', 'matrix'], additionalProperties: false};
  const raw = '{ "cameraId":"left", "enabled":true, "kind":"camera", "matrix":[-0,1e0] }';
  const f = await fixture(t, 'source', {schema, uiSchema: {}, raw});
  assert.equal(f.container.querySelectorAll('[data-source-type-control]').length, 0);
  assert.equal(f.container.querySelectorAll('button[aria-label^="Remove"],button[aria-label^="Add item"],input[aria-label^="New property"]').length, 0);
  assert.equal(f.container.querySelector('[data-source-path="/cameraId"] label').textContent, 'Camera ID *');
  assert.ok(f.container.querySelector('[data-source-path="/cameraId"] input[type="text"]'));
  assert.equal(f.container.querySelector('[data-source-path="/kind"] input').readOnly, true);
  assert.equal((await f.save()).changed, false);assert.equal(f.block.arguments.SOURCE.value, raw);
  const off = await fixture(t, 'source', {schema, uiSchema: {}, raw, enabled: false});
  assert.ok(off.container.querySelector('[data-source-type-control]'));
  assert.ok(off.container.querySelector('button[aria-label="Remove /cameraId"]'));
  assert.equal(off.container.querySelector('[data-editor-form]'), null);
});

test('Source optional fields remain explicitly addable/removable without defaults or losing invalid-number drafts', async t => {
  const schema = {type: 'object', properties: {name: {type: 'string'}, count: {type: 'number', default: 99}}, required: ['name'], additionalProperties: false};
  const f = await fixture(t, 'source', {schema, uiSchema: {}, raw: '{"name":"cam"}'});
  assert.equal(f.container.querySelector('[data-source-path="/count"]'), null);
  const add = [...f.container.querySelectorAll('button')].find(button => button.textContent === 'Countを追加');await f.click(add);
  const count = () => f.container.querySelector('[data-source-path="/count"] input');assert.equal(count().value, '0');
  await f.change(count(), '1e');assert.equal(f.session.getState().canSave, false);
  assert.equal(f.container.querySelector('button[aria-label="Remove /name"]'), null);
  await f.click(f.container.querySelector('button[aria-label="Remove /count"]'));
  assert.equal(f.session.getState().canSave, true);
  assert.equal((await f.save()).changed, false);assert.equal(f.requests.length, 0);
});

test('Source unions and invalid fixed-type data keep explicit repair controls; closed unknown keys remain removable', async t => {
  const schema = {type: 'object', properties: {fixed: {type: 'number'}, union: {oneOf: [{type: 'number'}, {type: 'string'}]}}, required: ['fixed', 'union'], additionalProperties: false};
  const f = await fixture(t, 'source', {schema, uiSchema: {}, raw: '{"fixed":"bad","union":2,"extra":"preserved"}'});
  const fixed = f.container.querySelector('select[aria-label="Type /fixed"]');assert.ok(fixed);
  assert.ok(f.container.querySelector('select[aria-label="Type /union"]'));
  assert.equal(f.container.querySelector('[data-source-path="/extra"] input').value, 'preserved');
  assert.equal((await f.save()).status, 'invalid');
  await f.change(fixed, 'number');await f.click(f.container.querySelector('button[aria-label="Remove /extra"]'));
  assert.equal(f.session.getState().canSave, true);assert.equal((await f.save()).status, 'saved');
  assert.deepEqual(JSON.parse(f.block.arguments.SOURCE.value), {fixed: 0, union: 2});
});

test('Source fixed prefixItems and draft-07 tuples hide structure operations but retain editable values', async t => {
  for (const [dialect, items] of [['2020-12', {prefixItems: [{type: 'number'}, {type: 'string'}], items: false}],
    ['draft-07', {items: [{type: 'number'}, {type: 'string'}], additionalItems: false}]]) {
    const f = await fixture(t, 'source', {schema: {type: 'array', ...items, minItems: 2}, uiSchema: {}, dialect, raw: '[1,"x"]'});
    assert.equal(f.container.querySelectorAll('[data-source-type-control],button[aria-label^="Remove"],button[aria-label^="Add item"],button[aria-label^="Move up"]').length, 0);
    const input = f.container.querySelector('[data-source-path="/0"] input');await f.change(input, '2');
    assert.equal((await f.save()).status, 'saved');assert.deepEqual(JSON.parse(f.block.arguments.SOURCE.value), [2, 'x']);
  }
});

for (const route of ['rjsf', 'bundle', 'source']) test(`${route}: checkbox labels respect explicit titles and required closed fields have no structure controls`, async t => {
  const schema = {type: 'object', properties: {undistorted: {type: 'boolean'}, enabled: {type: 'boolean', title: 'カメラを有効にする'}, custom: {type: 'boolean'}}, required: ['undistorted', 'enabled', 'custom'], additionalProperties: false};
  const f = await fixture(t, route, {schema, uiSchema: {custom: {'ui:title': 'keep my label'}}, raw: '{"undistorted":false,"enabled":true,"custom":true}'});
  assert.equal(f.container.querySelectorAll('input[type="checkbox"]').length, 3);
  assert.ok([...f.container.querySelectorAll('label')].some(label => label.textContent.trim() === 'Undistorted'));
  assert.ok([...f.container.querySelectorAll('label')].some(label => label.textContent.trim() === 'カメラを有効にする'));
  assert.ok([...f.container.querySelectorAll('label')].some(label => label.textContent.trim() === 'keep my label'));
  assert.equal(f.container.querySelectorAll('[data-source-type-control],input[aria-label^="New property"],button[aria-label^="Remove"],[data-block-editor-add-item]').length, 0);
  assert.equal((await f.save()).changed, false);
});

test('Source if/then array controls follow the selected model without synthesizing or discarding coefficients', async t => {
  const schema = {type: 'object', properties: {model: {enum: ['none', 'fixed']}, coefficients: {type: 'array', items: {type: 'number'}}}, required: ['model', 'coefficients'], additionalProperties: false,
    allOf: [{if: {properties: {model: {const: 'none'}}, required: ['model']}, then: {properties: {coefficients: {maxItems: 0}}}},
      {if: {properties: {model: {const: 'fixed'}}, required: ['model']}, then: {properties: {coefficients: {minItems: 2, maxItems: 2}}}}]};
  const f = await fixture(t, 'source', {schema, uiSchema: {}, raw: '{"model":"none","coefficients":[]}'});
  const add = () => f.container.querySelector('button[aria-label="Add item /coefficients"]');
  assert.equal(add(), null);
  const model = f.container.querySelector('[data-source-path="/model"] select');await f.change(model, '"fixed"');
  assert.equal(f.container.querySelectorAll('[data-source-path="/coefficients/0"]').length, 0);assert.equal(f.session.getState().canSave, false);
  await f.click(add());await f.click(add());assert.equal(add(), null);assert.equal(f.session.getState().canSave, true);
  assert.equal(f.container.querySelector('button[aria-label="Remove /coefficients/0"]'), null);
  await f.change(model, '"none"');
  assert.equal(f.container.querySelectorAll('[data-source-path="/coefficients/0"]').length, 1);assert.equal(f.session.getState().canSave, false);
  await f.click(f.container.querySelector('button[aria-label="Remove /coefficients/1"]'));
  await f.click(f.container.querySelector('button[aria-label="Remove /coefficients/0"]'));
  assert.equal((await f.save()).changed, false);assert.equal(f.requests.length, 0);
});

for (const route of ['rjsf', 'bundle', 'source']) test(`${route}: absent and blank descriptions render no help while real descriptions remain available`, async t => {
  const descriptions = {missing: undefined, empty: '', spaces: ' \t\n　', short: 'Short field help.', long: 'Long field help. '.repeat(12)};
  const nested = {type: 'object', description: ' \n ', properties: Object.fromEntries(Object.entries(descriptions).map(([key, description]) =>
    [key, {type: key === 'long' ? 'boolean' : 'string', ...(description === undefined ? {} : {description})}]))};
  const schema = {type: 'object', description: '', properties: {nested, flag: {type: 'boolean', description: '\t '}}};
  const raw = JSON.stringify({nested: {missing: 'a', empty: 'b', spaces: 'c', short: 'd', long: true}, flag: false});
  const f = await fixture(t, route, {schema, raw, uiSchema: {}});
  const help = [...f.container.querySelectorAll('.editor-form-hint, .editor-form-help')];
  assert.equal(help.length, 2);
  assert.equal(help[0].textContent, descriptions.short);
  assert.equal(help[1].querySelector('summary').textContent, '説明を表示');
  assert.equal(help[1].querySelector('p').textContent, descriptions.long);
  assert.equal(help[1].open, false);
  help[1].open = true;
  assert.ok(help[1].textContent.includes(descriptions.long));
  if (route === 'source') {
    for (const key of ['missing', 'empty', 'spaces']) assert.equal(f.container.querySelector(`[data-source-path="/nested/${key}"] input`).hasAttribute('aria-describedby'), false);
    const input = f.container.querySelector('[data-source-path="/nested/short"] input');
    assert.equal(document.getElementById(input.getAttribute('aria-describedby')).textContent, descriptions.short);
  }
  assert.equal((await f.save()).changed, false);
  assert.equal(f.block.arguments.SOURCE.value, raw);
});
