import * as React from 'react';
import * as ReactDOM from 'react-dom';
import {parseFixedNumberInput} from './fixed-input-schema.js';
import type {FixedInputViewDescription} from './fixed-input-types.js';
import type {EditorViewContext, JsonObject, JsonValue, ValidationIssue} from './types.js';

export interface FixedInputViewMessages {
  readonly reset: string;
  readonly readOnly: string;
  readonly unverified: string;
  readonly currentValue: string;
  readonly colorPicker: string;
  readonly invalidValue: string;
  readonly inactiveDraft: string;
}
export type FixedInputMessageSource = Partial<FixedInputViewMessages> | (() => Partial<FixedInputViewMessages>);

const defaultMessages: FixedInputViewMessages = Object.freeze({
  reset: 'Reset', readOnly: 'This input cannot be edited safely.',
  unverified: 'The expression is retained without evaluation. Its runtime validity has not been checked.',
  currentValue: 'Current value', colorPicker: 'color picker', invalidValue: 'Check this value before saving.',
  inactiveDraft: 'Hidden edits are retained in this dialog and will not be saved while hidden.'
});
export function captureFixedInputMessages(input?: Partial<FixedInputViewMessages>): FixedInputViewMessages {
  if (input === undefined) return defaultMessages;
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) || Object.getOwnPropertySymbols(input).length) throw new TypeError('Invalid fixed form messages.');
  const result = {...defaultMessages};
  for (const key of Object.getOwnPropertyNames(input)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
    if (!Object.hasOwn(defaultMessages, key) || !('value' in descriptor) || typeof descriptor.value !== 'string' || !descriptor.value) throw new TypeError('Invalid fixed form messages.');
    Object.defineProperty(result, key, {value: descriptor.value, enumerable: true});
  }
  return Object.freeze(result);
}

export function resolveFixedInputMessages(source?: FixedInputMessageSource): FixedInputViewMessages {
  const value = typeof source === 'function' ? source() : source;
  try {return captureFixedInputMessages(value);}
  catch (error) {
    try {void Promise.prototype.then.call(value, () => undefined, () => undefined);} catch { /* UI providers are synchronous; never inspect thenables. */ }
    throw error;
  }
}

const record = (value: unknown): value is JsonObject => !!value && typeof value === 'object' && !Array.isArray(value);
const display = (value: JsonValue | undefined): string => typeof value === 'string' ? value
  : typeof value === 'number' && Object.is(value, -0) ? '-0' : value === undefined ? '' : JSON.stringify(value);
const serialized = (value: JsonValue | undefined): string => value === undefined ? 'unavailable' : JSON.stringify(value);
function preview(value: string): string | undefined {
  if (/^#[\da-f]{6}$/iu.test(value)) return value.toLowerCase();
  return /^#[\da-f]{3}$/iu.test(value) ? `#${value.slice(1).split('').map(part => part + part).join('').toLowerCase()}` : undefined;
}
function describe(context: EditorViewContext): FixedInputViewDescription {
  if (typeof context.getFixedInputView !== 'function') throw new TypeError('A fixed form requires a fixed session.');
  const result = context.getFixedInputView();
  if (!result) throw new TypeError('A fixed form requires a fixed session.');
  return result;
}

/** Presentation issues plus the save-time check, so Save is disabled as soon as the draft would be rejected. */
function liveIssues(context: EditorViewContext): readonly ValidationIssue[] {
  const issues = [...describe(context).issues];
  const checked = typeof context.checkFixedInput === 'function' ? context.checkFixedInput() ?? [] : [];
  for (const issue of checked) {
    if (!issues.some(item => item.message === issue.message && item.path === issue.path)) issues.push(issue);
  }
  return issues;
}

let nextFixedViewId = 0;

/** The session owns every buffer, including controls temporarily absent from the DOM. */
function FixedInputView({context, messages}: {context: EditorViewContext; messages: FixedInputViewMessages}): React.ReactElement {
  const [, redraw] = React.useState(0);
  const [viewId] = React.useState(() => `block-editor-fixed-${++nextFixedViewId}`);
  React.useEffect(() => {
    const stop = context.subscribe(() => redraw(value => value + 1));
    if (context.getState().status === 'editing' && !context.getState().issues.length) {
      context.setValidationIssues(describe(context).issues);
    }
    return stop;
  }, [context]);
  const state = context.getState();
  if (state.status !== 'editing' && state.status !== 'saving') return <></>;
  const description = describe(context);
  const draft = context.getDraft();
  const inputs = record(draft.inputs) ? draft.inputs : {};
  const update = (argument: string, value: JsonValue, buffer?: string): void => {
    if (context.getState().status !== 'editing') return;
    const latest = describe(context).inputs[argument];
    if (!latest || latest.state !== 'editable') return;
    const next = context.getDraft();
    if (!record(next.inputs)) throw new TypeError('Invalid fixed form draft.');
    const previous = next.inputs[argument];
    const entry: JsonObject = {value, changed: true};
    if (buffer !== undefined) entry.buffer = buffer;
    if (record(previous) && (previous.readOnly === true || previous.repair === true)) entry.repair = true;
    Object.defineProperty(next.inputs, argument, {value: entry, enumerable: true, configurable: true, writable: true});
    context.setDraft(next);
    context.setValidationIssues(liveIssues(context));
  };
  const hasInactiveEdits = Object.entries(description.inputs).some(([argument, input]) =>
    input.state === 'hidden' && record(inputs[argument]) && inputs[argument].changed === true);
  return <div className="block-editor-fixed-inputs">
    {hasInactiveEdits && <p className="block-editor-fixed-inactive" data-fixed-inactive-draft="" role="status">{messages.inactiveDraft}</p>}
    {Object.entries(description.inputs).map(([argument, input], index) => {
    if (input.state === 'hidden') return null;
    const entry = record(inputs[argument]) ? inputs[argument] as JsonObject : {};
    const value = Object.hasOwn(entry, 'value') ? entry.value : undefined;
    const label = input.label ?? argument;
    const text = typeof entry.buffer === 'string' ? entry.buffer : value === undefined ? input.rawDisplay ?? '' : display(value);
    const disabled = state.status !== 'editing' || input.state !== 'editable';
    const path = `/${argument.replace(/~/g, '~0').replace(/\//g, '~1')}`;
    const invalid = [...state.issues, ...description.issues].some(issue => issue.path === path || issue.path?.startsWith(`${path}/`));
    const errorId = `${viewId}-${index}-error`;
    const reasonId = `${viewId}-${index}-reason`;
    const unverifiedId = `${viewId}-${index}-unverified`;
    const originalId = `${viewId}-${index}-original`;
    const showOriginal = input.control === 'enum' && input.rawDisplay !== undefined && entry.changed !== true && input.rawDisplay !== display(value);
    const descriptions = [input.state === 'readonly' ? reasonId : '', invalid ? errorId : '', input.unverified ? unverifiedId : '', showOriginal ? originalId : ''].filter(Boolean).join(' ');
    const attributes = {'aria-invalid': invalid || undefined, 'data-block-editor-invalid': invalid ? 'true' : undefined,
      'aria-describedby': descriptions || undefined} as const;
    let control: React.ReactNode;
    if (input.state === 'readonly') {
      control = <><output aria-label={label} {...attributes}>{input.rawDisplay ?? text}</output>
        <p id={reasonId} className="block-editor-fixed-readonly">{messages.readOnly}</p></>;
    } else if (input.control === 'enum') {
      const choices = input.choices ?? [];
      const current = serialized(value);
      const known = choices.some(choice => serialized(choice.value) === current);
      control = <select aria-label={label} {...attributes} value={known ? current : 'existing-raw'} disabled={disabled}
        onChange={event => {
          const choice = choices.find(item => serialized(item.value) === event.target.value);
          if (choice) update(argument, choice.value);
        }}>
        {!known && <option value="existing-raw" disabled>{(input.rawDisplay ?? text) || messages.currentValue}</option>}
        {choices.map((choice, index) => <option key={index} value={serialized(choice.value)}>{choice.label ?? display(choice.value)}</option>)}
      </select>;
    } else if (input.control === 'number') {
      control = <input aria-label={label} {...attributes} type="text" inputMode="decimal" value={text} disabled={disabled}
        onChange={event => {
          const buffer = event.target.value;
          if (input.valueType === 'string' || (input.valueType === undefined && typeof value === 'string')) {
            update(argument, buffer);
          } else {
            const parsed = parseFixedNumberInput(buffer);
            update(argument, parsed.kind === 'valid' ? parsed.value : value ?? null, buffer);
          }
        }} />;
    } else if (input.control === 'color') {
      const color = preview(text);
      control = <div className="block-editor-fixed-color">
        <input aria-label={label} {...attributes} type="text" value={text} disabled={disabled} onChange={event => update(argument, event.target.value)} />
        {color !== undefined && <input type="color" aria-label={`${label} ${messages.colorPicker}`} {...attributes} value={color} disabled={disabled}
          onChange={event => update(argument, event.target.value)} />}
      </div>;
    } else control = <textarea aria-label={label} {...attributes} value={text} disabled={disabled} onChange={event => update(argument, event.target.value)} />;
    return <fieldset key={argument} data-fixed-argument={argument} disabled={disabled}>
      <legend>{label}</legend>{control}
      {input.state === 'editable' && input.reset !== undefined && <button type="button" disabled={disabled}
        aria-label={`${label} ${messages.reset}`} onClick={() => update(argument, input.reset!)}>{messages.reset}</button>}
      {showOriginal && <p id={originalId} className="block-editor-fixed-original" data-fixed-original-value="">{messages.currentValue}{': '}<output>{input.rawDisplay}</output></p>}
      {invalid && <p id={errorId} className="block-editor-fixed-error">{messages.invalidValue}</p>}
      {input.unverified && <p id={unverifiedId} className="block-editor-fixed-unverified">{messages.unverified}</p>}
    </fieldset>;
  })}</div>;
}

export function mountFixedInputView(container: HTMLElement, context: EditorViewContext, messages: FixedInputViewMessages = defaultMessages): () => void {
  describe(context);
  ReactDOM.render(<FixedInputView context={context} messages={messages} />, container);
  return () => {ReactDOM.unmountComponentAtNode(container);};
}
