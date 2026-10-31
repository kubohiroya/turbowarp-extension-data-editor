import bindBlockEditorFieldErrors from './field-errors.js';
import {attachEditorDialogWindow} from './dialog-window.js';
export {default as bindBlockEditorFieldErrors} from './field-errors.js';
import * as React from 'react';
import {BlockEditorConflictError} from './types.js';
import {BlockEditorStructureError} from './descendant-types.js';
import type {SessionStatus, ValidationIssue, SaveResult} from './types.js';
import type {
  DescendantNodeDescriptor, DescendantNodeEditor, DescendantValidationIssue, DescendantSaveResult
} from './descendant-types.js';

type Issue = ValidationIssue | DescendantValidationIssue;
export interface DialogSessionState {
  readonly status: SessionStatus | 'invalidated';
  readonly canSave: boolean;
  readonly issues: readonly Issue[];
  readonly error: unknown;
}
export interface DialogSession {
  readonly reference?: {readonly blockId: string};
  getState(): DialogSessionState;
  getFixedInputView?(): unknown;
  subscribe(listener: () => void): () => void;
  mount?(container: HTMLElement): () => void;
  getNodes?(): readonly DescendantNodeDescriptor[];
  getEditor?(blockId: string): DescendantNodeEditor | undefined;
  save(): Promise<SaveResult | DescendantSaveResult>;
  cancel(): boolean;
  dispose(): boolean;
}
export interface EditorDialogMessages {
  readonly title: string;
  readonly saving: string;
  readonly cancel: string;
  readonly save: string;
  readonly saveAll: string;
  readonly structureError: string;
  readonly conflict: string;
  readonly failed: string;
  readonly structuralNode: string;
  /** Fixed forms retain technical diagnostics in the API while showing a localized summary. */
  readonly invalidInput?: string;
  readonly maximize?: string;
  readonly restore?: string;
}
export interface EditorNodeAppearance {
  readonly name?: string;
  readonly colour?: string;
  readonly tint?: string;
  readonly iconURI?: string;
}
export interface EditorModalProps {
  readonly id: string;
  readonly className: string;
  readonly contentLabel: string;
  readonly headerImage?: string;
  readonly headerClassName?: string | undefined;
  readonly onRequestClose: () => void;
  readonly children?: React.ReactNode;
}
export interface BlockEditorDialogProps {
  readonly session: DialogSession;
  readonly ModalComponent: React.ComponentType<EditorModalProps>;
  readonly messages: EditorDialogMessages;
  readonly styles: Readonly<Record<string, string>>;
  readonly className?: string;
  readonly nodeAppearances?: Readonly<Record<string, EditorNodeAppearance>> | undefined;
  readonly nodeLabels?: Readonly<Record<string, string>> | undefined;
  readonly onClose: () => void;
  readonly onError?: (error: unknown) => void;
}

class NodeBody extends React.Component<{editor: DescendantNodeEditor; onError: (error: unknown) => void}> {
  private body: HTMLDivElement | null = null;
  private unmountBody: (() => void) | undefined;
  componentDidMount(): void {
    try { this.unmountBody = this.props.editor.mount(this.body!); }
    catch (error) { this.props.onError(error); }
  }
  componentWillUnmount(): void {
    try { this.unmountBody?.(); }
    catch (error) { this.props.onError(error); }
  }
  render(): React.ReactNode { return <div ref={body => { this.body = body; }} />; }
}

let nextBodyId = 0;
type TreeProps = Pick<BlockEditorDialogProps, 'session' | 'styles' | 'messages' | 'nodeAppearances' | 'nodeLabels'> & {
  readonly disabled: boolean;
  readonly onError: (error: unknown) => void;
};
class DescendantTree extends React.Component<TreeProps, {expanded: Set<string>; failedIcons: Set<string>}> {
  private readonly nodes = this.props.session.getNodes!();
  private readonly children = new Map<string | null, DescendantNodeDescriptor[]>();
  private readonly sections = new Map<string, HTMLElement>();
  private readonly bodyIds = new Map<string, string>();
  private focusFrame: number | undefined;
  constructor(props: TreeProps) {
    super(props);
    for (const node of this.nodes) {
      const path = node.inputPath;
      const parent = path.length ? path[path.length - 1]!.blockId : null;
      if (!this.children.has(parent)) this.children.set(parent, []);
      this.children.get(parent)!.push(node);
      this.bodyIds.set(node.reference.blockId, `block-editor-node-${++nextBodyId}`);
    }
    this.state = {failedIcons: new Set(), expanded: new Set(this.nodes.filter(node =>
      this.nodes.length <= 30 || node.inputPath.length === 0).map(node => node.reference.blockId))};
  }
  componentWillUnmount(): void {
    if (this.focusFrame !== undefined) cancelAnimationFrame(this.focusFrame);
  }
  reveal(issue?: Issue): void {
    if (!issue || !('reference' in issue)) return;
    const expanded = new Set(this.state.expanded);
    for (const step of issue.inputPath) expanded.add(step.blockId);
    expanded.add(issue.reference.blockId);
    this.setState({expanded}, () => {
      if (this.focusFrame !== undefined) cancelAnimationFrame(this.focusFrame);
      this.focusFrame = requestAnimationFrame(() => {
        const section = this.sections.get(issue.reference.blockId);
        if (!section) return;
        const controls = [...section.querySelectorAll<HTMLElement>('input, textarea, select')];
        const path = (issue.path || '').replace(/^\./, '').replace(/\[(\d+)\]/g, '_$1').replace(/\./g, '_');
        const field = controls.find(control => path && control.id.endsWith(`_${path}`)) || controls[0];
        const target = field || section.querySelector('button');
        target?.focus();
        target?.scrollIntoView?.({block: 'nearest'});
      });
    });
  }
  private toggle(id: string): void {
    const expanded = new Set(this.state.expanded);
    if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
    this.setState({expanded});
  }
  private renderNode(node: DescendantNodeDescriptor): React.ReactNode {
    const {styles, session, messages} = this.props;
    const id = node.reference.blockId;
    const expanded = this.state.expanded.has(id);
    const editor = session.getEditor?.(id);
    const step = node.inputPath[node.inputPath.length - 1];
    const appearance = this.props.nodeAppearances?.[id] || {};
    const label = appearance.name || this.props.nodeLabels?.[id] || node.opcode;
    const style = {
      '--block-editor-node-colour': appearance.colour,
      '--block-editor-node-tint': appearance.tint
    } as React.CSSProperties;
    return <section className={styles.treeNode} data-block-editor-node={id} key={id} style={style}
      ref={section => { if (section) this.sections.set(id, section); else this.sections.delete(id); }}>
      <h3 className={styles.nodeHeading}>
        <button aria-controls={this.bodyIds.get(id)} aria-expanded={expanded} data-block-editor-toggle={id}
          disabled={this.props.disabled} type="button" onClick={() => this.toggle(id)}>
          <span aria-hidden="true">{expanded ? '▾ ' : '▸ '}</span>
          {appearance.iconURI && !this.state.failedIcons.has(id) ? <img alt="" aria-hidden="true"
            className={styles.nodeIcon} data-block-editor-node-icon={id} draggable={false} src={appearance.iconURI}
            onError={() => this.setState(state => ({failedIcons: new Set([...state.failedIcons, id])}))} /> : null}
          <span className={styles.nodeCaption}>
            <span data-block-editor-node-name={id}>{label}</span>
            <span className={styles.nodeIdentity}>
              {step ? <span className={styles.branchName}>{`${step.input} · ${step.index + 1}: `}</span> : null}{id}
            </span>
          </span>
        </button>
      </h3>
      <div hidden={!expanded} id={this.bodyIds.get(id)}>{expanded ? <React.Fragment>
        {editor ? <NodeBody editor={editor} onError={this.props.onError} /> :
          <p className={styles.structuralNode}>{messages.structuralNode}</p>}
        {(this.children.get(id) || []).map(child => this.renderNode(child))}
      </React.Fragment> : null}</div>
    </section>;
  }
  render(): React.ReactNode {
    return <div className={this.props.styles.tree}>
      {(this.children.get(null) || []).map(node => this.renderNode(node))}
    </div>;
  }
}

/** The host injects its modal, localized strings and stylesheet mapping; no GUI imports are needed. */
export class BlockEditorDialog extends React.Component<BlockEditorDialogProps, DialogSessionState & {mountFailed: boolean}> {
  private mounted = false;
  private unmounting = false;
  private composing = false;
  private body: HTMLDivElement | null = null;
  private tree: DescendantTree | null = null;
  private focusFrame: number | undefined;
  private removeListener = () => {};
  private unmountBody: (() => void) | undefined;
  private stopFieldErrors: (() => void) | undefined;
  private stopWindow: (() => void) | undefined;
  constructor(props: BlockEditorDialogProps) {
    super(props);
    this.state = {...props.session.getState(), mountFailed: false};
  }
  componentDidMount(): void {
    this.mounted = true;
    this.removeListener = this.props.session.subscribe(() => {
      const state = this.props.session.getState();
      this.setState(state);
      if (['cancelled', 'disposed', 'invalidated'].includes(state.status)) this.props.onClose();
    });
    this.mountBody();
  }
  componentWillUnmount(): void {
    this.unmounting = true;
    this.mounted = false;
    if (this.focusFrame !== undefined) cancelAnimationFrame(this.focusFrame);
    this.removeListener();
    this.stopFieldErrors?.();
    this.stopWindow?.();
    try { this.unmountBody?.(); }
    catch (error) { this.props.onError?.(error); }
    finally { this.props.session.dispose(); }
  }
  private handleBody = (body: HTMLDivElement | null): void => {
    this.body = body;
    if (this.mounted) this.mountBody();
  };
  private mountBody(): void {
    if (!this.body || this.unmountBody || this.state.mountFailed) return;
    try {
      if (!this.stopWindow) this.stopWindow = attachEditorDialogWindow(this.body, {
        headerClassName: this.props.styles.header,
        maximize: this.props.messages.maximize,
        restore: this.props.messages.restore
      });
      if (!this.stopFieldErrors) this.stopFieldErrors = bindBlockEditorFieldErrors(this.body);
      if (typeof this.props.session.getNodes !== 'function') this.unmountBody = this.props.session.mount!(this.body);
      // The modal establishes its focus scope after creating the portal.
      this.focusFrame = requestAnimationFrame(() => {
        if (!this.mounted) return;
        const first = this.body!.querySelector<HTMLElement>('input, textarea, select') ||
          this.body!.querySelector<HTMLElement>('button, [tabindex="0"]');
        first?.focus();
      });
    } catch (error) { this.handleMountError(error); }
  }
  private handleMountError = (error: unknown): void => {
    this.props.onError?.(error);
    if (!this.unmounting) this.setState({mountFailed: true});
  };
  private handleClose = (): void => {
    if (this.props.session.cancel()) return;
    if (this.props.session.getState().status !== 'saving') this.props.onClose();
  };
  private handleSave = async (): Promise<void> => {
    const result = await this.props.session.save();
    if (result.status === 'saved') this.props.onClose();
    if (result.status === 'invalid') this.tree?.reveal(result.issues[0]);
  };
  render(): React.ReactNode {
    const {styles, messages, ModalComponent, session} = this.props;
    const saving = this.state.status === 'saving';
    const hierarchy = typeof session.getNodes === 'function';
    let fixed = false;
    if (session.getFixedInputView && (this.state.status === 'editing' || saving)) {
      try {fixed = Boolean(session.getFixedInputView());} catch {fixed = true;}
    }
    const root = session.getNodes?.().find(node => node.inputPath.length === 0);
    const rootId = session.reference?.blockId || root?.reference.blockId;
    const appearance = rootId ? this.props.nodeAppearances?.[rootId] : undefined;
    const name = appearance?.name || (rootId ? this.props.nodeLabels?.[rootId] : undefined) || root?.opcode;
    const title = name ? messages.title.includes('{name}') ? messages.title.replace('{name}', () => name) :
      /ブロック|block/i.test(messages.title) ? messages.title.replace(/ブロック|block/i, () => name) :
        `${name}: ${messages.title}` : messages.title;
    return <ModalComponent className={`${styles.modalContent || ''} ${hierarchy ? styles.hierarchyModal : ''} ${
      this.props.className || ''}`} contentLabel={title} {...(appearance?.iconURI ? {headerImage: appearance.iconURI} : {})}
      headerClassName={styles.header} id="blockEditorModal" onRequestClose={this.handleClose}>
      <div aria-busy={saving} className={styles.body} data-block-editor-body=""
        onCompositionStart={() => { this.composing = true; }} onCompositionEnd={() => { this.composing = false; }}
        onKeyDownCapture={event => {
          if (this.composing || event.nativeEvent.isComposing || event.keyCode === 229) event.stopPropagation();
        }}>
        <div className={styles.editorBody}>
          <div ref={this.handleBody}>
            {hierarchy ? <DescendantTree session={session} styles={styles} messages={messages} disabled={saving}
              nodeAppearances={this.props.nodeAppearances} nodeLabels={this.props.nodeLabels}
              onError={this.handleMountError} ref={tree => { this.tree = tree; }} /> : null}
          </div>
          <div aria-live="polite" className={styles.errors} role="status">
            {saving ? messages.saving : null}
            {fixed && this.state.issues.length ? <p>{messages.invalidInput || messages.failed}</p> : this.state.issues.map((issue, index) => hierarchy && 'reference' in issue ?
              <button className={styles.nodeError} data-block-editor-issue={index} disabled={saving} key={index}
                type="button" onClick={() => this.tree?.reveal(issue)}>
                {this.props.nodeLabels?.[issue.reference.blockId] || issue.reference.blockId}{': '}{issue.message}
              </button> : <p key={index}>{issue.message}</p>)}
            {this.state.error instanceof BlockEditorStructureError ? messages.structureError :
              this.state.error instanceof BlockEditorConflictError ? messages.conflict :
              (this.state.error || this.state.mountFailed) ? messages.failed : null}
          </div>
        </div>
        <div className={styles.buttons}>
          <button disabled={saving} type="button" onClick={this.handleClose}>{messages.cancel}</button>
          <button data-block-editor-save="" disabled={!this.state.canSave || this.state.mountFailed}
            type="button" onClick={this.handleSave}>
            {saving ? messages.saving : hierarchy ? messages.saveAll : messages.save}
          </button>
        </div>
      </div>
    </ModalComponent>;
  }
}
