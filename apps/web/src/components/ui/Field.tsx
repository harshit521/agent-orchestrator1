import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

import { cn } from "../../lib/cn";

const CONTROL =
  "w-full rounded-md border border-line bg-surface px-2.5 text-[13px] text-fg placeholder:text-muted/70 transition-colors hover:border-line-strong focus:border-accent focus:ring-2 focus:ring-accent/15 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60";

export function FormField({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  hint?: string | undefined;
  error?: string | undefined;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label
        htmlFor={htmlFor}
        className="block text-xs font-medium text-fg"
      >
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-[11px] text-danger">{error}</p>
      ) : hint ? (
        <p className="text-[11px] text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(CONTROL, "h-9", className)} {...props} />;
}

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(CONTROL, "min-h-24 py-2 leading-relaxed", className)}
      {...props}
    />
  );
}

export function Select({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(CONTROL, "h-9 pr-8", className)} {...props}>
      {children}
    </select>
  );
}

export function Checkbox({
  label,
  description,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  description?: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5 transition-colors hover:border-line-strong",
        className
      )}
    >
      <input
        type="checkbox"
        className="mt-0.5 h-3.5 w-3.5 rounded border-line accent-[var(--accent)]"
        {...props}
      />
      <span className="min-w-0">
        <span className="block text-xs font-medium text-fg">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-[11px] leading-4 text-muted">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  );
}
