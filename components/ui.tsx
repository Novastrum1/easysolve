"use client";
import {
  ArrowUpRight,
  ChevronDown,
  Inbox,
  LoaderCircle,
  Search,
  X,
} from "lucide-react";
import { cloneElement, isValidElement, useEffect, useId, useRef } from "react";
export const label = (s: string) =>
  s.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
export function Badge({ status }: { status: string }) {
  return (
    <span
      className={`badge ${["verified", "connection_verified", "completed", "done", "connected", "approved", "ready", "applied", "success", "published"].includes(status) ? "green" : ["underpaid", "overpaid", "unmatched", "failed_verification", "expired", "connection_failed", "failed", "blocked", "needs_attention", "failure", "changes_requested"].includes(status) ? "red" : ["running", "in_progress", "queued", "awaiting_review", "pending"].includes(status) ? "amber" : ""}`}
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
  error,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  error?: string;
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
              "aria-invalid": error ? true : undefined,
              "aria-describedby":
                [hint && fieldId + "-hint", error && fieldId + "-error"]
                  .filter(Boolean)
                  .join(" ") || undefined,
            },
          )
        : children}
      {hint && <small id={fieldId + "-hint"}>{hint}</small>}
      {error && (
        <small id={fieldId + "-error"} role="alert">
          {error}
        </small>
      )}
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
  const titleId = useId();
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-head">
        <h2 id={titleId}>{title}</h2>
        <button
          className="icon-button"
          type="button"
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
export class RequestError extends Error {
  constructor(
    message: string,
    public fieldErrors?: Record<string, string>,
    public status = 0,
  ) {
    super(message);
  }
}
export async function request(
  path: string,
  body?: unknown,
  method?: string,
  onText?: (text: string) => void,
  signal?: AbortSignal,
) {
  let r: Response;
  try {
    r = await fetch(`/api/${path}`, {
      method: method ?? (body ? "POST" : "GET"),
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(onText ? { Accept: "application/x-ndjson" } : {}),
      },
      signal,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new RequestError(
      "Unable to connect. Check your connection and try again.",
    );
  }
  if (
    r.ok &&
    onText &&
    r.headers.get("content-type")?.includes("application/x-ndjson")
  ) {
    const reader = r.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "",
      completed: any;
    const consume = (line: string) => {
      if (!line.trim()) return;
      const event = JSON.parse(line);
      if (!event || typeof event !== "object")
        throw new RequestError(
          "Chat returned an invalid stream event. Retry this message.",
        );
      if (event.type === "error")
        throw new RequestError(
          typeof event.error === "string"
            ? event.error
            : "Chat failed. Retry this message.",
        );
      if (event.type === "text") {
        if (typeof event.text !== "string")
          throw new RequestError(
            "Chat returned invalid text. Retry this message.",
          );
        if (event.text) onText(event.text);
      } else if (event.type === "complete") {
        const message = event.message;
        if (
          !message ||
          typeof message.id !== "string" ||
          message.role !== "assistant" ||
          typeof message.conversation !== "string" ||
          typeof message.content !== "string" ||
          typeof message.createdAt !== "string" ||
          !Array.isArray(message.activity) ||
          !message.activity.every(
            (activity: unknown) =>
              activity !== null &&
              typeof activity === "object" &&
              typeof (activity as { label?: unknown }).label === "string",
          )
        ) {
          throw new RequestError(
            "Chat returned an invalid saved message. Retry this message.",
          );
        }
        completed = message;
      } else
        throw new RequestError(
          "Chat returned an unsupported stream event. Retry this message.",
        );
    };
    try {
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          consume(line);
        }
        if (done) break;
      }
      consume(buffer);
      if (!completed)
        throw new RequestError("Chat stream interrupted. Retry this message.");
      return completed;
    } catch (error) {
      if (error instanceof RequestError) throw error;
      const failure = new RequestError(
        signal?.aborted
          ? "Response stopped. Retry this message."
          : "Chat stream interrupted. Retry this message.",
      );
      failure.cause = error;
      throw failure;
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  let data;
  try {
    data = await r.json();
  } catch {
    throw new RequestError(
      "The server could not complete the request. Please try again.",
      undefined,
      r.status,
    );
  }
  if (!r.ok)
    throw new RequestError(
      data?.error || "Request failed. Please try again.",
      data?.fieldErrors,
      r.status,
    );
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
