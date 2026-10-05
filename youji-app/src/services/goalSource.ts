import Dexie from 'dexie';

/** A full structured-clone comparison. JSON projection is never a source CAS.
 * Unsupported native types fail closed rather than quietly comparing as {}.
 * Sequential traversal also keeps reference IDs deterministic around Blob reads.
 */
async function encodeGoalSource(value: unknown): Promise<unknown> {
  const seen = new Map<object, number>();
  async function encode(item: unknown): Promise<unknown> {
    if (item === undefined) return ['undefined'];
    if (typeof item === 'bigint') return ['bigint', String(item)];
    if (typeof item === 'number') return ['number', Object.is(item, -0) ? '-0' : String(item)];
    if (item === null || typeof item !== 'object') return [typeof item, item];
    if (seen.has(item)) return ['ref', seen.get(item)];
    const id = seen.size; seen.set(item, id);
    if (item instanceof Date) return [id, 'Date', String(item.getTime())];
    if (item instanceof RegExp) return [id, 'RegExp', item.source, item.flags];
    if (typeof File !== 'undefined' && item instanceof File) return [id, 'File', item.name, item.lastModified, item.type, Array.from(new Uint8Array(await item.arrayBuffer()))];
    if (item instanceof Blob) return [id, 'Blob', item.type, Array.from(new Uint8Array(await item.arrayBuffer()))];
    if (item instanceof ArrayBuffer) {
      const shape = item as ArrayBuffer & { resizable?: boolean; maxByteLength?: number };
      return [id, 'ArrayBuffer', shape.resizable ?? false, shape.maxByteLength ?? item.byteLength, Array.from(new Uint8Array(item))];
    }
    if (ArrayBuffer.isView(item)) {
      // Length-tracking versus fixed-length views over a resizable buffer cannot
      // be inferred from their current visible bytes/offset. Keep them untouched
      // rather than claiming an exact comparison of that hidden native state.
      if ('resizable' in item.buffer && item.buffer.resizable) throw new Error('目标含尚不能安全比较的可伸缩视图，原稿保留，请先导出备份');
      return [id, item.constructor.name, await encode(item.buffer), item.byteOffset, item.byteLength];
    }
    if (item instanceof Map) {
      const entries = [];
      for (const [key, value] of item) entries.push([await encode(key), await encode(value)]);
      return [id, 'Map', entries];
    }
    if (item instanceof Set) {
      const entries = [];
      for (const value of item) entries.push(await encode(value));
      return [id, 'Set', entries];
    }
    if (typeof DOMException !== 'undefined' && item instanceof DOMException) return [id, 'DOMException', item.name, item.message, item.code];
    const entries = [];
    for (const key of Object.keys(item).sort()) entries.push([key, await encode((item as Record<string, unknown>)[key])]);
    if (item instanceof Error) return [id, 'Error', item.name, item.message, item.stack, await encode(item.cause), entries];
    if (Array.isArray(item)) return [id, 'Array', item.length, entries];
    if (Object.prototype.toString.call(item) !== '[object Object]') throw new Error('目标含尚不能安全比较的本机字段，原稿保留，请先导出备份');
    return [id, 'Object', entries];
  }
  return encode(value);
}

export async function sameGoalSource(left: unknown, right: unknown): Promise<boolean> {
  const [a, b] = await Dexie.waitFor(Promise.all([encodeGoalSource(left), encodeGoalSource(right)]));
  return JSON.stringify(a) === JSON.stringify(b);
}
