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
  readonly ready: string;
  readonly needsAttention: string;
  readonly modeName: string;
  readonly modeBasic: string;
  readonly modeExpert: string;
  readonly basicUnfit: string;
  readonly startBasic: string;
  readonly invalidJson: string;
  readonly noNames: string;
}

/** Renders the basic form of a `json` control. Supplied by the entry that bundles the form library. */
export type FixedJsonFormRenderer = (props: {
  readonly label: string;
  readonly data: JsonValue;
  readonly disabled: boolean;
  readonly onChange: (data: JsonValue) => void;
}) => React.ReactElement;
export type FixedInputMessageSource = Partial<FixedInputViewMessages> | (() => Partial<FixedInputViewMessages>);

const defaultMessages: FixedInputViewMessages = Object.freeze({
  reset: 'Reset', readOnly: 'This input cannot be edited safely.',
  unverified: 'The expression is retained without evaluation. Its runtime validity has not been checked.',
  currentValue: 'Current value', colorPicker: 'color picker', invalidValue: 'Check this value before saving.',
  inactiveDraft: 'Hidden edits are retained in this dialog and will not be saved while hidden.',
  ready: 'Ready', needsAttention: 'Needs attention', modeName: 'Name', modeBasic: 'Basic', modeExpert: 'Expert',
  basicUnfit: 'This value uses features the basic form cannot show. It is shown read-only; edit it in Expert.',
  startBasic: 'Start a basic schema', invalidJson: 'This is not valid JSON yet.', noNames: 'No names are defined.'
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

type JsonMode = 'name' | 'basic' | 'expert';
const EMPTY_BASIC_SCHEMA: JsonObject = {type: 'object', properties: {}};

function initialMode(input: FixedInputViewDescription['inputs'][string], value: JsonValue | undefined): JsonMode {
  if (typeof value === 'string' && input.names !== undefined) return 'name';
  if (input.basic !== undefined && (input.basicFits === true || value === undefined || value === '')) return 'basic';
  return 'expert';
}

/** A collapsible section for one JSON input: a status mark, then name, basic, or expert editing. */
function JsonSection({argument, input, entry, value, label, disabled, invalid, update, messages, renderForm}: {
  argument: string; input: FixedInputViewDescription['inputs'][string]; entry: JsonObject; value: JsonValue | undefined;
  label: string; disabled: boolean; invalid: boolean; messages: FixedInputViewMessages;
  update: (argument: string, value: JsonValue, buffer?: string) => void; renderForm?: FixedJsonFormRenderer;
}): React.ReactElement {
  const modes: JsonMode[] = [...(input.names !== undefined ? ['name' as const] : []),
    ...(input.basic !== undefined && renderForm ? ['basic' as const] : []), 'expert'];
  const [mode, setMode] = React.useState<JsonMode>(() => {
    const first = initialMode(input, value);
    return modes.includes(first) ? first : 'expert';
  });
  const empty = value === undefined || value === '' || value === null;
  const [open, setOpen] = React.useState(!empty);
  const expanded = open || invalid;
  const buffer = typeof entry.buffer === 'string' ? entry.buffer : undefined;
  const text = buffer ?? (value === undefined ? input.rawDisplay ?? '' : JSON.stringify(value, null, 2));
  const unparsable = buffer !== undefined && (() => {try {JSON.parse(buffer);return false;} catch {return true;}})();
  let body: React.ReactNode;
  if (mode === 'name') {
    const names = input.names ?? [];
    const current = typeof value === 'string' ? value : '';
    body = names.length === 0 && !current ? <p>{messages.noNames}</p> :
      <select aria-label={label} value={current} disabled={disabled} onChange={event => update(argument, event.target.value)}>
        {!names.includes(current) && <option value={current} disabled>{current || messages.currentValue}</option>}
        {names.map(name => <option key={name} value={name}>{name}</option>)}
      </select>;
  } else if (mode === 'basic' && renderForm) {
    if (input.basicFits === true) {
      body = renderForm({label, data: value ?? EMPTY_BASIC_SCHEMA, disabled, onChange: data => update(argument, data)});
    } else if (empty || typeof value === 'string') {
      body = <button type="button" disabled={disabled} onClick={() => update(argument, EMPTY_BASIC_SCHEMA)}>{messages.startBasic}</button>;
    } else {
      body = <><p className="block-editor-fixed-json-unfit" role="note">{messages.basicUnfit}</p>
        {renderForm({label, data: value ?? null, disabled: true, onChange: () => undefined})}</>;
    }
  } else {
    body = <><textarea aria-label={label} spellCheck={false} value={text} disabled={disabled} rows={8}
      onChange={event => {
        const next = event.target.value;
        try {update(argument, JSON.parse(next) as JsonValue, next);}
        catch {update(argument, value ?? null, next);}
      }} />
      {unparsable && <p className="block-editor-fixed-error">{messages.invalidJson}</p>}</>;
  }
  return <details className="block-editor-fixed-json" open={expanded} data-fixed-json-mode={mode}
    onToggle={event => setOpen((event.target as HTMLDetailsElement).open)}>
    <summary>
      <span className="block-editor-fixed-json-status" data-fixed-json-status={invalid ? 'attention' : 'ready'}
        role="img" aria-label={invalid ? messages.needsAttention : messages.ready}>{invalid ? '\u26A0' : '\u2611'}</span>
      {' '}{label}
    </summary>
    {modes.length > 1 && <div role="tablist" aria-label={`${label} mode`} className="block-editor-fixed-json-modes">
      {modes.map(item => <button key={item} type="button" role="tab" aria-selected={mode === item}
        disabled={disabled && mode !== item} onClick={() => setMode(item)}>
        {item === 'name' ? messages.modeName : item === 'basic' ? messages.modeBasic : messages.modeExpert}</button>)}
    </div>}
    <div role="tabpanel">{body}</div>
  </details>;
}

/** The session owns every buffer, including controls temporarily absent from the DOM. */
function FixedInputView({context, messages, renderForm}: {context: EditorViewContext; messages: FixedInputViewMessages; renderForm?: FixedJsonFormRenderer}): React.ReactElement {
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
    if (input.control === 'json' && input.state === 'editable') {
      return <JsonSection key={argument} argument={argument} input={input} entry={entry} value={value} label={label}
        disabled={disabled} invalid={invalid} update={update} messages={messages} {...(renderForm ? {renderForm} : {})} />;
    }
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

export function mountFixedInputView(container: HTMLElement, context: EditorViewContext, messages: FixedInputViewMessages = defaultMessages,
  renderForm?: FixedJsonFormRenderer): () => void {
  describe(context);
  ReactDOM.render(<FixedInputView context={context} messages={messages} {...(renderForm ? {renderForm} : {})} />, container);
  return () => {ReactDOM.unmountComponentAtNode(container);};
}
