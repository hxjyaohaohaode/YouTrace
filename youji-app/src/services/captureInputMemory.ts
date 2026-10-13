import type { CaptureContext } from './parser';

/** Current document only. An ownership token prevents an older queue from
 * releasing newer unsaved input; this is not durable storage or a cross-tab lock. */
export interface CaptureInputMemoryToken { readonly kind: 'capture-input-memory' }
interface RetainedInput { owner: string | null; text: string; context: CaptureContext; token: CaptureInputMemoryToken }
let retained: RetainedInput | null = null;
let revision = 0;
export function readCaptureInputMemory(owner: string | null): Omit<RetainedInput, 'token'> | null {
  return retained?.owner === owner ? { owner, text: retained.text, context: structuredClone(retained.context) } : null;
}
export function captureInputMemoryRevision(): number { return revision; }
export function retainCaptureInputMemory(owner: string | null, text: string, context: CaptureContext): CaptureInputMemoryToken {
  const token: CaptureInputMemoryToken = Object.freeze({ kind: 'capture-input-memory' });
  retained = { owner, text, context: structuredClone(context), token }; revision++; return token;
}
export function releaseCaptureInputMemory(token: CaptureInputMemoryToken): void {
  if (retained?.token === token) { retained = null; revision++; }
}
