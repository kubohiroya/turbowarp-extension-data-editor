import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  BlockEditorConflictError, BlockEditorStructureError, DESCENDANT_EDITING_CAPABILITY,
  DescendantNodeError, EditorRegistry
} from '../dist/index.js';

const reference = {targetId: 'sprite', blockId: 'root'};
const branch = (input, ...blockIds) => ({input, blockIds});
const node = (blockId, opcode = 'demo_leaf', branches = []) => ({
  block: {targetId: 'sprite', blockId, opcode, revision: '1', arguments: {
    VALUE: {kind: 'literal', value: blockId}, NAME: {kind: 'literal', value: 'original'},
    REPORTER: {kind: 'reporter'}
  }}, branches
});

function definition(overrides = {}) {
  return {
    apiVersion: 1, extensionId: 'demo', editorId: 'values', opcodes: ['demo_parent', 'demo_leaf'],
    editableArguments: ['VALUE', 'NAME'],
    read: block => ({value: block.arguments.VALUE.value, name: block.arguments.NAME.value}),
    validate: draft => draft.value === 'invalid' ? [{message: 'Enter a valid value.', path: 'value'}] : [],
    createPatch: draft => [
      {argument: 'VALUE', value: draft.value}, {argument: 'NAME', value: draft.name}
    ],
    mount: (_container, context) => { context.subscribe(() => {}); return () => {}; },
    ...overrides
  };
}

function scope() {
  return {...reference, generation: 'project-1/session-1', nodes: [
    node('root', 'demo_parent', [branch('LEFT', 'a', 'middle', 'b'), branch('RIGHT', 'c')]),
    node('a'), node('middle', 'control_repeat', [branch('SUBSTACK', 'grand')]),
    node('grand'), node('b'), node('c')
  ]};
}

const normalized = snapshot => JSON.stringify({...snapshot,
  nodes: [...snapshot.nodes].sort((a, b) => a.block.blockId.localeCompare(b.block.blockId))});

/** An in-memory atomic host; real Blockly/VM integration remains the GUI's responsibility. */
function fixture(overrides = {}, initial = scope()) {
  const registry = new EditorRegistry();
  const remove = registry.register(definition(overrides));
  let live = structuredClone(initial);
  let dirty = 0;
  let failureAt = -1;
  let beforeWrite = () => {};
  let barrier;
  const requests = [];
  const undo = [];
  const redo = [];
  const invalidations = new Set();
  const pending = [];
  const write = request => {
    request.signal.throwIfAborted();
    beforeWrite();
    if (!live || normalized(live) !== normalized(request.expected)) throw new BlockEditorConflictError();
    const before = structuredClone(live);
    try {
      let index = 0;
      for (const change of request.changes) {
        const block = live.nodes.find(n => n.block.blockId === change.blockId)?.block;
        const descriptor = block && registry.resolve(block.opcode);
        assert.ok(descriptor?.editableArguments.includes(change.argument));
        assert.equal(block.arguments[change.argument].kind, 'literal');
        block.arguments[change.argument].value = change.value;
        block.revision = String(Number(block.revision) + 1);
        if (++index === failureAt) throw new Error('Injected write failure');
      }
      undo.push({before, after: structuredClone(live)});
      redo.length = 0;
      dirty++;
    } catch (error) {
      live = before;
      throw error;
    }
  };
  const port = {
    capability: DESCENDANT_EDITING_CAPABILITY,
    readSubtree: ref => ref.targetId === reference.targetId && ref.blockId === reference.blockId ? live : null,
    commitSubtree: request => {
      requests.push(request);
      if (!barrier) return write(request);
      const task = barrier.then(() => write(request));
      pending.push(task);
      return task;
    },
    subscribeInvalidation: (_ref, listener) => {
      invalidations.add(listener);
      return () => { invalidations.delete(listener); };
    }
  };
  let singleCalls = 0;
  const host = {descendants: port,
    readBlock: ref => live?.nodes.find(n => n.block.blockId === ref.blockId)?.block ?? null,
    commit: () => { singleCalls++; }};
  return {
    registry, host, port, remove, requests, undo, redo, pending,
    open: limits => registry.openDescendants(reference, host, limits),
    live: () => live, setLive: value => { live = value; }, dirty: () => dirty,
    singleCalls: () => singleCalls,
    invalidations: () => invalidations.size,
    invalidate: reason => { for (const listener of [...invalidations]) listener(reason); },
    failAt: value => { failureAt = value; }, beforeWrite: callback => { beforeWrite = callback; },
    deferCommit: promise => { barrier = promise; },
    undoOnce: () => { const item = undo.pop(); live = structuredClone(item.before); redo.push(item); },
    redoOnce: () => { const item = redo.pop(); live = structuredClone(item.after); undo.push(item); }
  };
}

const edit = (s, id, value) => {
  const editor = s.getEditor(id);
  editor.setDraft({...editor.getDraft(), value});
};

test('capability negotiation keeps the single-block API and never emulates aggregate commits', async () => {
  for (const descendants of [undefined, {}, {capability: 'future'},
    {capability: DESCENDANT_EDITING_CAPABILITY, readSubtree: () => scope()}]) {
    const f = fixture();
    f.host.descendants = descendants;
    assert.equal(f.open(), undefined);
    assert.ok(f.registry.open(reference, f.host));
    assert.equal(f.singleCalls(), 0);
  }
  const f = fixture();
  const s = f.open();
  assert.ok(s);
  assert.deepEqual(await s.save(), {status: 'saved', changed: false});
  assert.equal(f.singleCalls(), 0);
  assert.equal(f.requests.length, 0);
});

test('captures branches, internal next order, unregistered intermediates and distinct sibling instances', () => {
  const f = fixture();
  const s = f.open();
  assert.deepEqual(s.getNodes().map(n => n.reference.blockId), ['root', 'a', 'middle', 'grand', 'b', 'c']);
  const grand = s.getNodes().find(n => n.reference.blockId === 'grand');
  assert.deepEqual(grand.inputPath, [
    {blockId: 'root', input: 'LEFT', index: 1}, {blockId: 'middle', input: 'SUBSTACK', index: 0}
  ]);
  assert.equal(s.getEditor('middle'), undefined);
  assert.equal(s.getEditor('outside-next'), undefined);
  assert.equal(s.getEditor('connected-reporter'), undefined);
  assert.equal(s.getNodes().find(n => n.reference.blockId === 'middle').editor, undefined);
  assert.equal(s.generation, 'project-1/session-1');
  edit(s, 'a', 'first');
  edit(s, 'b', 'second');
  assert.equal(s.getEditor('a').getDraft().value, 'first');
  assert.equal(s.getEditor('b').getDraft().value, 'second');
  for (const editor of [s.getEditor('a'), s.getEditor('root')]) {
    for (const key of ['save', 'cancel', 'dispose', 'host']) assert.equal(editor[key], undefined);
  }
  assert.throws(() => { grand.inputPath[0].input = 'OTHER'; }, TypeError);
  assert.throws(() => { s.reference.blockId = 'a'; }, TypeError);
  s.cancel();
  assert.equal(f.dirty(), 0);
  assert.equal(f.undo.length, 0);
});

test('snapshots and all node drafts are detached from live data, UI and callbacks', async () => {
  const seen = [];
  const f = fixture({read: block => {
    seen.push(block);
    return {value: block.arguments.VALUE.value, name: 'original', nested: {values: []}};
  }});
  const s = f.open();
  assert.throws(() => { seen[0].arguments.VALUE.value = 'mutated'; }, TypeError);
  const editor = s.getEditor('a');
  const draft = editor.getDraft();
  draft.nested.values.push('copy');
  assert.deepEqual(editor.getDraft().nested.values, []);
  editor.setDraft(draft);
  draft.nested.values.push('external');
  assert.deepEqual(editor.getDraft().nested.values, ['copy']);
  f.live().nodes[1].block.arguments.VALUE.value = 'external change';
  assert.equal(editor.getDraft().value, 'a');
  assert.equal((await s.save()).status, 'conflict');
  assert.equal(f.requests.length, 0);
  s.dispose();
});

test('one atomic commit includes all changed nodes and supports one-step memory-host Undo/Redo', async () => {
  const f = fixture();
  const original = structuredClone(f.live());
  const s = f.open();
  edit(s, 'root', 'parent edited');
  edit(s, 'grand', 'grandchild edited');
  edit(s, 'b', 'sibling edited');
  assert.deepEqual(await s.save(), {status: 'saved', changed: true});
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.requests[0].changes.map(c => c.blockId), ['root', 'grand', 'b']);
  assert.ok(Object.isFrozen(f.requests[0]));
  assert.ok(Object.isFrozen(f.requests[0].expected.nodes[0].branches[0].blockIds));
  assert.ok(Object.isFrozen(f.requests[0].changes[0]));
  assert.equal(f.singleCalls(), 0);
  assert.equal(f.undo.length, 1);
  assert.equal(f.dirty(), 1);
  const saved = structuredClone(f.live());
  assert.deepEqual(saved.nodes[2], original.nodes[2]);
  assert.deepEqual(saved.nodes[0].block.arguments.REPORTER, {kind: 'reporter'});
  f.undoOnce();
  assert.deepEqual(f.live(), original);
  f.redoOnce();
  assert.deepEqual(f.live(), saved);
  assert.equal(f.invalidations(), 0);
  assert.throws(() => s.getEditor('grand').getDraft(), /closed/);
});

test('all nodes validate even when hidden, and errors carry node, ancestors and field identity', async () => {
  const validated = [];
  const f = fixture({validate: (draft, block) => {
    validated.push(block.blockId);
    return draft.value === 'invalid' ? [{message: 'Invalid field', path: 'value'}, {message: 'Whole form'}] : [];
  }});
  const s = f.open();
  const grand = s.getEditor('grand');
  const unmount = grand.mount({});
  edit(s, 'grand', 'invalid');
  unmount();
  edit(s, 'b', 'invalid');
  const result = await s.save();
  assert.equal(result.status, 'invalid');
  assert.deepEqual(validated, ['root', 'a', 'grand', 'b', 'c']);
  assert.equal(result.issues.length, 4);
  assert.deepEqual(result.issues.map(i => i.reference.blockId), ['grand', 'grand', 'b', 'b']);
  assert.equal(result.issues[0].path, 'value');
  assert.equal(result.issues[1].path, undefined);
  assert.deepEqual(result.issues[0].inputPath.map(p => p.blockId), ['root', 'middle']);
  assert.equal(f.requests.length, 0);
  assert.equal(s.getState().canSave, false);
  const remount = grand.mount({});
  assert.equal(grand.getDraft().value, 'invalid');
  assert.equal(grand.getState().issues.length, 2);
  edit(s, 'grand', 'valid');
  assert.equal(s.getEditor('b').getState().issues.length, 2);
  edit(s, 'b', 'valid');
  remount();
  assert.equal((await s.save()).status, 'saved');
});

test('duplicate, disallowed, missing, reporter and invalid writes never reach the host', async () => {
  const patches = [
    [{argument: 'VALUE', value: 'one'}, {argument: 'VALUE', value: 'two'}],
    [{argument: 'REPORTER', value: 'cut connection'}],
    [{argument: 'UNKNOWN', value: 'new'}], [{argument: 'VALUE', value: Infinity}], undefined
  ];
  for (const patch of patches) {
    const f = fixture({editableArguments: ['VALUE', 'NAME', 'REPORTER', 'UNKNOWN'],
      createPatch: (_draft, block) => block.blockId === 'grand' ? patch : []});
    const s = f.open();
    const result = await s.save();
    assert.equal(result.status, 'failed');
    assert.ok(result.error instanceof DescendantNodeError);
    assert.equal(result.error.reference.blockId, 'grand');
    assert.equal(result.error.inputPath.length, 2);
    assert.equal(f.requests.length, 0);
    assert.equal(s.getState().status, 'editing');
    s.dispose();
  }
});

test('additions, deletions, movement, connections, values and generations conflict before commit', async () => {
  const changes = [
    live => { live.nodes[0].branches[0].blockIds.reverse(); },
    live => { live.nodes[2].branches[0].input = 'DIFFERENT'; },
    live => { live.nodes[2].block.revision = 'replaced intermediary'; },
    live => { live.nodes[3].block.arguments.NAME.value = 'unmentioned change'; },
    live => { live.nodes[0].block.arguments.REPORTER = {kind: 'literal', value: 'disconnect'}; },
    live => { live.generation = 'project-2/session-1'; },
    live => { live.nodes.pop(); },
    live => { live.nodes.push(node('new')); live.nodes[0].branches[1].blockIds.push('new'); },
    live => { live.nodes[0].block.opcode = 'demo_leaf'; },
    live => { live.targetId = 'other'; },
    live => { live.nodes[4].branches.push(branch('NEW', 'root')); }
  ];
  for (const change of changes) {
    const f = fixture();
    const s = f.open();
    edit(s, 'a', 'edited');
    change(f.live());
    const result = await s.save();
    assert.equal(result.status, 'conflict');
    assert.equal(f.requests.length, 0);
    assert.equal(s.getEditor('a').getDraft().value, 'edited');
    s.dispose();
  }
  const f = fixture();
  const s = f.open();
  f.setLive(null);
  assert.equal((await s.save()).status, 'conflict');
  s.dispose();
});

test('the host rechecks the entire scope at the actual write boundary', async () => {
  const f = fixture();
  const s = f.open();
  edit(s, 'a', 'edited');
  f.beforeWrite(() => { f.live().nodes[2].block.revision = 'changed during commit'; });
  assert.equal((await s.save()).status, 'conflict');
  assert.equal(f.requests.length, 1);
  assert.equal(f.live().nodes[1].block.arguments.VALUE.value, 'a');
  assert.equal(f.dirty(), 0);
  assert.equal(f.undo.length, 0);
  s.dispose();
});

test('partial host failure restores all values/history and retains every draft for retry', async () => {
  const f = fixture();
  const s = f.open();
  const before = structuredClone(f.live());
  edit(s, 'a', 'one');
  edit(s, 'grand', 'two');
  edit(s, 'b', 'three');
  f.failAt(2);
  assert.equal((await s.save()).status, 'failed');
  assert.deepEqual(f.live(), before);
  assert.equal(f.undo.length, 0);
  assert.equal(f.dirty(), 0);
  assert.equal(s.getEditor('a').getDraft().value, 'one');
  assert.equal(s.getEditor('grand').getDraft().value, 'two');
  assert.equal(s.getEditor('b').getDraft().value, 'three');
  f.failAt(-1);
  assert.equal((await s.save()).status, 'saved');
  assert.equal(f.undo.length, 1);
});

test('unregister/re-register invalidates aggregate sessions without breaking existing single sessions', async () => {
  let finish;
  const f = fixture({validate: () => new Promise(resolve => { finish = resolve; })});
  const single = f.registry.open(reference, f.host);
  const s = f.open();
  const saving = s.save();
  f.remove();
  f.registry.register(definition());
  assert.deepEqual(await saving, {status: 'invalidated'});
  assert.equal(s.getState().status, 'invalidated');
  assert.equal(single.getState().status, 'editing');
  finish([]);
  await Promise.resolve();
  assert.equal(f.requests.length, 0);
  assert.equal(f.invalidations(), 0);
  single.dispose();
});

test('unrelated registration is harmless; making an intermediate editable invalidates the scope', () => {
  const f = fixture();
  const s = f.open();
  f.registry.register(definition({editorId: 'other', opcodes: ['demo_unrelated']}));
  assert.equal(s.getState().status, 'editing');
  f.registry.register(definition({extensionId: 'control', opcodes: ['control_repeat']}));
  assert.equal(s.getState().status, 'invalidated');
  assert.equal(f.invalidations(), 0);
});

test('cancel/dispose/invalidation discard pending validation and ignore late failures', async () => {
  for (const action of ['cancel', 'dispose', 'invalidate']) {
    let reject;
    let cleanups = 0;
    const f = fixture({validate: () => new Promise((_resolve, fail) => { reject = fail; }),
      mount: () => () => { cleanups++; }});
    const s = f.open();
    s.getEditor('root').mount({});
    s.getEditor('grand').mount({});
    const saving = s.save();
    assert.equal((await s.save()).status, 'busy');
    assert.throws(() => edit(s, 'a', 'too late'), /not editable/);
    assert.equal(s[action](), true);
    assert.equal((await saving).status, action === 'invalidate' ? 'invalidated' : 'closed');
    reject(new Error('Late validation failure'));
    await Promise.resolve();
    assert.equal(f.requests.length, 0);
    assert.equal(cleanups, 2);
    assert.equal(f.invalidations(), 0);
    assert.throws(() => s.getEditor('root').getDraft(), /closed/);
  }
});

test('invalidation aborts a deferred write; normal close cannot interrupt an active transaction', async () => {
  let release;
  const f = fixture();
  f.deferCommit(new Promise(resolve => { release = resolve; }));
  const s = f.open();
  edit(s, 'a', 'edited');
  const saving = s.save();
  while (f.requests.length === 0) await Promise.resolve();
  assert.equal(s.cancel(), false);
  assert.equal(s.dispose(), false);
  const signal = f.requests[0].signal;
  f.invalidate(new BlockEditorConflictError('Project changed'));
  assert.equal(signal.aborted, true);
  assert.deepEqual(await saving, {status: 'invalidated'});
  release();
  await Promise.allSettled(f.pending);
  assert.equal(f.live().nodes[1].block.arguments.VALUE.value, 'a');
  assert.equal(f.dirty(), 0);
  assert.equal(f.undo.length, 0);
});

test('invalid graph shapes fail safely before reading drafts; limits never truncate a scope', () => {
  const invalid = [
    s => { s.nodes[0].branches[0].blockIds.push('root'); },
    s => { s.nodes[0].branches[1].blockIds.push('a'); },
    s => { s.nodes.push(structuredClone(s.nodes[1])); },
    s => { s.nodes.push(node('disconnected')); },
    s => { s.nodes[0].branches[0].blockIds[0] = 'missing'; },
    s => { s.nodes[1].block.targetId = 'other'; },
    s => { s.nodes[0].branches.push(branch('LEFT')); },
    s => { s.generation = ''; }
  ];
  for (const mutate of invalid) {
    const initial = scope();
    mutate(initial);
    let reads = 0;
    const f = fixture({read: () => { reads++; return {}; }}, initial);
    assert.throws(() => f.open());
    assert.equal(reads, 0);
    assert.equal(f.invalidations(), 0);
  }
  const f = fixture();
  for (const limits of [{maxNodes: 5}, {maxDepth: 1}, {maxDepth: 33}, {maxNodes: 501},
    {maxDepth: -1}, {maxNodes: 0}, {maxNodes: NaN}]) {
    assert.throws(() => f.open(limits), BlockEditorStructureError);
  }
  assert.ok(f.open({maxNodes: 6, maxDepth: 2}).dispose());
});

test('the default depth/count limits accept the boundary and reject the next node', () => {
  const initial = scope();
  initial.nodes = [node('root', 'demo_parent', [branch('BODY', ...Array.from({length: 499}, (_, i) => `n${i}`))]),
    ...Array.from({length: 499}, (_, i) => node(`n${i}`))];
  const f = fixture({}, initial);
  const boundary = f.open();
  assert.equal(boundary.getNodes().length, 500);
  boundary.dispose();
  f.live().nodes.push(node('overflow'));
  f.live().nodes[0].branches[0].blockIds.push('overflow');
  assert.throws(() => f.open(), error => error.code === 'limit');
  const deep = {...reference, generation: '1', nodes: Array.from({length: 33}, (_, i) =>
    node(i === 0 ? 'root' : `d${i}`, i === 0 ? 'demo_parent' : 'demo_leaf',
      i === 32 ? [] : [branch('BODY', `d${i + 1}`)]))};
  const d = fixture({}, deep);
  d.open().dispose();
  d.live().nodes[32].branches.push(branch('BODY', 'too-deep'));
  d.live().nodes.push(node('too-deep'));
  assert.throws(() => d.open(), error => error.code === 'limit');
});

test('no-op save preserves existing redo and validates conflicts even without changed arguments', async () => {
  const f = fixture();
  f.redo.push('existing redo');
  assert.deepEqual(await f.open().save(), {status: 'saved', changed: false});
  assert.deepEqual(f.redo, ['existing redo']);
  assert.equal(f.dirty(), 0);
  const s = f.open();
  f.live().nodes[2].branches[0].input = 'MOVED';
  assert.equal((await s.save()).status, 'conflict');
  assert.equal(f.requests.length, 0);
  s.dispose();
});

test('node exceptions identify the callback owner, and view errors cannot turn a committed save into failure', async t => {
  for (const callback of ['read', 'validate', 'createPatch']) {
    const base = definition();
    const f = fixture({[callback]: (...args) => {
      const block = args.at(-1);
      if (block.blockId === 'grand') throw new Error('Callback failure');
      return base[callback](...args);
    }});
    if (callback === 'read') assert.throws(() => f.open(), error => error.reference.blockId === 'grand');
    else {
      const s = f.open();
      const result = await s.save();
      assert.equal(result.status, 'failed');
      assert.equal(result.error.reference.blockId, 'grand');
      assert.equal(result.error.cause.message, 'Callback failure');
      assert.equal(f.requests.length, 0);
      s.dispose();
    }
  }
  const errors = t.mock.method(console, 'error', () => {});
  const f = fixture({mount: () => () => { throw new Error('Cleanup'); }});
  const s = f.open();
  s.getEditor('a').mount({});
  s.subscribe(() => { throw new Error('Observer'); });
  edit(s, 'a', 'edited');
  assert.equal((await s.save()).status, 'saved');
  assert.equal(f.requests.length, 1);
  assert.ok(errors.mock.callCount() > 0);
});

test('unmount invalidates only that node view, preserves the draft and releases scoped subscriptions', () => {
  const contexts = new Map();
  const notifications = new Map();
  const f = fixture({mount: (container, context) => {
    contexts.set(container.id, context);
    context.subscribe(() => notifications.set(container.id, (notifications.get(container.id) ?? 0) + 1));
    return () => {};
  }});
  const s = f.open();
  const unmount = s.getEditor('a').mount({id: 'old'});
  s.getEditor('b').mount({id: 'sibling'});
  edit(s, 'a', 'first');
  unmount();
  const count = notifications.get('old');
  s.getEditor('a').mount({id: 'new'});
  assert.throws(() => contexts.get('old').setDraft({value: 'late'}), /unmounted/);
  edit(s, 'a', 'second');
  assert.equal(notifications.get('old'), count);
  assert.equal(s.getEditor('b').getDraft().value, 'b');
  assert.equal(s.getEditor('a').getDraft().value, 'second');
  s.cancel();
  assert.equal(f.requests.length, 0);
});

test('an invalidated validator cannot change a new generation with reused block IDs', async () => {
  let resolveOld;
  let defer = true;
  const f = fixture({validate: () => {
    if (!defer) return [];
    defer = false;
    return new Promise(resolve => { resolveOld = resolve; });
  }});
  const old = f.open();
  edit(old, 'a', 'old draft');
  const pending = old.save();
  f.invalidate();
  assert.equal((await pending).status, 'invalidated');
  f.live().generation = 'project-2/session-2';
  const current = f.open();
  edit(current, 'a', 'new draft');
  resolveOld([{message: 'Late issue from the old project'}]);
  await Promise.resolve();
  assert.equal(current.getState().issues.length, 0);
  assert.equal(current.getEditor('a').getDraft().value, 'new draft');
  assert.equal((await current.save()).status, 'saved');
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].expected.generation, 'project-2/session-2');
});

test('concurrent sessions have independent drafts and the second save detects the first commit', async () => {
  const f = fixture();
  const first = f.open();
  const second = f.open();
  edit(first, 'a', 'first session');
  edit(second, 'a', 'second session');
  assert.equal((await first.save()).status, 'saved');
  assert.equal(second.getEditor('a').getDraft().value, 'second session');
  assert.equal((await second.save()).status, 'conflict');
  assert.equal(f.requests.length, 1);
  second.dispose();
  assert.equal(f.invalidations(), 0);
});
