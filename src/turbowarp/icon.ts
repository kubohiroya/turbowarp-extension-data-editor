// Decorate one known FieldImage; never search or intercept unrelated workspace DOM.
const bindBlockEditorIcon = ({element, label, canOpen, onOpen, onHover = () => {}, onLeave = () => {}}: Parameters<typeof import('../turbowarp.js').bindBlockEditorIcon>[0]) => {
    const attributes = ['role', 'tabindex', 'aria-label', 'data-block-editor-icon'];
    const previous = attributes.map(name => element.getAttribute(name));
    const oldCursor = element.style.cursor;
    let press: {id: number; x: number; y: number; moved: boolean} | null = null;
    const stop = (event: Event) => {
        if (!canOpen()) return;
        event.stopPropagation();
        event.preventDefault();
    };
    const down = (event: PointerEvent) => {
        if (!canOpen() || event.button !== 0 || event.isPrimary === false) return;
        stop(event);
        press = {id: event.pointerId, x: event.clientX, y: event.clientY, moved: false};
        element.focus();
        if (element.setPointerCapture) element.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
        if (!press || press.id !== event.pointerId) return;
        stop(event);
        if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 4) press.moved = true;
    };
    const up = (event: PointerEvent) => {
        if (!press || press.id !== event.pointerId) return;
        move(event);
        const open = !press.moved && canOpen();
        press = null;
        if (element.releasePointerCapture && element.hasPointerCapture(event.pointerId)) {
            element.releasePointerCapture(event.pointerId);
        }
        if (open) onOpen();
    };
    const cancel = () => {
        press = null;
    };
    const key = (event: KeyboardEvent) => {
        if ((event.key === 'Enter' || event.key === ' ') && canOpen()) {
            stop(event);
            if (!event.repeat) onOpen();
        }
    };
    const enter = () => { if (canOpen()) onHover?.(); };
    const leave = () => onLeave?.();
    const listeners: Array<[keyof GlobalEventHandlersEventMap, EventListener]> = [
        ['pointerenter', enter], ['pointerleave', leave], ['focus', enter], ['blur', leave],
        ['pointerdown', down as EventListener], ['pointermove', move as EventListener], ['pointerup', up as EventListener], ['pointercancel', cancel],
        ['mousedown', stop], ['mouseup', stop], ['click', stop], ['dblclick', stop],
        ['touchstart', stop], ['touchend', stop], ['touchmove', stop], ['keydown', key as EventListener]
    ];
    element.setAttribute('role', 'button');
    element.setAttribute('tabindex', '0');
    element.setAttribute('aria-label', label);
    element.setAttribute('data-block-editor-icon', '');
    element.style.cursor = 'pointer';
    for (const [type, listener] of listeners) element.addEventListener(type, listener, {passive: false});
    return () => {
        for (const [type, listener] of listeners) element.removeEventListener(type, listener);
        attributes.forEach((name, index) => {
            if (previous[index] == null) element.removeAttribute(name);
            else element.setAttribute(name, previous[index]!);
        });
        element.style.cursor = oldCursor;
        press = null;
    };
};

export default bindBlockEditorIcon;
