import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";

import { cn } from "../../lib/cn";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { InlineError } from "./States";

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: "sm" | "md" | "lg";
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open || !mounted) {
    return null;
  }

  const widths = {
    sm: "max-w-sm",
    md: "max-w-lg",
    lg: "max-w-2xl",
  } as const;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/35 p-4 pt-[8vh] sm:p-6 sm:pt-[10vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "w-full rounded-lg border border-line bg-surface shadow-[0_16px_48px_rgba(0,0,0,0.18)]",
          widths[width]
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-4 py-3.5">
          <div className="min-w-0">
            <h2 className="text-[13px] font-semibold tracking-tight text-fg">
              {title}
            </h2>
            {description ? (
              <p className="mt-0.5 text-xs leading-5 text-muted">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="-mr-1 rounded p-1 text-muted transition-colors hover:bg-subtle hover:text-fg"
          >
            <Icon name="close" className="h-4 w-4" />
          </button>
        </header>

        <div className="max-h-[65vh] overflow-y-auto px-4 py-4">{children}</div>

        {footer ? (
          <footer className="flex items-center justify-end gap-2 border-t border-line bg-subtle/40 px-4 py-3">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>,
    document.body
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  busy = false,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  busy?: boolean;
  error?: string | undefined;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      width="sm"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            loading={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {error ? (
        <div className="mb-3">
          <InlineError message={error} />
        </div>
      ) : null}
      <p className="text-[13px] leading-6 text-muted">{description}</p>
    </Dialog>
  );
}
