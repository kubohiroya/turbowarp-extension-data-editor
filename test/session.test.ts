import assert from 'node:assert/strict';
import {test} from 'node:test';
import {BlockEditorConflictError, EDITOR_API_VERSION, EditorRegistry} from '../dist/index.js';

const reference = {targetId: 'sprite-1', blockId: 'block-1'};

function definition(overrides = {}) {
  return {
    apiVersion: EDITOR_API_VERSION,
    extensionId: 'story', editorId: 'scene-properties', opcodes: ['story_scene'],
    editableArguments: ['PROPERTIES', 'NAME'],
    read: snapshot => ({
      properties: snapshot.arguments.PROPERTIES.value,
      nested: {names: ['opening']}
    }),
    validate: () => [],
    createPatch: draft => [{argument: 'PROPERTIES', value: draft.properties}],
    ...overrides
  };
}

/** A test host that commits by swapping a prepared snapshot, never by partial writes. */
function fixture(overrides = {}) {
  const registry = new EditorRegistry();
  const unregister = registry.register(definition(overrides));
  let snapshot = {
    ...reference, opcode: 'story_scene', revision: '1',
    arguments: {
      PROPERTIES: {kind: 'literal', value: '{}'}, NAME: {kind: 'literal', value: 'opening'},
      DYNAMIC: {kind: 'reporter'}
    }
  };
  const history = [];
  let calls = 0;
  let failCommit = false;
  let beforeCommit = () => {};
  const host = {
    readBlock: ref => snapshot && ref.targetId === snapshot.targetId && ref.blockId === snapshot.blockId
      ? snapshot : null,
    commit: request => {
      calls += 1;
      beforeCommit();
      if (!snapshot || JSON.stringify(snapshot) !== JSON.stringify(request.expected)) {
        throw new BlockEditorConflictError();
      }
      const next = structuredClone(snapshot);
      for (const change of request.changes) next.arguments[change.argument].value = change.value;
      if (failCommit) throw new Error('Simulated host rejection before atomic swap');
      next.revision = String(Number(next.revision) + 1);
      history.push({before: structuredClone(snapshot), after: structuredClone(next)});
      snapshot = next;
    }
  };
  return {
    registry, unregister, host, history,
    open: () => registry.open(reference, host),
    snapshot: () => snapshot,
    setSnapshot: next => { snapshot = next; },
    calls: () => calls,
    rejectCommit: () => { failCommit = true; },
    beforeCommit: callback => { beforeCommit = callback; }
  };
}

test('registration is namespaced, rejects duplicates atomically, and unregisters idempotently', () => {
  const registry = new EditorRegistry();
  const entry = definition();
  const remove = registry.register(entry);
  entry.opcodes.push('story_unregistered');
  entry.editableArguments.push('DYNAMIC');
  assert.equal(registry.resolve('story_unregistered'), undefined);
  assert.deepEqual(registry.resolve('story_scene').editableArguments, ['PROPERTIES', 'NAME']);
  assert.throws(() => registry.register(definition()), /already registered/);
  assert.throws(() => registry.register(definition({
    editorId: 'other', opcodes: ['story_other', 'story_scene']
  })), /already registered/);
  assert.equal(registry.resolve('story_other'), undefined);
  registry.register(definition({extensionId: 'other', opcodes: ['other_scene']}));
  remove();
  registry.register(definition());
  remove();
  assert.ok(registry.resolve('story_scene'));
  assert.ok(registry.resolve('other_scene'));
});

test('unsupported versions and foreign or duplicate opcodes are rejected', () => {
  for (const override of [
    {apiVersion: 2}, {opcodes: ['foreign_scene']}, {opcodes: ['story_scene', 'story_scene']},
    {extensionId: 'bad_id'}, {editableArguments: ['NAME', 'NAME']}
  ]) assert.throws(() => new EditorRegistry().register(definition(override)), TypeError);
});

test('missing, unregistered and mismatched blocks do not create an editing session', () => {
  const f = fixture();
  assert.equal(f.registry.open({...reference, blockId: 'missing'}, f.host), undefined);
  f.unregister();
  assert.equal(f.open(), undefined);
  assert.throws(() => f.registry.open(reference, {
    ...f.host, readBlock: () => ({...f.snapshot(), targetId: 'wrong'})
  }), /invalid block snapshot/);
});

test('unregistered opcodes still validate the complete legacy snapshot', () => {
  const f = fixture();f.unregister();
  for (const mutate of [
    snapshot => ({...snapshot, revision: ''}),
    snapshot => ({...snapshot, arguments: {...snapshot.arguments, NAME: {kind: 'literal', value: Infinity}}}),
    snapshot => ({...snapshot, arguments: {...snapshot.arguments, NAME: {kind: 'unsupported'}}})
  ]) {
    assert.throws(() => f.registry.open(reference, {...f.host, readBlock: () => mutate(f.snapshot())}), TypeError);
  }
  assert.equal(f.open(), undefined);
});

test('read, getDraft and setDraft never share draft references', () => {
  const external = {properties: '{}', nested: {names: ['opening']}};
  const f = fixture({read: () => external});
  const s = f.open();
  external.nested.names.push('external');
  const draft = s.getDraft();
  draft.nested.names.push('read-copy');
  assert.deepEqual(s.getDraft().nested.names, ['opening']);
  s.setDraft(draft);
  draft.nested.names.push('write-copy');
  assert.deepEqual(s.getDraft().nested.names, ['opening', 'read-copy']);
  assert.equal(f.snapshot().arguments.PROPERTIES.value, '{}');
  assert.equal(f.history.length, 0);
  assert.equal(f.calls(), 0);
});

test('the opening snapshot is detached and immutable', async () => {
  let captured;
  const f = fixture({read: snapshot => {
    captured = snapshot;
    return {properties: '{}'};
  }});
  const s = f.open();
  assert.throws(() => { captured.arguments.PROPERTIES.value = 'bad'; }, TypeError);
  f.snapshot().arguments.PROPERTIES.value = 'external';
  assert.equal(captured.arguments.PROPERTIES.value, '{}');
  assert.equal((await s.save()).status, 'conflict');
  assert.equal(f.calls(), 0);
});

test('cancel discards the draft without commit or history changes', async () => {
  const f = fixture();
  const s = f.open();
  s.setDraft({properties: '{"changed":true}'});
  assert.equal(s.cancel(), true);
  assert.equal(s.cancel(), false);
  assert.equal(s.getState().status, 'cancelled');
  assert.throws(() => s.getDraft(), /closed/);
  assert.equal((await s.save()).status, 'closed');
  assert.equal(f.calls(), 0);
  assert.equal(f.history.length, 0);
});

test('validation failure retains the draft and permits correcting and saving it', async () => {
  const f = fixture({validate: draft => draft.properties === 'bad'
    ? [{path: 'properties', message: 'Invalid JSON'}] : []});
  const s = f.open();
  s.setDraft({properties: 'bad'});
  assert.equal((await s.save()).status, 'invalid');
  assert.equal(s.getState().status, 'editing');
  assert.equal(s.getDraft().properties, 'bad');
  assert.equal(f.calls(), 0);
  s.setDraft({properties: '{"valid":true}'});
  assert.deepEqual(s.getState().issues, []);
  assert.deepEqual(await s.save(), {status: 'saved', changed: true});
});

test('all argument changes are submitted in one frozen commit request', async () => {
  const f = fixture({createPatch: draft => [
    {argument: 'PROPERTIES', value: draft.properties}, {argument: 'NAME', value: 'closing'}
  ]});
  const s = f.open();
  s.setDraft({properties: '{"duration":2}'});
  const original = structuredClone(f.snapshot());
  const commit = f.host.commit;
  f.host.commit = request => {
    assert.ok(Object.isFrozen(request));
    assert.ok(Object.isFrozen(request.expected.arguments));
    assert.ok(Object.isFrozen(request.changes));
    assert.ok(Object.isFrozen(request.changes[0]));
    commit(request);
  };
  assert.deepEqual(await s.save(), {status: 'saved', changed: true});
  assert.equal(f.calls(), 1);
  assert.equal(f.history.length, 1);
  assert.deepEqual(f.history[0].before, original);
  assert.equal(f.history[0].after.arguments.NAME.value, 'closing');
  assert.equal(f.history[0].after.arguments.PROPERTIES.value, '{"duration":2}');
  assert.equal((await s.save()).status, 'closed');
});

test('unchanged values close successfully without commit or undo entries', async () => {
  const f = fixture();
  assert.deepEqual(await f.open().save(), {status: 'saved', changed: false});
  assert.equal(f.calls(), 0);
  assert.deepEqual(f.history, []);
});

test('reporters, unknown arguments, duplicates and non-finite values never reach the host', async () => {
  const cases = [
    [{argument: 'DYNAMIC', value: 'replacement'}],
    [{argument: 'MISSING', value: 'x'}],
    [{argument: 'NAME', value: 'one'}, {argument: 'NAME', value: 'two'}],
    [{argument: 'NAME', value: Infinity}],
    [{argument: 'NAME', value: null}]
  ];
  for (const changes of cases) {
    const f = fixture({editableArguments: ['DYNAMIC', 'MISSING', 'NAME'], createPatch: () => changes});
    assert.equal((await f.open().save()).status, 'failed');
    assert.equal(f.calls(), 0);
    assert.deepEqual(f.history, []);
  }
  const f = fixture({createPatch: () => [{argument: 'DYNAMIC', value: 'bad'}]});
  assert.equal((await f.open().save()).status, 'failed');
});

test('deletion, target switch, opcode replacement and revision changes prevent commit', async () => {
  for (const mutate of [
    () => null,
    snapshot => ({...snapshot, targetId: 'sprite-2'}),
    snapshot => ({...snapshot, opcode: 'story_other'}),
    snapshot => ({...snapshot, revision: '2'})
  ]) {
    const f = fixture();
    const s = f.open();
    s.setDraft({properties: '{"changed":true}'});
    const changed = mutate(f.snapshot());
    if (changed?.targetId === 'sprite-2') {
      // A well-behaved host reports that the original target is no longer editable.
      f.setSnapshot(null);
    } else f.setSnapshot(changed);
    assert.equal((await s.save()).status, 'conflict');
    assert.equal(f.calls(), 0);
    assert.equal(s.getState().status, 'editing');
  }
});

test('asynchronous validation blocks double save, draft edits and closing', async () => {
  let release;
  const f = fixture({validate: () => new Promise(resolve => { release = resolve; })});
  const s = f.open();
  s.setDraft({properties: '{"changed":true}'});
  const saving = s.save();
  assert.equal(s.getState().status, 'saving');
  assert.deepEqual(await s.save(), {status: 'busy'});
  assert.throws(() => s.setDraft({}), /not editable/);
  assert.equal(s.cancel(), false);
  assert.equal(s.dispose(), false);
  f.setSnapshot({...f.snapshot(), revision: '2'});
  release([]);
  assert.equal((await saving).status, 'conflict');
  assert.equal(f.calls(), 0);
  assert.equal(s.getDraft().properties, '{"changed":true}');
});

test('the host checks conflicts again at the actual write boundary', async () => {
  const f = fixture();
  const s = f.open();
  s.setDraft({properties: '{"changed":true}'});
  f.beforeCommit(() => f.setSnapshot({...f.snapshot(), revision: '2'}));
  assert.equal((await s.save()).status, 'conflict');
  assert.equal(f.snapshot().arguments.PROPERTIES.value, '{}');
  assert.equal(f.history.length, 0);
});

test('host rejection retains draft, data and history; rollback is a host contract', async () => {
  const f = fixture();
  const s = f.open();
  s.setDraft({properties: '{"changed":true}'});
  f.rejectCommit();
  assert.equal((await s.save()).status, 'failed');
  assert.equal(s.getState().status, 'editing');
  assert.equal(s.getDraft().properties, '{"changed":true}');
  assert.equal(f.snapshot().arguments.PROPERTIES.value, '{}');
  assert.equal(f.history.length, 0);
});

test('asynchronous commit keeps the session busy until the host succeeds', async () => {
  const f = fixture();
  const s = f.open();
  s.setDraft({properties: '{"changed":true}'});
  let release;
  const commit = f.host.commit;
  f.host.commit = request => new Promise(resolve => {
    release = () => { commit(request); resolve(); };
  });
  const saving = s.save();
  await Promise.resolve();
  assert.equal(s.cancel(), false);
  assert.equal((await s.save()).status, 'busy');
  release();
  assert.equal((await saving).status, 'saved');
});

test('validation and patch exceptions retain an editable draft', async () => {
  for (const callbacks of [
    {validate: async () => { throw new Error('validation failed'); }},
    {createPatch: () => { throw new Error('patch failed'); }},
    {validate: () => undefined},
    {createPatch: () => undefined}
  ]) {
    const f = fixture(callbacks);
    const s = f.open();
    assert.equal((await s.save()).status, 'failed');
    assert.equal(s.getState().status, 'editing');
    assert.equal(s.getDraft().properties, '{}');
    assert.equal(f.calls(), 0);
  }
});

test('drafts reject lossy JSON values and retain own __proto__ data safely', () => {
  const f = fixture();
  const s = f.open();
  const cycle = {};
  cycle.self = cycle;
  for (const draft of [{bad: undefined}, {bad: NaN}, {bad: new Date()}, cycle, {bad: [,]}]) {
    assert.throws(() => s.setDraft(draft), TypeError);
  }
  s.setDraft(JSON.parse('{"__proto__":{"safe":true},"properties":"{}"}'));
  assert.ok(Object.hasOwn(s.getDraft(), '__proto__'));
  assert.equal({}.safe, undefined);
});

test('mounted bodies receive only the view context and clean up exactly once', async () => {
  for (const end of ['cancel', 'dispose', 'save', 'unmount']) {
    let cleanups = 0;
    let context;
    const f = fixture({mount: (_container, value) => {
      context = value;
      return () => { cleanups += 1; };
    }});
    const s = f.open();
    const unmount = s.mount({});
    assert.equal(context.save, undefined);
    assert.equal(context.host, undefined);
    assert.throws(() => s.mount({}), /another view/);
    if (end === 'unmount') unmount();
    else await s[end]();
    unmount();
    s.dispose();
    assert.equal(cleanups, 1);
  }
});

test('closing during mount immediately releases the returned view', () => {
  let s;
  let cleanups = 0;
  const f = fixture({mount: () => {
    s.cancel();
    return () => { cleanups += 1; };
  }});
  s = f.open();
  s.mount({})();
  assert.equal(cleanups, 1);
});

test('a save started during mount keeps the view until validation and commit finish', async () => {
  let s;
  let saving;
  let validate;
  let cleanups = 0;
  const f = fixture({
    validate: () => new Promise(resolve => { validate = resolve; }),
    mount: () => {
      saving = s.save();
      return () => { cleanups++; };
    }
  });
  s = f.open();
  s.setDraft({properties: 'changed'});
  const unmount = s.mount({});
  assert.equal(s.getState().status, 'saving');
  assert.equal(cleanups, 0);
  assert.equal(s.cancel(), false);
  validate([]);
  assert.equal((await saving).status, 'saved');
  assert.equal(f.calls(), 1);
  unmount();
  assert.equal(cleanups, 1);
});

test('unmount retains the draft and errors while invalidating only that view', async () => {
  const contexts = [];
  let viewNotifications = 0;
  let hostNotifications = 0;
  const f = fixture({mount: (_container, context) => {
    contexts.push(context);
    context.subscribe(() => { viewNotifications++; });
    return () => {};
  }});
  const s = f.open();
  s.subscribe(() => { hostNotifications++; });
  const unmount = s.mount({});
  contexts[0].setDraft({properties: 'unfinished'});
  contexts[0].setValidationIssues([{message: 'Fix the field.', path: 'properties'}]);
  const state = s.getState();
  const notifications = viewNotifications;
  unmount();
  assert.deepEqual(s.getDraft(), {properties: 'unfinished'});
  assert.deepEqual(s.getState(), state);
  assert.throws(() => contexts[0].setDraft({properties: 'late result'}), /unmounted/);
  assert.throws(() => contexts[0].setValidationIssues([]), /unmounted/);
  assert.throws(() => contexts[0].subscribe(() => {}), /unmounted/);
  const unmountAgain = s.mount({});
  contexts[1].setDraft({properties: 'corrected'});
  assert.equal(viewNotifications, notifications + 1);
  assert.equal(hostNotifications, 3);
  assert.equal(f.calls(), 0);
  unmountAgain();
  assert.equal((await s.save()).status, 'saved');
  assert.equal(viewNotifications, notifications + 1);
  assert.equal(f.snapshot().arguments.PROPERTIES.value, 'corrected');
});

test('mount failure releases view subscriptions and allows a fresh view', () => {
  let failedContext;
  let notifications = 0;
  let fail = true;
  const f = fixture({mount: (_container, context) => {
    if (!fail) return () => {};
    failedContext = context;
    context.subscribe(() => { notifications++; });
    throw new Error('Mount failed');
  }});
  const s = f.open();
  assert.throws(() => s.mount({}), /Mount failed/);
  s.setDraft({properties: 'retained'});
  assert.equal(notifications, 0);
  assert.throws(() => failedContext.setDraft({properties: 'stale'}), /unmounted/);
  fail = false;
  s.mount({});
  assert.deepEqual(s.getDraft(), {properties: 'retained'});
  s.dispose();
});

test('sessions expose immutable instance references and keep separate drafts', async () => {
  const f = fixture();
  const secondBlock = {...structuredClone(f.snapshot()), blockId: 'block-2'};
  const host = {...f.host, readBlock: ref => ref.blockId === secondBlock.blockId
    ? secondBlock : f.host.readBlock(ref)};
  const first = f.registry.open(reference, host);
  const second = f.registry.open(secondBlock, host);
  assert.deepEqual(first.reference, reference);
  assert.deepEqual(second.reference, {targetId: reference.targetId, blockId: 'block-2'});
  assert.throws(() => { first.reference.blockId = 'block-2'; }, TypeError);
  assert.throws(() => { first.reference = second.reference; }, TypeError);
  first.setDraft({properties: 'first'});
  second.setDraft({properties: 'second'});
  assert.equal(first.cancel(), true);
  assert.equal(second.getDraft().properties, 'second');
  assert.deepEqual(first.reference, reference);
  second.dispose();
  assert.equal(f.calls(), 0);
});

test('unregistered editors stop opening sessions while an existing session keeps its definition', () => {
  const f = fixture();
  const s = f.open();
  f.unregister();
  assert.equal(f.open(), undefined);
  assert.equal(s.getDraft().properties, '{}');
  s.dispose();
});

test('observer and cleanup failures cannot report a successful commit as failed', async t => {
  const log = t.mock.method(console, 'error', () => {});
  const f = fixture({mount: () => () => { throw new Error('cleanup'); }});
  const s = f.open();
  s.mount({});
  s.subscribe(() => { throw new Error('view'); });
  s.setDraft({properties: '{"changed":true}'});
  assert.equal((await s.save()).status, 'saved');
  assert.equal(f.calls(), 1);
  assert.ok(log.mock.callCount() >= 2);
});
