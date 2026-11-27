import { Component, createContext, useCallback, useContext, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { Icon } from "./icons";

/* ============================ Toasts ============================ */
type ToastKind = "ok" | "bad" | "info";
interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}
const ToastContext = createContext<(text: string, kind?: ToastKind) => void>(() => undefined);
export const useToast = () => useContext(ToastContext);

/* ============================ Confirm dialog ============================ */
interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  /** If set, the user must type this exact text to enable the confirm button. */
  typeToConfirm?: string;
}
const ConfirmContext = createContext<(o: ConfirmOptions) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmContext);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dialog, setDialog] = useState<ConfirmOptions | null>(null);
  const [typed, setTyped] = useState("");
  const resolver = useRef<(v: boolean) => void>();

  const toast = useCallback((text: string, kind: ToastKind = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const confirm = useCallback((o: ConfirmOptions) => {
    setTyped("");
    setDialog(o);
    return new Promise<boolean>((res) => (resolver.current = res));
  }, []);

  const close = (v: boolean) => {
    resolver.current?.(v);
    setDialog(null);
  };

  return (
    <ToastContext.Provider value={toast}>
      <ConfirmContext.Provider value={confirm}>
        {children}
        <div className="toasts" role="status" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast ${t.kind}`}>
              <Icon name={t.kind === "bad" ? "lock" : t.kind === "info" ? "megaphone" : "check"} size={16} />
              <span>{t.text}</span>
            </div>
          ))}
        </div>
        {dialog && (
          <div className="modal-backdrop" onClick={() => close(false)}>
            <div className="modal" role="dialog" aria-modal="true" aria-label={dialog.title} onClick={(e) => e.stopPropagation()}>
              <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
                <div className={`stat-icon ${dialog.danger ? "tone-bad" : "tone-primary"}`} style={{ width: 42, height: 42 }}>
                  <Icon name={dialog.danger ? "trash" : "check"} />
                </div>
                <div style={{ flex: 1 }}>
                  <h2>{dialog.title}</h2>
                  {dialog.message && <div className="muted" style={{ marginTop: 6 }}>{dialog.message}</div>}
                </div>
              </div>
              {dialog.typeToConfirm && (
                <label className="form" style={{ marginTop: 14 }}>
                  <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>
                    Type <code>{dialog.typeToConfirm}</code> to confirm
                  </span>
                  <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} />
                </label>
              )}
              <div className="row" style={{ justifyContent: "flex-end", marginTop: 20 }}>
                <button className="secondary" onClick={() => close(false)}>
                  Cancel
                </button>
                <button
                  className={dialog.danger ? "danger-solid" : ""}
                  disabled={!!dialog.typeToConfirm && typed.trim() !== dialog.typeToConfirm}
                  onClick={() => close(true)}
                  autoFocus={!dialog.typeToConfirm}
                >
                  {dialog.confirmLabel ?? "Confirm"}
                </button>
              </div>
            </div>
          </div>
        )}
      </ConfirmContext.Provider>
    </ToastContext.Provider>
  );
}

/* ============================ Error boundary ============================ */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("UI error:", error, info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card" style={{ maxWidth: 560, margin: "40px auto", textAlign: "center" }}>
        <div className="stat-icon tone-bad" style={{ margin: "0 auto 12px" }}>
          <Icon name="lock" />
        </div>
        <h2>Something went wrong on this page</h2>
        <p className="muted">{this.state.error.message}</p>
        <div className="row" style={{ justifyContent: "center" }}>
          <button onClick={() => this.setState({ error: null })}>Try again</button>
          <button className="secondary" onClick={() => location.reload()}>
            Reload app
          </button>
        </div>
      </div>
    );
  }
}

/* ============================ CSV export & print ============================ */
export function downloadCsv(filename: string, header: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = "﻿" + [header, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
