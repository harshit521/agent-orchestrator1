import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cn } from "../../lib/cn";
import { Icon } from "./Icon";

type ToastVariant = "success" | "error" | "info";

interface ToastInput {
  title: string;
  description?: string | undefined;
  variant?: ToastVariant;
}

interface ToastItem extends ToastInput {
  id: number;
  variant: ToastVariant;
}

interface ToastContextValue {
  toast: (input: ToastInput) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const VARIANT_STYLES: Record<ToastVariant, string> = {
  success: "border-ok/30",
  error: "border-danger/30",
  info: "border-line-strong",
};

const VARIANT_DOT: Record<ToastVariant, string> = {
  success: "bg-ok",
  error: "bg-danger",
  info: "bg-accent",
};

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  const remove = useCallback((id: number) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    ({ title, description, variant = "info" }: ToastInput) => {
      const id = nextId;
      nextId += 1;
      setToasts((current) => [...current, { id, title, description, variant }]);

      const timer = setTimeout(() => {
        remove(id);
        timers.current.delete(timer);
      }, 4500);

      timers.current.add(timer);
    },
    [remove]
  );

  useEffect(() => {
    const active = timers.current;

    return () => {
      for (const timer of active) {
        clearTimeout(timer);
      }
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-full max-w-xs flex-col gap-2"
      >
        {toasts.map((item) => (
          <div
            key={item.id}
            className={cn(
              "pointer-events-auto rounded-md border bg-surface px-3 py-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.12)]",
              VARIANT_STYLES[item.variant]
            )}
          >
            <div className="flex items-start gap-2">
              <span
                className={cn(
                  "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                  VARIANT_DOT[item.variant]
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-medium text-fg">{item.title}</p>
                {item.description ? (
                  <p className="mt-0.5 text-[11px] leading-4 text-muted">
                    {item.description}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                aria-label="Dismiss notification"
                onClick={() => remove(item.id)}
                className="rounded p-0.5 text-muted hover:text-fg"
              >
                <Icon name="close" className="h-3 w-3" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);

  if (!context) {
    throw new Error("useToast must be used inside ToastProvider");
  }

  return context;
}
