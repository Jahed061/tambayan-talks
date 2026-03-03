import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { cn } from './primitives/cn';

type ToastKind = 'success' | 'error' | 'info';

export type ToastItem = {
  id: string;
  kind: ToastKind;
  title?: string;
  message: string;
  timeoutMs?: number;
};

type ToastApi = {
  push: (toast: Omit<ToastItem, 'id'>) => void;
  success: (message: string, title?: string) => void;
  error: (message: string, title?: string) => void;
  info: (message: string, title?: string) => void;
};

const Ctx = createContext<ToastApi | null>(null);

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((t: Omit<ToastItem, 'id'>) => {
    const id = uid();
    const item: ToastItem = { id, timeoutMs: 3200, ...t };
    setItems((prev) => [item, ...prev].slice(0, 4));
    window.setTimeout(() => remove(id), item.timeoutMs);
  }, [remove]);

  const api: ToastApi = useMemo(() => ({
    push,
    success: (message, title) => push({ kind: 'success', message, title }),
    error: (message, title) => push({ kind: 'error', message, title }),
    info: (message, title) => push({ kind: 'info', message, title }),
  }), [push]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="tt-toast-viewport" role="region" aria-label="Notifications">
        {items.map((t) => (
          <div
            key={t.id}
            className={cn('tt-toast', `tt-toast-${t.kind}`)}
            role="status"
            aria-live="polite"
            onClick={() => remove(t.id)}
          >
            {t.title ? <div className="tt-toast-title">{t.title}</div> : null}
            <div className="tt-toast-msg">{t.message}</div>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
