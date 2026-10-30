import createBridge, {openBlockEditorSession as openSession} from './turbowarp/bridge.js';
import createHost from './turbowarp/host.js';
import bindIcon from './turbowarp/icon.js';
import readAppearance from './turbowarp/appearance.js';
import createErrorSession from './turbowarp/error-session.js';
import type {BlockEditorHost, BlockReference} from './types.js';
import type {EditorRegistry} from './registry.js';
import type {EditorSession} from './session.js';
import type {DescendantSession} from './descendants.js';

export interface TurboWarpNodeAppearance {
  readonly name?: string;
  readonly colour?: string;
  readonly tint?: string;
  readonly iconURI?: string;
}

/** Native vendor instances are opaque: the adapter owns their private API dependencies. */
export interface TurboWarpHostOptions {
  readonly ScratchBlocks: object;
  readonly workspace: object;
  readonly vm: object;
  readonly registry: EditorRegistry;
  readonly enableDescendants?: boolean;
  /** Opt in to standard fixed fields; GUI binding remains a separate capability. */
  readonly enableFixedInputs?: boolean;
  readonly onError?: (error: unknown) => void;
}
export interface TurboWarpBlockEditorHost extends BlockEditorHost {
  invalidate(): void;
  isCommitting(): boolean;
  dispose(): void;
}
export type BlockEditorFailureSession = Pick<EditorSession,
  'reference' | 'getState' | 'subscribe' | 'mount' | 'save' | 'cancel' | 'dispose'>;
export type TurboWarpEditorSession = EditorSession | DescendantSession | BlockEditorFailureSession;

export interface TurboWarpBlockEditorOptions {
  /** Only true attaches listeners or decorates icons. Read feature flags in the host at startup. */
  readonly enabled?: boolean;
  readonly descendants?: boolean;
  /** Opt in to fixed argument editors independently of SourceForms and Descendants. */
  readonly fixedInputs?: boolean;
  readonly ScratchBlocks: object;
  readonly workspace: object;
  readonly vm: object;
  readonly service: {
    readonly registry: EditorRegistry;
    subscribe(listener: () => void): () => void;
  };
  readonly label: string;
  /** The host decides visibility and whether another modal already owns the screen. */
  readonly canOpen: () => boolean;
  readonly onOpen: (
    session: TurboWarpEditorSession,
    labels?: Readonly<Record<string, string>>,
    appearances?: Readonly<Record<string, TurboWarpNodeAppearance>>
  ) => void;
  readonly onError?: (error: unknown) => void;
}
export interface TurboWarpBlockEditorAttachment {
  refresh(): void;
  /** Remove all listeners/decorations and invalidate the active session. Idempotent. */
  dispose(): void;
}

/** Attach to one workspace. No global VM, feature flag, React or GUI module is consulted. */
export function attachTurboWarpBlockEditors(options: TurboWarpBlockEditorOptions): TurboWarpBlockEditorAttachment {
  if (options.enabled !== true) return Object.freeze({refresh() {}, dispose() {}});
  const bridge = createBridge({...options, descendants: options.descendants === true, fixedInputs: options.fixedInputs === true,
    onError: options.onError ?? console.error});
  let disposed = false;
  return Object.freeze({
    refresh() { if (!disposed) bridge.refresh(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      bridge.dispose();
    }
  });
}

/** Lower-level host port for custom integrations; standard GUI integrations use attachTurboWarpBlockEditors. */
export function createTurboWarpBlockEditorHost(options: TurboWarpHostOptions): TurboWarpBlockEditorHost {
  return createHost(options) as TurboWarpBlockEditorHost;
}
export function bindBlockEditorIcon(options: {
  readonly element: HTMLElement | SVGElement;
  readonly label: string;
  readonly canOpen: () => boolean;
  readonly onOpen: () => void;
  readonly onHover?: () => void;
  readonly onLeave?: () => void;
}): () => void {
  return bindIcon(options);
}
/** Supply editor arguments to include other literal inputs as parenthesized identifiers. */
export function readBlockEditorAppearance(
  block: object | null, ScratchBlocks: object, editableArguments?: readonly string[]
): TurboWarpNodeAppearance {
  return readAppearance(block, ScratchBlocks, editableArguments);
}
export function createBlockEditorErrorSession(reference: BlockReference, error: unknown): BlockEditorFailureSession {
  return createErrorSession(reference, error) as BlockEditorFailureSession;
}
export function openBlockEditorSession(options: {
  readonly registry: EditorRegistry;
  readonly reference: BlockReference;
  readonly host: BlockEditorHost;
  readonly descendants: boolean;
}): EditorSession | DescendantSession | undefined {
  return openSession(options);
}
