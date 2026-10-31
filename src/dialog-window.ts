interface Bounds {x: number; y: number; width: number; height: number}
interface WindowLabels {
  readonly headerClassName?: string | undefined;
  readonly maximize?: string | undefined;
  readonly restore?: string | undefined;
}

/** Add window controls to the injected host frame without depending on GUI internals. */
export function attachEditorDialogWindow(body: HTMLElement, labels: WindowLabels): (() => void) | undefined {
  const dialog = body.closest<HTMLElement>('[role="dialog"]');
  const header = (labels.headerClassName ? dialog?.getElementsByClassName(labels.headerClassName)[0] :
    dialog?.querySelector('header')) as HTMLElement | undefined;
  const content = body.closest<HTMLElement>('[data-block-editor-body]');
  if (!dialog || !header || !content || !header.parentElement?.contains(content)) return;
  const doc = dialog.ownerDocument, win = doc.defaultView;
  if (!win) return;
  const frame = header.parentElement;
  const initialStyle = dialog.style.cssText;
  const language = doc.documentElement.lang || new URLSearchParams(win.location.search).get('lang') || win.navigator.language;
  const japanese = language.startsWith('ja');
  const maximizeLabel = labels.maximize || (japanese ? '全画面化' : 'Maximize');
  const restoreLabel = labels.restore || (japanese ? '元のサイズに戻す' : 'Restore window');
  let restoreBounds: Bounds | null = null;
  let gesture: {id: number; target: HTMLElement; edge: string; x: number; y: number; rect: Bounds} | null = null;
  const handles: HTMLElement[] = [];
  dialog.setAttribute('data-block-editor-window', '');
  if (frame !== dialog) frame.setAttribute('data-block-editor-window-frame', '');
  header.setAttribute('data-block-editor-titlebar', '');
  const maximize = doc.createElement('button');
  maximize.type = 'button';
  maximize.setAttribute('data-block-editor-maximize', '');
  const closeContainer = header.lastElementChild;
  if (closeContainer?.querySelector('button, [role="button"]')) closeContainer.prepend(maximize);
  else header.insertBefore(maximize, closeContainer);

  const viewport = () => ({width: win.innerWidth, height: win.innerHeight});
  const bounds = (): Bounds => {
    const {x, y, width, height} = dialog!.getBoundingClientRect();
    return {x, y, width, height};
  };
  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
  function fit(rect: Bounds): Bounds {
    const view = viewport();
    const width = clamp(rect.width, Math.min(360, view.width), view.width);
    const height = clamp(rect.height, Math.min(280, view.height), view.height);
    return {width, height, x: clamp(rect.x, 0, view.width - width), y: clamp(rect.y, 0, view.height - height)};
  }
  function place(rect: Bounds): void {
    Object.assign(dialog!.style, {margin: '0', inset: 'auto', transform: 'none', maxHeight: '100dvh',
      left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px`});
  }
  function stop(event?: Event): void {
    if (!gesture || (event && 'pointerId' in event && event.pointerId !== gesture.id)) return;
    const {target, id} = gesture;
    gesture = null;
    if (target.hasPointerCapture(id)) target.releasePointerCapture(id);
    dialog!.removeAttribute('data-block-editor-dragging');
  }
  function start(event: PointerEvent, edge: string): void {
    if (restoreBounds || gesture || event.button !== 0 || !event.isPrimary) return;
    if (!edge && (event.target as Element).closest('button, a, input, select, textarea, [role="button"]')) return;
    event.preventDefault();
    const target = event.currentTarget as HTMLElement;
    gesture = {id: event.pointerId, target, edge, x: event.clientX, y: event.clientY, rect: fit(bounds())};
    place(gesture.rect);
    target.setPointerCapture(event.pointerId);
    dialog!.setAttribute('data-block-editor-dragging', '');
  }
  function move(event: PointerEvent): void {
    if (!gesture || event.pointerId !== gesture.id) return;
    const {rect, edge} = gesture, view = viewport();
    const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
    if (!edge) {place(fit({...rect, x: rect.x + dx, y: rect.y + dy})); return;}
    const minWidth = Math.min(360, view.width), minHeight = Math.min(280, view.height);
    let left = rect.x, top = rect.y, right = rect.x + rect.width, bottom = rect.y + rect.height;
    if (edge.includes('w')) left = clamp(left + dx, 0, right - minWidth);
    if (edge.includes('e')) right = clamp(right + dx, left + minWidth, view.width);
    if (edge.includes('n')) top = clamp(top + dy, 0, bottom - minHeight);
    if (edge.includes('s')) bottom = clamp(bottom + dy, top + minHeight, view.height);
    place({x: left, y: top, width: right - left, height: bottom - top});
  }
  const startMove = (event: PointerEvent) => start(event, '');
  header.addEventListener('pointerdown', startMove);
  for (const edge of ['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw']) {
    const handle = doc.createElement('div');
    handle.setAttribute('data-block-editor-resize', edge);
    handle.setAttribute('aria-hidden', 'true');
    handle.addEventListener('pointerdown', event => start(event, edge));
    dialog.append(handle);
    handles.push(handle);
  }
  function updateButton(): void {
    const label = restoreBounds ? restoreLabel : maximizeLabel;
    maximize.setAttribute('aria-label', label);
    maximize.setAttribute('aria-pressed', String(Boolean(restoreBounds)));
    maximize.title = label;
    maximize.textContent = restoreBounds ? '❐' : '⛶';
    dialog!.toggleAttribute('data-block-editor-maximized', Boolean(restoreBounds));
  }
  function toggle(): void {
    stop();
    if (restoreBounds) {place(fit(restoreBounds)); restoreBounds = null;}
    else {restoreBounds = bounds(); place({x: 0, y: 0, ...viewport()});}
    updateButton();
  }
  function resize(): void {
    stop();
    if (restoreBounds) place({x: 0, y: 0, ...viewport()});
    else place(fit(bounds()));
  }
  maximize.addEventListener('click', toggle);
  win.addEventListener('pointermove', move);
  win.addEventListener('pointerup', stop);
  win.addEventListener('pointercancel', stop);
  win.addEventListener('blur', stop);
  win.addEventListener('resize', resize);
  dialog.addEventListener('lostpointercapture', stop);
  updateButton();
  return () => {
    stop();
    header.removeEventListener('pointerdown', startMove);
    win.removeEventListener('pointermove', move);
    win.removeEventListener('pointerup', stop);
    win.removeEventListener('pointercancel', stop);
    win.removeEventListener('blur', stop);
    win.removeEventListener('resize', resize);
    dialog.removeEventListener('lostpointercapture', stop);
    maximize.remove();
    handles.forEach(handle => handle.remove());
    dialog.style.cssText = initialStyle;
    for (const name of ['window', 'maximized', 'dragging']) dialog.removeAttribute(`data-block-editor-${name}`);
    if (frame !== dialog) frame.removeAttribute('data-block-editor-window-frame');
    header.removeAttribute('data-block-editor-titlebar');
  };
}
