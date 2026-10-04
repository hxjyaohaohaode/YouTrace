import type { ToastItem, ToastType } from '../components/ui/Toast';

type Listener = (toasts: ToastItem[]) => void;

let items: ToastItem[] = [];
const listeners = new Set<Listener>();
let seq = 0;

const MAX_VISIBLE = 4;

function emit() {
  for (const listener of listeners) {
    listener(items);
  }
}

function push(type: ToastType, message: string) {
  seq += 1;
  const item: ToastItem = { id: `t-${seq}`, type, message };
  items = [...items.slice(-(MAX_VISIBLE - 1)), item];
  emit();
}

export function subscribeToToasts(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getToastSnapshot(): ToastItem[] {
  return items;
}

export const toast = {
  success: (message: string) => push('success', message),
  error: (message: string) => push('error', message),
  warning: (message: string) => push('warning', message),
  info: (message: string) => push('info', message),
};

export function dismissToast(id: string) {
  items = items.filter((item) => item.id !== id);
  emit();
}

/** A previous page's success is not a status for the next page's unsaved draft. */
export function dismissTransientToasts() {
  const remaining = items.filter(item => item.type === 'error' || item.type === 'warning');
  if (remaining.length !== items.length) { items = remaining; emit(); }
}
