/** Document-lifetime fallback for failed local writes. Never synced or logged. */
export interface EditorMemoryScope { database: object; owner: string | null; session: string | null; epoch: unknown; key: string }
interface PendingValue { scope: EditorMemoryScope; token: number; value: unknown }
const pending = new Map<string, PendingValue>();
let sequence = 0;
const sameScope = (a: EditorMemoryScope, b: EditorMemoryScope) => a.database === b.database && a.owner === b.owner && a.session === b.session && a.epoch === b.epoch;
export function retainPendingEditor<T>(scope: EditorMemoryScope, value: T): number { const token = ++sequence; pending.set(`${scope.owner}:${scope.key}`, { scope: { ...scope }, token, value: structuredClone(value) }); return token; }
export function readPendingEditor<T>(scope: EditorMemoryScope): T | null {
  const key = `${scope.owner}:${scope.key}`, entry = pending.get(key);
  if (!entry) return null;
  if (!sameScope(entry.scope, scope)) { pending.delete(key); return null; }
  return structuredClone(entry.value) as T;
}
export function releasePendingEditor(scope: EditorMemoryScope, token: number): void { const key = `${scope.owner}:${scope.key}`, entry = pending.get(key); if (entry && entry.token === token && sameScope(entry.scope, scope)) pending.delete(key); }
