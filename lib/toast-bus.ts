export type ToastVariant = 'default' | 'success' | 'error' | 'info' | 'warning';

export interface ToastMsg {
  id: string;
  title: string;
  description?: string;
  variant?: ToastVariant;
  duration?: number;
}

type Listener = (t: ToastMsg) => void;

const listeners = new Set<Listener>();

export const toastBus = {
  subscribe(fn: Listener) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  emit(t: Omit<ToastMsg, 'id'>) {
    const msg: ToastMsg = {
      ...t,
      id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    };
    listeners.forEach((l) => l(msg));
  },
};

export function toast(t: Omit<ToastMsg, 'id'>): void {
  toastBus.emit(t);
}
