import assert from 'node:assert/strict';
import {after} from 'node:test';
import {createRequire} from 'node:module';
import {JSDOM} from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>', {url: 'http://localhost/'});
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'MutationObserver']) Object.defineProperty(globalThis, name, {value: dom.window[name], configurable: true});
Object.defineProperty(globalThis, 'MessageChannel', {value: undefined, configurable: true});
after(() => dom.window.close());
const {act, Simulate} = createRequire(import.meta.url)('react-dom/test-utils');
const {formFixture} = await import('./fixed-form-fixture.ts');

export async function domFixture(t, policy, seed, configure) {
  const fixture = formFixture(policy, seed, configure);
  const container = document.createElement('div');document.body.append(container);
  let unmount;
  const mount = async () => {await act(async () => {unmount = fixture.session.mount(container);});};
  t.after(() => {act(() => fixture.close());container.remove();});
  await mount();
  const byLabel = label => [...container.querySelectorAll('[aria-label]')].find(item => item.getAttribute('aria-label') === label);
  const change = async (argument, value) => {
    const element = byLabel(argument);assert.ok(element, `Missing editable ${argument}`);
    await act(async () => Simulate.change(element, {target: {value: element.tagName === 'SELECT' ? JSON.stringify(value) : value}}));
  };
  const click = async label => {const button = byLabel(label);assert.ok(button, `Missing ${label}`);await act(async () => Simulate.click(button));};
  const save = async () => {let result;await act(async () => {result = await fixture.session.save();});return result;};
  const cancel = async () => {await act(async () => fixture.session.cancel());};
  const dispose = async () => {await act(async () => fixture.session.dispose());};
  return {...fixture, container, byLabel, change, click, save, cancel, dispose,
    mount, unmount: async () => {await act(async () => unmount());}};
}

export {act};
