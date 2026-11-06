import assert from 'node:assert/strict';
import test from 'node:test';
import {parseDocument} from 'yaml';

const {patchSource} = await import(process.env.SOURCE_DOCUMENT_MODULE ?? '../dist/source-document.js');
const parse = (source, format) => format === 'json' ? JSON.parse(source) : parseDocument(source[0] === '\uFEFF' ? source.slice(1) : source).toJS();
const patch = (source, format, edited) => patchSource(source, format, parse(source, format), edited);

for (const format of ['json', 'yaml']) {
  test(`${format}: no-op and edit/revert retain raw bytes without normalization`, () => {
    const source = format === 'json'
      ? ' \r\n{ "name" : "\\u65e5", "list": [1,1,2], "unknown": {"x":1e2} }\t\r\n'
      : '\uFEFF# 日本語\r\nname: \'日本\' # inline\r\nlist: [1, 1, 2]\r\nunknown: {x: 1e2}\r\n';
    const value = parse(source, format);
    assert.equal(patchSource(source, format, value, structuredClone(value)), source);
    const draft = structuredClone(value);
    draft.name = '別の値';
    draft.name = value.name;
    assert.equal(patchSource(source, format, value, draft), source);
  });
  test(`${format}: source mismatch rejects changes, not no-op`, () => {
    assert.throws(() => patchSource(format === 'json' ? '{"a":1}' : 'a: 1\n', format, {a: 2}, {a: 3}));
    const malformed = format === 'json' ? '{"a":' : 'a: [';
    assert.equal(patchSource(malformed, format, {}, {}), malformed);
    assert.throws(() => patchSource(malformed, format, {}, {a: 1}));
  });
  test(`${format}: explicit creation from empty input and whitespace`, () => {
    for (const source of ['', ' \t\r\n']) {
      assert.equal(patchSource(source, format, {}, {}), source);
      const result = patchSource(source, format, {}, {created: ['日本語', null]});
      assert.deepEqual(parse(result, format), {created: ['日本語', null]});
    }
  });
  test(`${format}: getters and custom iterators are not called`, () => {
    let calls = 0;
    const accessor = Object.defineProperty({}, 'x', {enumerable: true, get() {calls++; return 1;}});
    const iterator = [1];
    Object.defineProperty(iterator, Symbol.iterator, {value() {calls++; return [][Symbol.iterator]();}});
    for (const unsafe of [accessor, iterator]) {
      assert.throws(() => patchSource('{}', format, {}, unsafe));
      assert.throws(() => patchSource('{}', format, unsafe, {}));
    }
    assert.equal(calls, 0);
  });
  test(`${format}: root primitive, null, array and type changes preserve outer whitespace`, () => {
    for (const [source, edited] of [[' \nnull\r\n', [1, null, '日本語']], [' [1, 1, 2] \n', null], [' "text"\n', {flag: false}], ['42\n', 'word']]) {
      const result = patch(source, format, edited);
      assert.deepEqual(parse(result, format), edited);
      assert.equal(result.startsWith(source.match(/^\s*/)[0]), true);
      assert.equal(result.endsWith(source.match(/\s*$/)[0]), true);
    }
  });
  test(`${format}: nested arrays preserve order and duplicates through insertion/deletion`, () => {
    const before = {list: [1, 1, 2, {deep: [3, 3, 4]}], untouched: [7, 7, 8]};
    const source = format === 'json' ? JSON.stringify(before) : 'list: [1, 1, 2, {deep: [3, 3, 4]}]\nuntouched: [7, 7, 8]\n';
    const edited = {list: [1, 2, 1, {deep: [3, 4, 3, 4]}, null], untouched: [7, 7, 8]};
    const result = patchSource(source, format, before, edited);
    assert.deepEqual(parse(result, format), edited);
    assert.ok(result.includes(format === 'json' ? '"untouched":[7,7,8]' : 'untouched: [7, 7, 8]\n'));
  });
  test(`${format}: special object keys remain own properties`, () => {
    const before = JSON.parse('{"__proto__":{"kept":true},"constructor":1,"a/b~日本":2}');
    const edited = JSON.parse('{"__proto__":{"kept":true},"constructor":3,"a/b~日本":2,"new:#[]":null}');
    const source = JSON.stringify(before);
    assert.deepEqual(parse(patchSource(source, format, before, edited), format), edited);
    assert.equal({}.kept, undefined);
  });
  test(`${format}: additions and deletions can empty a collection`, () => {
    for (const [before, after] of [[{a: 1, b: 2}, {}], [[1, 1, 2], []], [{}, {a: 1}], [[], [1, 1]], [{a: 1, b: 2}, {c: 3}], [[1, 2], [3, 4, 5]]]) {
      const source = JSON.stringify(before);
      assert.deepEqual(parse(patchSource(source, format, before, after), format), after);
    }
  });
}

test('JSON: scalar changes leave every other byte intact', () => {
  const source = '{\r\n\t"text" : "old",\r\n\t"unknown": { "x" : 1e+02 }, "arr": [1, 1, 2]\r\n}\r\n';
  const before = JSON.parse(source);
  assert.equal(patchSource(source, 'json', before, {...before, text: '日本語'}), source.replace('"old"', '"日本語"'));
});
test('JSON: deletions retain whitespace and unedited escape/numeric lexemes', () => {
  const source = '{ "a" : 1, "b": "\\u65e5", "c": 1e+02 }\n';
  const result = patch(source, 'json', {b: '日', c: 100, added: true});
  assert.deepEqual(JSON.parse(result), {b: '日', c: 100, added: true});
  assert.ok(result.includes('"b": "\\u65e5"'));
  assert.ok(result.includes('"c": 1e+02'));
});
test('JSON: JSONC, trailing commas, BOM and non-finite values do not gain edit support', () => {
  for (const source of ['{"a":1,}', '{/* comment */"a":1}', '\uFEFF{"a":1}', 'NaN', 'Infinity']) {
    assert.throws(() => patchSource(source, 'json', {a: 1}, {a: 2}));
  }
  for (const unsafe of [NaN, Infinity, undefined, 1n, new Date(), new Map(), Object.assign([], {extra: 1})]) {
    assert.throws(() => patchSource('null', 'json', null, unsafe));
  }
});
test('JSON: duplicate-key no-op is raw and updates patch only the winning occurrence', () => {
  const source = '{"x":1,"x":2,"keep":3}';
  const before = JSON.parse(source);
  assert.equal(patchSource(source, 'json', before, before), source);
  assert.equal(patchSource(source, 'json', before, {...before, x: 4}), '{"x":1,"x":4,"keep":3}');
});

test('YAML: BOM, CRLF, comments, unknown keys and unedited block scalars remain byte-identical', () => {
  const source = '\uFEFF# top\r\ntext: \'old\'  # stay\r\nunknown: |\r\n  line one\r\n  日本語\r\nlist: [1, 1, 2] # duplicate\r\n';
  const before = parse(source, 'yaml');
  const result = patchSource(source, 'yaml', before, {...before, text: '新しい値'});
  assert.equal(result, source.replace("'old'", '"新しい値"'));
});
test('YAML: flow edits preserve comments inside and around unchanged nodes', () => {
  const source = '{ a: 1, # first\n b: [1, 1, 2], c: "stay" } # end\n';
  const result = patch(source, 'yaml', {a: 2, b: [1, 0, 1, 2], c: 'stay', added: true});
  assert.deepEqual(parse(result, 'yaml'), {a: 2, b: [1, 0, 1, 2], c: 'stay', added: true});
  assert.ok(result.includes('# first\n'));
  assert.ok(result.endsWith(' # end\n'));
  assert.ok(result.includes('c: "stay"'));
});
test('YAML: block map add/delete preserve inline comments and unknown byte ranges', () => {
  const source = '# top\na: 1 # old entry comment\nb: \'unchanged\'\nnested:\n  x: 1\n  unknown: 1e2\n';
  const result = patch(source, 'yaml', {b: 'unchanged', nested: {x: 2, unknown: 100, added: [true, null]}, added: 'new'});
  assert.deepEqual(parse(result, 'yaml'), {b: 'unchanged', nested: {x: 2, unknown: 100, added: [true, null]}, added: 'new'});
  assert.ok(result.startsWith('# top\n'));
  assert.ok(result.includes('# old entry comment\n'));
  assert.ok(result.includes("b: 'unchanged'\n"));
  assert.ok(result.includes('  unknown: 1e2\n'));
});
test('YAML: block sequence insertion, deletion, emptying and compact maps', () => {
  const cases = [
    ['- 1 # first\n- 1\n- 2 # last\n', [1, 0, 1, 2]],
    ['- 1 # first\n- 1\n- 2 # last\n', [1, 2]],
    ['- 1 # first\n- 2 # last\n', []],
    ['x:\n  - a: 1\n    b: 2\n  - a: 3\n    b: 4\ny: 5\n', {x: [{a: 2, b: 2}, {a: 3, b: 4}, {a: 7}], y: 5}],
    ['x:\n- 1\n- 2\ny: 3', {x: [0, 1, 2], y: 3}],
    ['x:\n  a: 1 # a\n  b: 2 # b\ny: 3\n', {x: {}, y: 3}]
  ];
  for (const [source, edited] of cases) {
    const result = patch(source, 'yaml', edited);
    assert.deepEqual(parse(result, 'yaml'), edited, JSON.stringify(result));
    for (const comment of source.match(/#[^\r\n]*/g) ?? []) assert.ok(result.includes(comment));
  }
});
test('YAML: block scalar and nested type changes replace only the edited span', () => {
  const source = 'message: |\n  hello\n  world\nkeep: \'same\'\nnested:\n  x: 1\ntail: true\n';
  const result = patch(source, 'yaml', {message: 'new\ntext\n', keep: 'same', nested: [1, null], tail: true});
  assert.deepEqual(parse(result, 'yaml'), {message: 'new\ntext\n', keep: 'same', nested: [1, null], tail: true});
  assert.ok(result.includes("keep: 'same'\n"));
  assert.ok(result.endsWith('tail: true\n'));
});
test('YAML: blank null values can be edited without joining adjacent lines', () => {
  for (const source of ['a:\nb: 2\n', 'a: # comment\nb: 2\n', '-\n- 2\n']) {
    const edited = source.startsWith('-') ? [1, 2] : {a: 1, b: 2};
    assert.deepEqual(parse(patch(source, 'yaml', edited), 'yaml'), edited);
  }
});
test('YAML: anchors are retained on no-op and independent edits; alias mutation rejects', () => {
  const source = 'base: &x {a: 1}\nalias: *x\nother: 2\n';
  const before = parse(source, 'yaml');
  assert.equal(patchSource(source, 'yaml', before, before), source);
  assert.equal(patchSource(source, 'yaml', before, {...before, other: 3}), source.replace('other: 2', 'other: 3'));
  assert.throws(() => patchSource(source, 'yaml', before, {...before, base: {a: 2}}));
  assert.throws(() => patchSource(source, 'yaml', before, {...before, alias: {a: 2}}));
});
test('YAML: operations that would erase comments fail rather than normalize', () => {
  for (const source of ['a:\n  x: 1 # inner\nkeep: 2\n', 'a: | # header\n  text\nkeep: 2\n']) {
    const before = parse(source, 'yaml');
    assert.throws(() => patchSource(source, 'yaml', before, {a: null, keep: 2}));
    assert.equal(patchSource(source, 'yaml', before, before), source);
  }
});
test('YAML: duplicate/complex keys, custom tags, multi-doc and non-JSON data reject edits', () => {
  for (const source of ['a: 1\na: 2\n', '? [a, b]\n: value\n', 'a: !custom x\n', 'a: .nan\n', '---\na: 1\n---\na: 2\n']) {
    assert.throws(() => patchSource(source, 'yaml', {}, {a: 3}));
    assert.equal(patchSource(source, 'yaml', {}, {}), source);
  }
});

test('large arrays align only the edited middle and preserve untouched lexemes', () => {
  const before = Array.from({length: 1500}, (_, index) => index);
  const edited = [...before];
  edited.splice(750, 1, 'inserted', null);
  const source = ` [ ${before.join(', ')} ] \n`;
  for (const format of ['json', 'yaml']) {
    const result = patchSource(source, format, before, edited);
    assert.deepEqual(parse(result, format), edited);
    assert.ok(result.startsWith(' [ 0, 1, 2, 3'));
    assert.ok(result.endsWith('1497, 1498, 1499 ] \n'));
  }
});
test('YAML flow trailing separators survive scalar edits and structural edits remain valid', () => {
  for (const [source, edited] of [['{a: 1, b: 2,}\n', {a: 2, c: 3}], ['[1, 1, 2,] # end\n', [0, 1, 2]]]) {
    const result = patch(source, 'yaml', edited);
    assert.deepEqual(parse(result, 'yaml'), edited);
    if (source.includes('# end')) assert.ok(result.endsWith(' # end\n'));
  }
});
test('unsupported formats never cause implicit conversion', () => {
  assert.throws(() => patchSource('{}', 'jsonc', {}, {a: 1}));
  assert.throws(() => patchSource('a: 1\n', 'json', {a: 1}, {a: 2}));
});
test('YAML: BOM and CRLF survive insertion before the first block sequence item', () => {
  const source = '\uFEFF- 1 # first\r\n- 2 # last\r\n';
  const result = patch(source, 'yaml', [0, 1, 2]);
  assert.deepEqual(parse(result, 'yaml'), [0, 1, 2]);
  assert.equal(result, '\uFEFF- 0\r\n- 1 # first\r\n- 2 # last\r\n');
});
test('YAML: explicit document markers and comment-only raw documents are retained', () => {
  const source = '---\na: 1 # existing\n...\n';
  const result = patch(source, 'yaml', {a: 2, b: true});
  assert.ok(result.startsWith('---\n'));
  assert.ok(result.endsWith('...\n'));
  assert.deepEqual(parse(result, 'yaml'), {a: 2, b: true});
  assert.equal(patchSource('# raw comment\n', 'yaml', null, null), '# raw comment\n');
  assert.throws(() => patchSource('# raw comment\n', 'yaml', null, {created: true}));
});

test('JSON: key deletion removes all duplicates and leaves unrelated duplicate lexemes unchanged', () => {
  const source = '{ "x":1, "other":1e2, "x":2, "other":1e+2, "keep":"\\u65e5" }\n';
  const before = JSON.parse(source);
  const edited = {other: 100, keep: '日'};
  const result = patchSource(source, 'json', before, edited);
  assert.deepEqual(JSON.parse(result), edited);
  assert.ok(result.includes('"other":1e2'));
  assert.ok(result.includes('"other":1e+2'));
  assert.ok(result.includes('"keep":"\\u65e5"'));
  assert.equal(result.includes('"x"'), false);
});
test('JSON: nested duplicate winner edits retain hidden values and unrelated duplicate fields', () => {
  const source = '{"x":{"n":1},"x":{ "n":2, "unknown":true },"other":1,"other":2}';
  const before = JSON.parse(source);
  const after = {x: {n: 3, unknown: true}, other: 2};
  assert.equal(patchSource(source, 'json', before, after), source.replace('"n":2', '"n":3'));
  const added = patchSource(source, 'json', before, {...before, extra: null});
  assert.deepEqual(JSON.parse(added), {...before, extra: null});
  assert.ok(added.includes('"x":{"n":1},"x":{ "n":2, "unknown":true }'));
});
