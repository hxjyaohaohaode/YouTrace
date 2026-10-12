/** Strict data-only graph format for quarantined legacy records. No DB writes. */
export const LEGACY_GRAPH_FORMAT = 'youtrace-structured-clone-v2';
export const LEGACY_LIMITS = { nodes: 200_000, rows: 100_000, bytes: 32 * 1024 * 1024, text: 32 * 1024 * 1024, depth: 256, arrayLength: 1_000_000, entries: 1_000_000 } as const;
type Atom = null | boolean | string | number | { tag: 'undefined' } | { tag: 'number' | 'bigint'; value: string } | { tag: 'ref'; id: number };
type Node = { id: number; type: string; [key: string]: unknown };
export type LegacyGraph = { encoding: typeof LEGACY_GRAPH_FORMAT; root: Atom; nodes: Node[] };
const failure = () => new Error('旧版记录与结构备份未生成：格式、类型或容量超出安全支持范围；原库未修改，请保留原库并联系恢复支持');
function fail(): never { throw failure(); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) fail();
  if (Reflect.ownKeys(value).length !== Object.keys(value).length) fail();
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) if (!('value' in descriptor)) fail();
  return value as Record<string, unknown>;
}
function shape(value: unknown, keys: string[]): Record<string, unknown> {
  const result = object(value);
  if (Object.keys(result).length !== keys.length || keys.some(key => !Object.hasOwn(result, key))) fail();
  return result;
}
function integer(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > maximum) fail();
  return value;
}
function string(value: unknown): string { if (typeof value !== 'string') fail(); return value; }
function list(value: unknown): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > LEGACY_LIMITS.entries) fail();
  if (Reflect.ownKeys(value).length !== value.length + 1) fail();
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) fail();
  }
  return value;
}
function toBase64(bytes: Uint8Array): string {
  let result = '';
  for (let offset = 0; offset < bytes.length; offset += 16384) result += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
  return btoa(result);
}
function fromBase64(value: unknown): Uint8Array<ArrayBuffer> {
  const text = string(value);
  if (text.length > Math.ceil(LEGACY_LIMITS.bytes / 3) * 4 || text.length % 4 !== 0) fail();
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  for (let i = 0; i < text.length - padding; i++) {
    const code = text.charCodeAt(i);
    if (!(code >= 65 && code <= 90 || code >= 97 && code <= 122 || code >= 48 && code <= 57 || code === 43 || code === 47)) fail();
  }
  const decoded = atob(text);
  if (btoa(decoded) !== text) fail();
  return Uint8Array.from(decoded, c => c.charCodeAt(0));
}
const views = { Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array };
// Platform Blob/File implementations can carry internal symbol slots. IndexedDB
// has already discarded user symbol properties before this snapshot is captured.
function ownBuiltin(value: object): void { if (Object.keys(value).length) fail(); }

export async function encodeLegacyGraph(value: unknown): Promise<LegacyGraph> {
  const seen = new Map<object, number>(), nodes: Node[] = [];
  let binary = 0, text = 0, entries = 0;
  const chargeEntries = (count: number) => { entries += count; if (entries > LEGACY_LIMITS.entries) fail(); };
  const chargeText = (s: string) => { text += s.length * 2; if (text > LEGACY_LIMITS.text) fail(); return s; };
  const bytes = async (item: Blob | ArrayBuffer) => {
    binary += item instanceof Blob ? item.size : item.byteLength;
    if (binary > LEGACY_LIMITS.bytes) fail();
    return toBase64(new Uint8Array(item instanceof Blob ? await item.arrayBuffer() : item));
  };
  const encode = async (item: unknown, depth: number): Promise<Atom> => {
    if (depth > LEGACY_LIMITS.depth) fail();
    if (item === undefined) return { tag: 'undefined' };
    if (item === null || typeof item === 'boolean') return item;
    if (typeof item === 'string') return chargeText(item);
    if (typeof item === 'number') return Number.isFinite(item) && !Object.is(item, -0) ? item : { tag: 'number', value: String(Object.is(item, -0) ? '-0' : item) };
    if (typeof item === 'bigint') return { tag: 'bigint', value: chargeText(String(item)) };
    if (typeof item !== 'object') fail();
    const prior = seen.get(item); if (prior !== undefined) return { tag: 'ref', id: prior };
    if (nodes.length >= LEGACY_LIMITS.nodes) fail();
    const id = nodes.length; seen.set(item, id); const node: Node = { id, type: '' }; nodes.push(node);
    if (Array.isArray(item) || Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null) {
      if (Object.getOwnPropertySymbols(item).length) fail();
      node.type = Array.isArray(item) ? 'Array' : 'Object';
      if (Array.isArray(item)) { node.length = integer(item.length, LEGACY_LIMITS.arrayLength); chargeEntries(item.length); }
      else node.nullPrototype = Object.getPrototypeOf(item) === null;
      const entries: [string, Atom][] = [];
      for (const key of Object.keys(item)) {
        chargeEntries(1);
        const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
        if (!('value' in descriptor)) fail();
        entries.push([chargeText(key), await encode(descriptor.value, depth + 1)]);
      }
      node.entries = entries;
    } else if (item instanceof Map) {
      ownBuiltin(item); node.type = 'Map'; const entries: [Atom, Atom][] = [];
      for (const [key, value] of item) { chargeEntries(2); entries.push([await encode(key, depth + 1), await encode(value, depth + 1)]); }
      node.entries = entries;
    } else if (item instanceof Set) {
      ownBuiltin(item); node.type = 'Set'; const values: Atom[] = [];
      for (const value of item) { chargeEntries(1); values.push(await encode(value, depth + 1)); } node.values = values;
    } else if (item instanceof Date) { ownBuiltin(item); node.type = 'Date'; node.value = await encode(item.getTime(), depth + 1);
    } else if (item instanceof RegExp) { ownBuiltin(item); if (item.lastIndex !== 0) fail(); node.type = 'RegExp'; node.source = chargeText(item.source); node.flags = item.flags;
    } else if (typeof File !== 'undefined' && item instanceof File) {
      ownBuiltin(item); node.type = 'File'; node.name = chargeText(item.name); node.lastModified = item.lastModified; node.mime = chargeText(item.type); node.bytes = await bytes(item);
    } else if (item instanceof Blob) { ownBuiltin(item); node.type = 'Blob'; node.mime = chargeText(item.type); node.bytes = await bytes(item);
    } else if (item instanceof ArrayBuffer) {
      ownBuiltin(item); if ((item as ArrayBuffer & { resizable?: boolean }).resizable) fail();
      node.type = 'ArrayBuffer'; node.bytes = await bytes(item);
    } else if (ArrayBuffer.isView(item)) {
      const name = Object.getPrototypeOf(item)?.constructor?.name;
      if (!(item instanceof DataView) && (!Object.hasOwn(views, name) || Object.getPrototypeOf(item) !== views[name as keyof typeof views].prototype)) fail();
      // IndexedDB has already performed structured cloning; reject extra properties if called directly.
      if (Object.getOwnPropertySymbols(item).length || Object.keys(item).some(key => !/^(0|[1-9][0-9]*)$/.test(key))) fail();
      node.type = 'View'; node.kind = item instanceof DataView ? 'DataView' : name;
      node.buffer = await encode(item.buffer, depth + 1); node.offset = item.byteOffset; node.length = item.byteLength;
    } else fail();
    return { tag: 'ref', id };
  };
  return { encoding: LEGACY_GRAPH_FORMAT, root: await encode(value, 0), nodes };
}

/** Decode a data-only JSON graph. Never resolve class names from globalThis. */
function decodeGraph(input: unknown): unknown {
  const graph = shape(input, ['encoding', 'root', 'nodes']);
  if (graph.encoding !== LEGACY_GRAPH_FORMAT) fail();
  const nodes = list(graph.nodes); if (nodes.length > LEGACY_LIMITS.nodes) fail();
  const decoded: unknown[] = new Array(nodes.length);
  let binary = 0, text = 0, entries = 0;
  const chargeEntries = (count: number) => { entries += count; if (entries > LEGACY_LIMITS.entries) fail(); };
  const textValue = (v: unknown) => { const s = string(v); text += s.length * 2; if (text > LEGACY_LIMITS.text) fail(); return s; };
  const atom = (value: unknown): unknown => {
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'string') return textValue(value);
    if (typeof value === 'number') { if (!Number.isFinite(value) || Object.is(value, -0)) fail(); return value; }
    const token = object(value);
    if (token.tag === 'undefined') { shape(token, ['tag']); return undefined; }
    if (token.tag === 'ref') { shape(token, ['tag', 'id']); const id = integer(token.id, nodes.length - 1); if (!(id in decoded)) fail(); return decoded[id]; }
    shape(token, ['tag', 'value']);
    if (token.tag === 'number') {
      const values: Record<string, number> = { '-0': -0, NaN, Infinity, '-Infinity': -Infinity };
      if (typeof token.value !== 'string' || !Object.hasOwn(values, token.value)) fail(); return values[token.value];
    }
    if (token.tag === 'bigint') { const s = textValue(token.value); if (!/^(?:0|-?[1-9][0-9]*)$/.test(s)) fail(); return BigInt(s); }
    fail();
  };
  // All references are ordinal IDs. Allocate shells first to support forward/cyclic refs.
  for (let id = 0; id < nodes.length; id++) {
    const node = object(nodes[id]); if (integer(node.id) !== id) fail();
    switch (node.type) {
      case 'Object': shape(node, ['id', 'type', 'nullPrototype', 'entries']); if (typeof node.nullPrototype !== 'boolean') fail(); decoded[id] = node.nullPrototype ? Object.create(null) : {}; break;
      case 'Array': shape(node, ['id', 'type', 'length', 'entries']); chargeEntries(integer(node.length, LEGACY_LIMITS.arrayLength)); decoded[id] = new Array(node.length as number); break;
      case 'Map': shape(node, ['id', 'type', 'entries']); decoded[id] = new Map(); break;
      case 'Set': shape(node, ['id', 'type', 'values']); decoded[id] = new Set(); break;
      case 'Date': { shape(node, ['id', 'type', 'value']); const value = atom(node.value); if (typeof value !== 'number' || (!Number.isFinite(value) && !Number.isNaN(value))) fail(); const date = new Date(value); if (!Object.is(date.getTime(), value)) fail(); decoded[id] = date; break; }
      case 'RegExp': { shape(node, ['id', 'type', 'source', 'flags']); const source = textValue(node.source), flags = textValue(node.flags); const expression = new RegExp(source, flags); if (expression.source !== source || expression.flags !== flags) fail(); decoded[id] = expression; break; }
      case 'ArrayBuffer': case 'Blob': case 'File': {
        shape(node, node.type === 'ArrayBuffer' ? ['id', 'type', 'bytes'] : node.type === 'Blob' ? ['id', 'type', 'bytes', 'mime'] : ['id', 'type', 'bytes', 'mime', 'name', 'lastModified']);
        const bytes = fromBase64(node.bytes); binary += bytes.byteLength; if (binary > LEGACY_LIMITS.bytes) fail();
        if (node.type === 'ArrayBuffer') decoded[id] = bytes.buffer;
        else { const mime = textValue(node.mime); const blob = new Blob([bytes], { type: mime }); if (blob.type !== mime) fail();
          if (node.type === 'Blob') decoded[id] = blob;
          else { if (typeof File === 'undefined' || typeof node.lastModified !== 'number' || !Number.isSafeInteger(node.lastModified)) fail(); const name = textValue(node.name); decoded[id] = new File([bytes], name, { type: mime, lastModified: node.lastModified }); }
        } break;
      }
      case 'View': shape(node, ['id', 'type', 'kind', 'buffer', 'offset', 'length']); break;
      default: fail();
    }
  }
  // Views depend exclusively on an ArrayBuffer shell, never on arbitrary constructors.
  for (let id = 0; id < nodes.length; id++) {
    const node = object(nodes[id]); if (node.type !== 'View') continue;
    const ref = shape(node.buffer, ['tag', 'id']);
    if (ref.tag !== 'ref') fail(); const bufferId = integer(ref.id, nodes.length - 1);
    if (object(nodes[bufferId]).type !== 'ArrayBuffer') fail();
    const buffer = decoded[bufferId] as ArrayBuffer, offset = integer(node.offset), length = integer(node.length);
    if (offset + length > buffer.byteLength) fail();
    if (node.kind === 'DataView') decoded[id] = new DataView(buffer, offset, length);
    else { if (typeof node.kind !== 'string' || !Object.hasOwn(views, node.kind)) fail(); const Type = views[node.kind as keyof typeof views];
      if (offset % Type.BYTES_PER_ELEMENT || length % Type.BYTES_PER_ELEMENT) fail(); decoded[id] = new Type(buffer, offset, length / Type.BYTES_PER_ELEMENT);
    }
  }
  for (let id = 0; id < nodes.length; id++) {
    const node = object(nodes[id]);
    if (node.type === 'Object' || node.type === 'Array' || node.type === 'Map') {
      const used = new Set<unknown>();
      for (const raw of list(node.entries)) {
        chargeEntries(node.type === 'Map' ? 2 : 1);
        const pair = list(raw); if (pair.length !== 2) fail();
        const key = node.type === 'Map' ? atom(pair[0]) : textValue(pair[0]); if (used.has(key)) fail(); used.add(key);
        if (node.type === 'Map') (decoded[id] as Map<unknown, unknown>).set(key, atom(pair[1]));
        else { if (node.type === 'Array' && (key === 'length' || (/^(0|[1-9][0-9]*)$/.test(key as string) && Number(key) < 4294967295 && Number(key) >= (node.length as number)))) fail();
          Object.defineProperty(decoded[id], key as string, { value: atom(pair[1]), enumerable: true, writable: true, configurable: true });
        }
      }
    } else if (node.type === 'Set') {
      const result = decoded[id] as Set<unknown>;
      for (const value of list(node.values)) { chargeEntries(1); const item = atom(value); if (result.has(item)) fail(); result.add(item); }
    }
  }
  // Enforce the same bounded DFS as the encoder, without recursive JS calls.
  // Revisited references stop traversal (cycles are supported), but their edge
  // still consumes depth. Unreachable nodes are rejected rather than discarded.
  const seen = new Set<number>(), pending: { value: unknown; depth: number }[] = [{ value: graph.root, depth: 0 }];
  while (pending.length) {
    const { value, depth } = pending.pop()!; if (depth > LEGACY_LIMITS.depth) fail();
    if (!value || typeof value !== 'object') continue;
    const token = object(value); if (token.tag !== 'ref') continue;
    const id = integer(token.id, nodes.length - 1); if (seen.has(id)) continue; seen.add(id);
    const node = object(nodes[id]); let children: unknown[] = [];
    if (node.type === 'Object' || node.type === 'Array') children = list(node.entries).map(pair => list(pair)[1]);
    else if (node.type === 'Map') children = list(node.entries).flatMap(pair => list(pair));
    else if (node.type === 'Set') children = list(node.values);
    else if (node.type === 'View') children = [node.buffer];
    else if (node.type === 'Date') children = [node.value];
    for (let i = children.length - 1; i >= 0; i--) pending.push({ value: children[i], depth: depth + 1 });
  }
  if (seen.size !== nodes.length) fail();
  return atom(graph.root);
}

export function decodeLegacyGraph(input: unknown): unknown {
  try { return decodeGraph(input); } catch { throw failure(); }
}

export async function verifiedLegacyGraph(value: unknown): Promise<LegacyGraph> {
  try {
    const encoded = await encodeLegacyGraph(value);
    const serialized = JSON.stringify(encoded);
    if (serialized.length * 2 > 128 * 1024 * 1024) fail();
    const parsed: unknown = JSON.parse(serialized);
    if (JSON.stringify(await encodeLegacyGraph(decodeLegacyGraph(parsed))) !== serialized) fail();
    return encoded;
  } catch { throw failure(); }
}
