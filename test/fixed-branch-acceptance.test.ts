import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {act, domFixture} from './fixtures/fixed-form-dom.ts';
import {formFixture} from './fixtures/fixed-form-fixture.ts';
const specification = JSON.parse(readFileSync(new URL('./fixtures/fixed-branch-acceptance.json', import.meta.url), 'utf8'));
const copy = value => structuredClone(value);
const unchanged = (f, seed) => {
  assert.equal(f.requests.length, 0);
  for (const [name, item] of Object.entries(seed)) {
    if (item?.reporter) assert.deepEqual(f.live.arguments[name], {kind: 'reporter'});
    else if (item && Object.hasOwn(item, 'literal')) assert.ok(Object.is(f.live.arguments[name]?.value, item.literal), name);
  }
};

test('the frozen acceptance list expands all shared cases to both Asset labels without adding product owners', () => {
  const bindings = specification.fixtures;
  assert.equal(bindings.length, 23);assert.equal(new Set(bindings.map(item => item.id)).size, 23);
  assert.equal(new Set(bindings.map(item => item.templateId)).size, 16);
  for (const policy of ['CP-asset-cache', 'CP-asset-manager']) {
    assert.deepEqual(bindings.filter(item => item.policyId === policy).map(item => item.templateId).sort(), ['BC01', 'BC02', 'BC03', 'BC04', 'BC05', 'BC14']);
  }
  assert.equal(bindings.filter(item => item.policyId === 'CP-bubble-close').length, 10);
  assert.deepEqual(bindings.filter(item => item.policyId === null).map(item => item.id), ['BC11@common-only']);
});

for (const item of specification.fixtures) test(`${item.id}: common fixed form acceptance`, async t => {
  const policy = item.policyId ?? 'common-only';const seed = copy(item.seed);const id = item.templateId;
  if (id === 'BC14') {
    for (const source of ['unsupported', 'missing']) {
      const isBubble = policy === 'CP-bubble-close';const selector = isBubble ? 'TRIGGER' : 'PROPERTY';const dependent = isBubble ? 'TIMEOUT' : 'VALUE';
      const seeded = isBubble ? {TRIGGER: {literal: 'timeout'}, TIMEOUT: {literal: '10'}, CONDITION: {literal: 'ready'}}
        : {PROPERTY: {literal: 'font'}, VALUE: {literal: 'preserve-opening-raw'}};
      const f = formFixture(policy, seeded);f.session.dispose();
      const metadata = f.live.fixedContext.inputs[selector];metadata.source = source;metadata.reason = 'Unavailable common fixture selector.';delete metadata.field;
      if (source === 'missing') delete f.live.arguments[selector];
      const opened = f.service.registry.open(f.live, f.host);assert.ok(opened);
      t.after(() => {opened.dispose();f.remove();});
      const view = opened.getFixedInputView();assert.equal(view.inputs[dependent].state, 'readonly');
      assert.equal((await opened.save()).status, 'saved');assert.equal(f.requests.length, 0);
      assert.equal(f.live.arguments[dependent].value, seeded[dependent].literal);
    }
    return;
  }
  if (id === 'BC12') {
    const changes = [{argument: 'CONDITION', value: 'forged'}, {argument: 'TIMEOUT', value: '20'}];
    const f = formFixture(policy, seed, {definition: definition => ({...definition,
      prepareFixedSave: () => ({kind: 'ready', changes, context: {consumerId: 'common-fixture', nowMs: 0, settings: null}})})});
    t.after(f.close);assert.equal((await f.session.save()).status, 'failed');unchanged(f, seed);
    const expected = copy(f.live);assert.throws(() => f.port.commit({expected, changes, signal: new AbortController().signal,
      context: {consumerId: 'common-fixture', nowMs: 0, settings: null}}));unchanged(f, seed);
    return;
  }
  const f = await domFixture(t, policy, seed);
  switch (id) {
    case 'BC01':
      assert.equal(f.byLabel('PROPERTY').tagName, 'OUTPUT');assert.equal(f.byLabel('VALUE').tagName, 'OUTPUT');
      assert.equal((await f.save()).status, 'saved');unchanged(f, seed);break;
    case 'BC02': {
      assert.equal(f.byLabel('VALUE').tagName, 'OUTPUT');assert.deepEqual(await f.save(), {status: 'saved', changed: false});unchanged(f, seed);
      const repair = await domFixture(t, policy, seed);await repair.change('PROPERTY', 'width');
      assert.equal(repair.byLabel('VALUE').tagName, 'INPUT');assert.equal(repair.byLabel('VALUE').inputMode, 'decimal');
      assert.equal((await repair.save()).status, 'saved');assert.deepEqual(repair.requests[0].changes, [{argument: 'PROPERTY', value: 'width'}]);break;
    }
    case 'BC03':
      assert.equal(f.byLabel('VALUE').value, '#AbC');assert.equal(f.byLabel('VALUE color picker').value, '#aabbcc');
      assert.equal((await f.save()).status, 'saved');unchanged(f, seed);break;
    case 'BC04':
      await f.change('PROPERTY', 'width');assert.equal((await f.save()).status, 'invalid');unchanged(f, seed);
      for (const value of ['20', '']) {
        const repaired = await domFixture(t, policy, seed);await repaired.change('PROPERTY', 'width');
        if (value === '') await repaired.click('VALUE Reset');else await repaired.change('VALUE', value);
        assert.equal((await repaired.save()).status, 'saved');assert.equal(repaired.live.arguments.VALUE.value, value);
        assert.equal(repaired.live.arguments.PROPERTY.value, 'width');
      }
      break;
    case 'BC05':
      await f.change('PROPERTY', 'width');assert.equal((await f.save()).status, 'invalid');unchanged(f, seed);break;
    case 'BC06':
      assert.equal(f.byLabel('TRIGGER').tagName, 'OUTPUT');assert.equal(f.byLabel('TIMEOUT').tagName, 'OUTPUT');
      assert.equal((await f.save()).status, 'saved');unchanged(f, seed);break;
    case 'BC07': case 'BC08':
      await f.change('TRIGGER', 'condition');assert.equal((await f.save()).status, 'invalid');unchanged(f, seed);break;
    case 'BC09':
      assert.ok(f.container.textContent.includes('runtime validity has not been checked'));await f.change('TIMEOUT', '20');
      assert.equal((await f.save()).status, 'saved');assert.deepEqual(f.requests[0].changes, [{argument: 'TIMEOUT', value: '20'}]);
      assert.deepEqual(f.live.arguments.CONDITION, {kind: 'reporter'});break;
    case 'BC10':
      for (const variant of ['raw', 'connection']) {
        const changed = await domFixture(t, policy, seed);await changed.change('TIMEOUT', '20');
        if (variant === 'raw') changed.live.arguments.CONDITION.value = 'outside';
        else {changed.live.arguments.CONDITION = {kind: 'reporter'};changed.live.fixedContext.inputs.CONDITION = {role: 'readonly', source: 'reporter', identity: 'outside-reporter'};}
        assert.equal((await changed.save()).status, 'conflict');assert.equal(changed.requests.length, 0);
        assert.equal(changed.live.arguments.TIMEOUT.value, '10');
        assert.equal(variant === 'raw' ? changed.live.arguments.CONDITION.value : changed.live.fixedContext.inputs.CONDITION.identity, variant === 'raw' ? 'outside' : 'outside-reporter');
      }
      break;
    case 'BC11':
      assert.equal(f.byLabel('DEPENDENT').tagName, 'OUTPUT');await f.change('INDEPENDENT', 'after');
      assert.equal((await f.save()).status, 'saved');assert.deepEqual(f.requests[0].changes, [{argument: 'INDEPENDENT', value: 'after'}]);
      assert.equal(f.live.arguments.SELECTOR.value, 'unknown');assert.equal(f.live.arguments.DEPENDENT.value, 'keep');break;
    case 'BC13': {
      await f.change('TIMEOUT', '20');await f.change('TRIGGER', 'condition');
      assert.equal(f.byLabel('TIMEOUT'), undefined);assert.equal(f.session.getDraft().inputs.TIMEOUT.buffer, '20');assert.equal(f.live.arguments.TIMEOUT.value, '10');
      assert.equal(f.session.getState().canSave, true);await f.change('TRIGGER', 'timeout');assert.equal(f.byLabel('TIMEOUT').value, '20');
      await f.change('TIMEOUT', '1e');await f.change('TRIGGER', 'condition');assert.equal(f.session.getState().canSave, true);
      await f.change('TRIGGER', 'timeout');assert.equal(f.byLabel('TIMEOUT').value, '1e');assert.equal(f.session.getState().canSave, false);
      assert.equal((await f.save()).status, 'invalid');assert.equal(f.session.getDraft().inputs.TIMEOUT.buffer, '1e');unchanged(f, seed);
      for (const exit of ['save', 'cancel', 'dispose', 'project', 'target']) {
        const ended = await domFixture(t, policy, seed);await ended.change('TIMEOUT', '20');await ended.change('TRIGGER', 'condition');
        if (exit === 'save') {assert.equal((await ended.save()).status, 'saved');assert.deepEqual(ended.requests[0].changes, [{argument: 'TRIGGER', value: 'condition'}]);}
        else if (exit === 'cancel') await ended.cancel();
        else if (exit === 'dispose') await ended.dispose();
        else await act(async () => {if (exit === 'project') ended.live.fixedContext.generation = 'other-project';else ended.live.targetId = 'other-target';ended.invalidate();});
        assert.throws(() => ended.session.getDraft(), /closed/);assert.equal(ended.live.arguments.TIMEOUT.value, '10');
        if (exit !== 'save') assert.equal(ended.requests.length, 0);
        for (const raw of ['10', '30']) {
          const freshSeed = copy(seed);freshSeed.TIMEOUT.literal = raw;const reopened = await domFixture(t, policy, freshSeed);
          assert.equal(reopened.byLabel('TIMEOUT').value, raw);assert.equal(reopened.session.getDraft().inputs.TIMEOUT.buffer, undefined);
        }
      }
      const failed = await domFixture(t, policy, seed, {failCommit: true});await failed.change('TIMEOUT', '20');await failed.change('TRIGGER', 'condition');
      assert.equal((await failed.save()).status, 'failed');assert.equal(failed.session.getDraft().inputs.TIMEOUT.buffer, '20');assert.equal(failed.live.arguments.TIMEOUT.value, '10');
      break;
    }
    case 'BC15':
      await f.change('TRIGGER', 'timeout');assert.equal((await f.save()).status, 'invalid');unchanged(f, seed);break;
    case 'BC16':
      await f.change('TRIGGER', 'timeout');assert.equal((await f.save()).status, 'saved');
      assert.deepEqual(f.requests[0].changes, [{argument: 'TRIGGER', value: 'timeout'}]);assert.equal(f.live.fixedContext.inputs.CONDITION.source, 'unsupported');break;
    default: assert.fail(`Unimplemented acceptance binding ${item.id}`);
  }
});
