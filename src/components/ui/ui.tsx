import React from "react";
import { Loader2, Inbox, AlertTriangle } from "lucide-react";

export const Card: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className = "", ...props }) => (
  <div
    className={`rounded-2xl border shadow-sm ${className}`}
    style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}
    {...props}
  />
);

export const Button: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" }
> = ({ variant = "secondary", className = "", disabled, ...props }) => {
  const variants: Record<string, string> = {
    primary: "text-white shadow-sm disabled:opacity-60",
    secondary: "",
    danger: "text-white shadow-sm disabled:opacity-60",
    ghost: "",
  };
  const styleByVariant: Record<string, React.CSSProperties> = {
    primary: { background: "var(--accent)" },
    secondary: { background: "var(--bg-hover)", color: "var(--text-primary)", border: "1px solid var(--border)" },
    danger: { background: "#e11d48" },
    ghost: { color: "var(--text-secondary)" },
  };
  return (
    <button
      className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition inline-flex items-center gap-1.5 justify-center disabled:cursor-not-allowed ${variants[variant]} ${className}`}
      style={styleByVariant[variant]}
      disabled={disabled}
      {...props}
    />
  );
};

export const Badge: React.FC<{ tone?: "neutral" | "success" | "warning" | "danger" | "info"; children: React.ReactNode }> = ({
  tone = "neutral",
  children,
}) => {
  const tones: Record<string, string> = {
    neutral: "bg-slate-500/10 text-slate-500 border-slate-500/30",
    success: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30",
    warning: "bg-amber-500/10 text-amber-500 border-amber-500/30",
    danger: "bg-rose-500/10 text-rose-500 border-rose-500/30",
    info: "bg-indigo-500/10 text-indigo-500 border-indigo-500/30",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wide ${tones[tone]}`}>
      {children}
    </span>
  );
};

export const Input: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = ({ className = "", ...props }) => (
  <input
    className={`w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 ${className}`}
    style={{ background: "var(--bg-app)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
    {...props}
  />
);

export const Select: React.FC<React.SelectHTMLAttributes<HTMLSelectElement>> = ({ className = "", children, ...props }) => (
  <select
    className={`px-3 py-2 rounded-lg text-sm focus:outline-none ${className}`}
    style={{ background: "var(--bg-app)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
    {...props}
  >
    {children}
  </select>
);

export const Spinner: React.FC<{ className?: string }> = ({ className = "w-5 h-5" }) => (
  <Loader2 className={`animate-spin ${className}`} style={{ color: "var(--accent)" }} />
);

export const LoadingState: React.FC<{ label?: string }> = ({ label = "Loading…" }) => (
  <div className="flex items-center justify-center gap-2 py-16 text-sm" style={{ color: "var(--text-muted)" }}>
    <Spinner className="w-4 h-4" />
    {label}
  </div>
);

export const EmptyState: React.FC<{ title: string; description?: string }> = ({ title, description }) => (
  <div className="flex flex-col items-center justify-center gap-2 py-16 text-center px-4">
    <Inbox className="w-8 h-8" style={{ color: "var(--text-muted)" }} />
    <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
      {title}
    </p>
    {description && (
      <p className="text-xs max-w-sm" style={{ color: "var(--text-muted)" }}>
        {description}
      </p>
    )}
  </div>
);

export const ErrorState: React.FC<{ message: string }> = ({ message }) => (
  <div className="flex flex-col items-center justify-center gap-2 py-16 text-center px-4">
    <AlertTriangle className="w-8 h-8 text-rose-500" />
    <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
      Something went wrong
    </p>
    <p className="text-xs max-w-sm" style={{ color: "var(--text-muted)" }}>
      {message}
    </p>
  </div>
);

export const TableSkeleton: React.FC<{ rows?: number; cols?: number }> = ({ rows = 5, cols = 4 }) => (
  <div className="p-4 space-y-3">
    {Array.from({ length: rows }).map((_, r) => (
      <div key={r} className="flex gap-3">
        {Array.from({ length: cols }).map((_, c) => (
          <div key={c} className="h-4 rounded animate-pulse flex-1" style={{ background: "var(--bg-hover)" }} />
        ))}
      </div>
    ))}
  </div>
);

export const Pagination: React.FC<{ page: number; totalPages: number; onChange: (page: number) => void }> = ({
  page,
  totalPages,
  onChange,
}) => {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t text-xs" style={{ borderColor: "var(--border)" }}>
      <span style={{ color: "var(--text-muted)" }}>
        Page {page} of {totalPages}
      </span>
      <div className="flex gap-2">
        <Button variant="secondary" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          Previous
        </Button>
        <Button variant="secondary" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
};

export const Modal: React.FC<{ open: boolean; onClose: () => void; title: string; children: React.ReactNode }> = ({
  open,
  onClose,
  title,
  children,
}) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(2,6,23,0.6)" }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className="w-full max-w-lg rounded-2xl shadow-2xl p-6 space-y-4"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
      >
        <div className="flex items-center justify-between pb-3 border-b" style={{ borderColor: "var(--border)" }}>
          <h3 id="modal-title" className="text-base font-bold" style={{ color: "var(--text-primary)" }}>
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="text-lg leading-none"
            style={{ color: "var(--text-muted)" }}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};

export const ConfirmDialog: React.FC<{
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ open, title, message, confirmLabel = "Confirm", destructive, onConfirm, onCancel }) => (
  <Modal open={open} onClose={onCancel} title={title}>
    <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
      {message}
    </p>
    <div className="pt-3 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
      <Button variant="secondary" onClick={onCancel}>
        Cancel
      </Button>
      <Button variant={destructive ? "danger" : "primary"} onClick={onConfirm}>
        {confirmLabel}
      </Button>
    </div>
  </Modal>
);

/** Like ConfirmDialog, but collects a required free-text reason inside the same modal (Phase 10 — termination/cancellation/void/reversal actions all require one). */
export const ReasonConfirmDialog: React.FC<{
  open: boolean;
  title: string;
  message: string;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  confirmLabel?: string;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}> = ({ open, title, message, reasonLabel = "Reason", reasonPlaceholder, confirmLabel = "Confirm", onConfirm, onCancel }) => {
  const [reason, setReason] = React.useState("");

  React.useEffect(() => {
    if (open) setReason("");
  }, [open]);

  return (
    <Modal open={open} onClose={onCancel} title={title}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm(reason);
        }}
        className="space-y-3"
      >
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          {message}
        </p>
        <Field label={reasonLabel}>
          <Input required value={reason} onChange={(e) => setReason(e.target.value)} placeholder={reasonPlaceholder} />
        </Field>
        <div className="pt-3 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" variant="danger">
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export const Field: React.FC<{ label: string; children: React.ReactNode; hint?: string }> = ({ label, children, hint }) => (
  <label className="block space-y-1">
    <span className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
      {label}
    </span>
    {children}
    {hint && (
      <span className="block text-[11px]" style={{ color: "var(--text-muted)" }}>
        {hint}
      </span>
    )}
  </label>
);
