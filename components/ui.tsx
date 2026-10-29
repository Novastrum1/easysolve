"use client";
import {
ArrowUpRight,
ChevronDown,
Inbox,
LoaderCircle,
Search,
X,
} from "lucide-react";
import { cloneElement,isValidElement,useEffect,useId,useRef } from "react";
export const label = (s: string) =>
  s.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
export function Badge({ status }: { status: string }) {
  return (
    <span
      className={`badge ${["connection_verified", "completed", "done", "connected", "approved", "ready", "applied", "success", "published"].includes(status) ? "green" : ["failed", "blocked", "needs_attention", "failure", "changes_requested"].includes(status) ? "red" : ["running", "in_progress", "queued", "awaiting_review", "pending"].includes(status) ? "amber" : ""}`}
    >
      <span />
      {label(status)}
    </span>
  );
}
export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Inbox size={24} />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Button({
  children,
  busy,
  variant = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  busy?: boolean;
  variant?: string;
}) {
  return (
    <button
      {...props}
      disabled={busy || props.disabled}
      className={`button ${variant} ${props.className ?? ""}`}
    >
      {busy && <LoaderCircle className="spin" size={15} />}
      {children}
    </button>
  );
}
export function Field({
  label: caption,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  const fieldId = useId();
  return (
    <label className="field">
      <span id={fieldId}>{caption}</span>
      {isValidElement(children)
        ? cloneElement(
            children as React.ReactElement<Record<string, unknown>>,
            {
              "aria-labelledby": fieldId,
              "aria-describedby": hint ? fieldId + "-hint" : undefined,
            },
          )
        : children}
      {hint && <small id={fieldId + "-hint"}>{hint}</small>}
    </label>
  );
}
export function Panel({
  title,
  description,
  children,
  action,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h3>{title}</h3>
          {description && <p>{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          title="Close"
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function SearchBox({
  value,
  onChange,
  placeholder = "Search…",
}: {
  value: string;
  onChange: (s: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="search-input">
      <Search size={16} />
      <input
        aria-label={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}
export function External({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="external">
      {children}
      <ArrowUpRight size={14} />
    </a>
  );
}
export function Select({
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="select-wrap">
      <select {...props}>{children}</select>
      <ChevronDown size={14} />
    </span>
  );
}
export async function request(path: string, body?: unknown, method?: string) {
  const r = await fetch(`/api/${path}`, {
    method: method ?? (body ? "POST" : "GET"),
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "Request failed");
  return data;
}
export function Diff({ value }: { value: string }) {
  return (
    <div className="diff" tabIndex={0} aria-label="Code diff">
      {value.split("\n").map((line, i) => (
        <div
          key={i}
          className={
            line.startsWith("+")
              ? "added"
              : line.startsWith("-")
                ? "removed"
                : line.startsWith("@@") || line.startsWith("diff ")
                  ? "diff-header"
                  : ""
          }
        >
          <span>{i + 1}</span>
          <code>{line || " "}</code>
        </div>
      ))}
    </div>
  );
}
