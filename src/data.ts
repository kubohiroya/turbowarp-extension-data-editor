import type {
  ArgumentSlot, BlockReference, BlockSnapshot, JsonValue, LiteralValue
} from './types.js';

export function isLiteral(value: unknown): value is LiteralValue {
  return typeof value === 'string' || typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value));
}

/** Reject values whose meaning would change during JSON persistence. */
export function cloneJson<T extends JsonValue>(value: T): T {
  const ancestors = new Set<object>();
  const visit = (item: JsonValue, depth: number): JsonValue => {
    if (depth > 100) throw new TypeError('JSON data exceeds the maximum depth.');
    if (item === null || isLiteral(item)) return item;
    if (typeof item !== 'object') throw new TypeError('Expected JSON-compatible data.');
    if (ancestors.has(item)) throw new TypeError('JSON data must not contain cycles.');
    ancestors.add(item);
    try {
      if (Array.isArray(item)) return Array.from(item, child => visit(child, depth + 1));
      const prototype: unknown = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError('JSON objects must be plain objects.');
      }
      if (Object.getOwnPropertySymbols(item).length > 0) {
        throw new TypeError('JSON objects must not have symbol properties.');
      }
      return Object.fromEntries(Object.entries(item).map(([key, child]) =>
        [key, visit(child, depth + 1)]));
    } finally {
      ancestors.delete(item);
    }
  };
  return visit(value, 0) as T;
}

export function captureReference(reference: BlockReference): BlockReference {
  if (!reference || typeof reference.targetId !== 'string' || !reference.targetId ||
      typeof reference.blockId !== 'string' || !reference.blockId) {
    throw new TypeError('A target ID and block ID are required.');
  }
  return Object.freeze({targetId: reference.targetId, blockId: reference.blockId});
}

/** Copies the host-reported defaults; throws when one is not a literal. */
export function captureDefaults(value: unknown): Readonly<Record<string, LiteralValue>> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid block defaults.');
  const copy: Record<string, LiteralValue> = Object.create(null) as Record<string, LiteralValue>;
  for (const [name, raw] of Object.entries(value)) {
    if (!isLiteral(raw)) throw new TypeError(`Invalid default: ${name}`);
    copy[name] = raw;
  }
  return Object.freeze(copy);
}

export function captureSnapshot(snapshot: BlockSnapshot, reference: BlockReference): BlockSnapshot {
  if (snapshot.targetId !== reference.targetId || snapshot.blockId !== reference.blockId ||
      typeof snapshot.opcode !== 'string' || !snapshot.opcode ||
      typeof snapshot.revision !== 'string' || !snapshot.revision ||
      !snapshot.arguments || typeof snapshot.arguments !== 'object' ||
      Array.isArray(snapshot.arguments)) {
    throw new TypeError('The host returned an invalid block snapshot.');
  }
  const entries = Object.entries(snapshot.arguments).map(([name, slot]) => {
    if (!slot || (slot.kind !== 'reporter' && slot.kind !== 'literal') ||
        (slot.kind === 'literal' && !isLiteral(slot.value))) {
      throw new TypeError(`Invalid argument slot: ${name}`);
    }
    const copy: ArgumentSlot = slot.kind === 'reporter'
      ? Object.freeze({kind: 'reporter'})
      : Object.freeze({kind: 'literal', value: slot.value});
    return [name, copy] as const;
  });
  const defaults = captureDefaults(snapshot.defaults);
  return Object.freeze({
    ...captureReference(reference), opcode: snapshot.opcode, revision: snapshot.revision,
    arguments: Object.freeze(Object.fromEntries(entries)), ...(defaults ? {defaults} : {})
  });
}

export function sameSnapshot(left: BlockSnapshot, right: BlockSnapshot): boolean {
  const names = Object.keys(left.arguments);
  return left.targetId === right.targetId && left.blockId === right.blockId &&
    left.opcode === right.opcode && left.revision === right.revision &&
    names.length === Object.keys(right.arguments).length && names.every(name => {
      const a = left.arguments[name]!;
      const b = Object.hasOwn(right.arguments, name) ? right.arguments[name] : undefined;
      return b !== undefined && a.kind === b.kind &&
        (a.kind === 'reporter' || (b.kind === 'literal' && a.value === b.value));
    });
}
