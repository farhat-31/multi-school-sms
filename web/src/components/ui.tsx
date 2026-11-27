import { useState, type FormEvent, type ReactNode } from "react";
import type { Row } from "../data";
import { Icon, type IconName } from "./icons";
import { downloadCsv } from "./feedback";

export function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(v).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export const money = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
export const todayISO = () => new Date().toISOString().slice(0, 10);

/* ----------------------------- layout ----------------------------- */

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function Card({ title, subtitle, children, actions }: { title: string; subtitle?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="card">
      <header>
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}

export type Tone = "primary" | "ok" | "bad" | "warn" | "info";

export function Stat({ label, value, hint, icon, tone = "primary" }: { label: string; value: ReactNode; hint?: ReactNode; icon: IconName; tone?: Tone }) {
  return (
    <div className="stat">
      <div className={`stat-icon tone-${tone}`}>
        <Icon name={icon} size={22} />
      </div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        {hint && <small>{hint}</small>}
      </div>
    </div>
  );
}

export function Empty({ icon = "inbox", title, children }: { icon?: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={36} />
      <strong>{title}</strong>
      {children && <div>{children}</div>}
    </div>
  );
}

export function Pill({ tone, children }: { tone?: string; children: ReactNode }) {
  return <span className={`pill ${tone ?? ""}`}>{children}</span>;
}

const AVATAR_COLORS = ["#6366f1", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#0ea5e9", "#ef4444", "#14b8a6"];
export function Avatar({ name }: { name: string }) {
  const initials = name.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
  const color = AVATAR_COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length];
  return (
    <span className="avatar" style={{ background: color }}>
      {initials}
    </span>
  );
}

export function Person({ name, sub }: { name: string; sub?: ReactNode }) {
  return (
    <div className="person">
      <Avatar name={name} />
      <div>
        <strong>{name}</strong>
        {sub && <small>{sub}</small>}
      </div>
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder = "Search…" }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="search">
      <Icon name="search" size={16} />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </div>
  );
}

export function Progress({ value }: { value: number }) {
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <div style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (t: T) => void }) {
  return (
    <nav className="tabs">
      {tabs.map((t) => (
        <button key={t.id} className={t.id === value ? "active" : ""} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </nav>
  );
}

/* ----------------------------- table ----------------------------- */

export interface Column {
  key: string;
  label: string;
  render?: (r: Row) => ReactNode;
  /** Plain value for CSV export (defaults to the raw field). */
  csv?: (r: Row) => string | number;
}

export function DataTable({
  rows,
  columns,
  loading,
  error,
  empty = "No records yet.",
  exportAs,
}: {
  rows: Row[];
  columns: Column[];
  loading?: boolean;
  error?: string | null;
  empty?: string;
  /** Show an "Export CSV" button; value is the file name. */
  exportAs?: string;
}) {
  if (error) return <p className="alert bad">{error}</p>;
  if (loading && !rows.length)
    return (
      <div className="stack" style={{ gap: 8 }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton" style={{ height: 38 }} />
        ))}
      </div>
    );
  if (!rows.length) return <Empty title={empty} />;
  const exportCols = columns.filter((c) => c.label);
  return (
    <>
    {exportAs && (
      <div className="row no-print" style={{ justifyContent: "flex-end", marginBottom: 8 }}>
        <span className="muted small-print">{rows.length} rows</span>
        <button
          className="secondary small"
          onClick={() =>
            downloadCsv(
              exportAs,
              exportCols.map((c) => c.label),
              rows.map((r) => exportCols.map((c) => (c.csv ? c.csv(r) : fmt(r[c.key]).replace(/^—$/, "")))),
            )
          }
        >
          <Icon name="download" size={14} /> Export CSV
        </button>
        <button className="secondary small" onClick={() => window.print()}>
          Print
        </button>
      </div>
    )}
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              {columns.map((c) => (
                <td key={c.key}>{c.render ? c.render(r) : fmt(r[c.key])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}

/* ----------------------------- form ----------------------------- */

export interface Field {
  name: string;
  label: string;
  type?: "text" | "email" | "password" | "number" | "date" | "time" | "textarea" | "select";
  options?: { value: string; label: string }[];
  required?: boolean;
  multiple?: boolean;
  placeholder?: string;
  defaultValue?: string;
}

/** Collects values by field name, calls onSubmit, shows success / error. */
export function SimpleForm({
  fields,
  submitLabel,
  onSubmit,
  columns = 1,
}: {
  fields: Field[];
  submitLabel: string;
  onSubmit: (values: Record<string, string | string[]>) => Promise<string | void>;
  columns?: 1 | 2;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const values: Record<string, string | string[]> = {};
    for (const f of fields) values[f.name] = f.multiple ? (fd.getAll(f.name) as string[]) : String(fd.get(f.name) ?? "").trim();
    setBusy(true);
    setMsg(null);
    try {
      const text = await onSubmit(values);
      setMsg({ ok: true, text: text || "Saved." });
      form.reset();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message.replace("Firebase: ", "") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <div style={columns === 2 ? { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 } : { display: "contents" }}>
        {fields.map((f) => (
          <label key={f.name} style={f.type === "textarea" || f.multiple ? { gridColumn: "1 / -1" } : undefined}>
            <span>
              {f.label}
              {f.required && <span className="error"> *</span>}
            </span>
            {f.type === "textarea" ? (
              <textarea name={f.name} required={f.required} rows={3} placeholder={f.placeholder} defaultValue={f.defaultValue} />
            ) : f.type === "select" ? (
              <select name={f.name} required={f.required} multiple={f.multiple} defaultValue={f.defaultValue}>
                {!f.multiple && <option value="">Select…</option>}
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                name={f.name}
                type={f.type ?? "text"}
                required={f.required}
                placeholder={f.placeholder}
                defaultValue={f.defaultValue}
                step={f.type === "number" ? "any" : undefined}
              />
            )}
          </label>
        ))}
      </div>
      <div className="row">
        <button type="submit" disabled={busy}>
          {busy ? "Working…" : submitLabel}
        </button>
      </div>
      {msg && <p className={`alert ${msg.ok ? "ok" : "bad"}`}>{msg.text}</p>}
    </form>
  );
}

/* ----------------------------- charts (SVG) ----------------------------- */

/** Vertical bar chart. Values 0..max. */
export function BarChart({
  data,
  max,
  height = 180,
  format = (v) => String(v),
  color = "url(#barGrad)",
}: {
  data: { label: string; value: number }[];
  max?: number;
  height?: number;
  format?: (v: number) => string;
  color?: string;
}) {
  if (!data.length) return <Empty icon="chart" title="No data yet" />;
  const top = max ?? Math.max(1, ...data.map((d) => d.value));
  const w = 100 / data.length;
  return (
    <svg viewBox={`0 0 100 ${height / 3}`} width="100%" height={height} preserveAspectRatio="none" role="img" aria-label="Bar chart">
      <defs>
        <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--primary)" />
          <stop offset="100%" stopColor="var(--primary-2)" />
        </linearGradient>
      </defs>
      {data.map((d, i) => {
        const h = ((height / 3 - 8) * d.value) / top;
        return (
          <g key={i}>
            <title>{`${d.label}: ${format(d.value)}`}</title>
            <rect x={i * w + w * 0.18} y={height / 3 - 6 - h} width={w * 0.64} height={Math.max(h, 0.4)} rx={0.8} fill={color} />
          </g>
        );
      })}
    </svg>
  );
}

export function BarLabels({ labels }: { labels: string[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${labels.length}, 1fr)`, fontSize: "0.68rem", color: "var(--muted)", textAlign: "center" }}>
      {labels.map((l, i) => (
        <span key={i} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {l}
        </span>
      ))}
    </div>
  );
}

/** Donut with legend. */
export function Donut({ segments, center }: { segments: { label: string; value: number; color: string }[]; center?: ReactNode }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const r = 15.915;
  let offset = 25;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
      <div style={{ position: "relative", width: 150, height: 150 }}>
        <svg viewBox="0 0 42 42" width="150" height="150" role="img" aria-label="Donut chart">
          <circle cx="21" cy="21" r={r} fill="none" stroke="var(--bg-2)" strokeWidth="5" />
          {total > 0 &&
            segments.map((s, i) => {
              const pct = (s.value / total) * 100;
              const el = (
                <circle key={i} cx="21" cy="21" r={r} fill="none" stroke={s.color} strokeWidth="5" strokeDasharray={`${pct} ${100 - pct}`} strokeDashoffset={offset}>
                  <title>{`${s.label}: ${s.value}`}</title>
                </circle>
              );
              offset -= pct;
              return el;
            })}
        </svg>
        {center && <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center", fontWeight: 800 }}>{center}</div>}
      </div>
      <div className="chart-legend" style={{ flexDirection: "column", gap: 8 }}>
        {segments.map((s) => (
          <span key={s.label}>
            <i style={{ background: s.color }} />
            {s.label}: <strong style={{ color: "var(--text)" }}>{s.value.toLocaleString()}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}
