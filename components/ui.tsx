"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CheckIcon, CloseIcon, CopyIcon } from "./icons";

/* -------------------------------------------------------------------------- */
/* Button                                                                     */
/* -------------------------------------------------------------------------- */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-accent-contrast hover:bg-accent-hover disabled:hover:bg-accent border border-transparent",
  secondary:
    "bg-surface-card text-text-primary border border-border-strong hover:bg-surface-2 disabled:hover:bg-surface-card",
  ghost:
    "bg-transparent text-text-secondary border border-transparent hover:bg-surface-2 hover:text-text-primary",
  danger:
    "bg-danger text-accent-contrast hover:brightness-95 disabled:hover:brightness-100 border border-transparent",
};

export function Button({
  variant = "secondary",
  className = "",
  type = "button",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45 ${BUTTON_STYLES[variant]} ${className}`}
      {...props}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Copy-to-clipboard button                                                   */
/* -------------------------------------------------------------------------- */

export function CopyButton({
  text,
  label,
  copiedLabel = "Copied",
  variant = "secondary",
  className = "",
}: {
  text: string;
  /** ReactNode so callers can swap the wording responsively. */
  label: ReactNode;
  copiedLabel?: ReactNode;
  variant?: ButtonVariant;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return; // clipboard blocked (insecure context / denied) — stay silent, no false "Copied"
    }
    setCopied(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setCopied(false), 1600);
  }

  return (
    <Button variant={variant} onClick={handleCopy} className={`px-2.5! py-1.5! ${className}`}>
      {copied ? (
        <CheckIcon className="size-3.5 text-accent" />
      ) : (
        <CopyIcon className="size-3.5 text-text-muted" />
      )}
      <span className="text-xs">{copied ? copiedLabel : label}</span>
    </Button>
  );
}

/* -------------------------------------------------------------------------- */
/* Dialog — centered modal on desktop, sheet on mobile                        */
/* -------------------------------------------------------------------------- */

export function Dialog({
  open,
  onClose,
  title,
  subtitle,
  footer,
  children,
  variant = "sheet",
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  /** "sheet" slides up from the bottom on mobile; "fullscreen" covers it. */
  variant?: "sheet" | "fullscreen";
  labelledBy: string;
}) {
  const handleClose = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") handleClose();
    }

    // Lock the page behind the dialog so the *dialog* scrolls, never the page.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, handleClose]);

  if (!open) return null;

  const panelPosition =
    variant === "fullscreen"
      ? "h-full w-full rounded-none sm:h-auto sm:max-h-[85vh] sm:w-full sm:max-w-lg sm:rounded-2xl"
      : "max-h-[85vh] w-full rounded-t-2xl sm:max-h-[78vh] sm:max-w-2xl sm:rounded-2xl";

  return (
    <div
      className={`fixed inset-0 z-50 flex justify-center bg-[#2b2521]/40 ${
        variant === "fullscreen" ? "items-stretch sm:items-center" : "items-end sm:items-center"
      } sm:p-6`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) handleClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={`animate-sheet flex flex-col overflow-hidden border border-border bg-surface-card ${panelPosition}`}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 id={labelledBy} className="font-serif text-xl text-text-primary">
              {title}
            </h2>
            {subtitle && <p className="mt-0.5 text-xs text-text-secondary">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className="grid size-8 shrink-0 place-items-center rounded-lg border border-border text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
          >
            <CloseIcon className="size-4" />
          </button>
        </header>

        <div className="scroll-region min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer && (
          <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-3.5">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
