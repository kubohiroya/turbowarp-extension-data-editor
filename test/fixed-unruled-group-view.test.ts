import assert from 'node:assert/strict';
import test from 'node:test';
import {domFixture} from './fixtures/fixed-form-dom.ts';
import {policyOptions} from './fixtures/fixed-form-fixture.ts';
const seed = {SELECTOR: {literal: 'unknown'}, DEPENDENT: {literal: 'keep'}, INDEPENDENT: {literal: 'old'}};
const options = () => {const value = policyOptions('common-only');delete value.branchPolicies;return value;};

test('a dependency group without branch rules renders every member readonly and saves an independent edit', async t => {
  const f = await domFixture(t, 'common-only', seed, {options: options()});
  for (const argument of ['SELECTOR', 'DEPENDENT']) {
    assert.equal(f.session.getFixedInputView().inputs[argument].state, 'readonly');
    assert.equal(f.byLabel(argument).tagName, 'OUTPUT');
    assert.equal(f.container.querySelector(`[data-fixed-argument="${argument}"]`).disabled, true);
  }
  assert.equal(f.byLabel('INDEPENDENT').tagName, 'TEXTAREA');
  await f.change('INDEPENDENT', 'after');assert.equal((await f.save()).status, 'saved');
  assert.deepEqual(f.requests[0].changes, [{argument: 'INDEPENDENT', value: 'after'}]);
  assert.equal(f.live.arguments.SELECTOR.value, 'unknown');assert.equal(f.live.arguments.DEPENDENT.value, 'keep');
});

test('forged edits to an unruled readonly group reject the entire save with the existing diagnostic', async t => {
  const f = await domFixture(t, 'common-only', seed, {options: options()});
  const draft = f.session.getDraft();draft.inputs.SELECTOR = {value: 'known', changed: true};
  draft.inputs.INDEPENDENT = {value: 'after', changed: true};f.session.setDraft(draft);
  const result = await f.save();assert.equal(result.status, 'invalid');
  assert.ok(result.issues.some(issue => issue.message.includes('fixed-dependency-validation-unavailable')));
  assert.equal(f.requests.length, 0);assert.equal(f.live.arguments.SELECTOR.value, 'unknown');
  assert.equal(f.live.arguments.INDEPENDENT.value, 'old');
});
