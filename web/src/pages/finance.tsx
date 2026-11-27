import { useState } from "react";
import { useSession } from "../auth";
import { addSchoolDoc, deleteSchoolDoc, updateSchoolDoc, useDocs } from "../data";
import { useCaps, useWorkspace } from "../context";
import { Icon } from "../components/icons";
import { useConfirm, useToast } from "../components/feedback";
import { Card, DataTable, Donut, Empty, PageHeader, Pill, SearchBox, SimpleForm, Stat, fmt, money, todayISO } from "../components/ui";

/* ============================ Fees (School Admin with 'fees') ============================ */
export function FeesPage() {
  const { schoolId } = useWorkspace();
  const confirm = useConfirm();
  const toast = useToast();
  const students = useDocs(schoolId, "students");
  const fees = useDocs(schoolId, "fees");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const studentName = (id: unknown) => fmt(students.rows.find((s) => s.id === id)?.displayName ?? id);

  const paid = fees.rows.filter((f) => f.status === "paid");
  const unpaid = fees.rows.filter((f) => f.status !== "paid");
  const overdue = unpaid.filter((f) => String(f.dueDate) < todayISO());
  const sum = (rs: typeof fees.rows) => rs.reduce((a, f) => a + Number(f.amount ?? 0), 0);
  const list = fees.rows
    .filter((f) => !status || (status === "overdue" ? f.status !== "paid" && String(f.dueDate) < todayISO() : f.status === status))
    .filter((f) => !q || `${studentName(f.studentId)} ${f.title}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));

  return (
    <>
      <PageHeader title="Fees" subtitle="Billing and collection" />
      <div className="stats">
        <Stat label="Collected" value={money(sum(paid))} hint={`${paid.length} payments`} icon="money" tone="ok" />
        <Stat label="Outstanding" value={money(sum(unpaid))} hint={`${unpaid.length} invoices`} icon="clock" tone="warn" />
        <Stat label="Overdue" value={money(sum(overdue))} hint={`${overdue.length} invoices`} icon="lock" tone="bad" />
        <Stat
          label="Collection rate"
          value={fees.rows.length ? `${Math.round((sum(paid) / Math.max(1, sum(fees.rows))) * 100)}%` : "—"}
          icon="chart"
        />
      </div>
      <div className="grid">
        <Card title="Create invoice">
          <SimpleForm
            submitLabel="Add fee"
            columns={2}
            fields={[
              { name: "studentId", label: "Student", type: "select", required: true, options: students.rows.map((s) => ({ value: s.id, label: fmt(s.displayName) })) },
              { name: "title", label: "Item", required: true, placeholder: "Term 1 tuition" },
              { name: "amount", label: "Amount", type: "number", required: true },
              { name: "dueDate", label: "Due date", type: "date", required: true },
            ]}
            onSubmit={async (v) => {
              if (Number(v.amount) <= 0) throw new Error("Amount must be greater than 0.");
              await addSchoolDoc(schoolId!, "fees", { ...v, amount: Number(v.amount), status: "unpaid" });
              await fees.reload();
              return "Invoice created.";
            }}
          />
        </Card>
        <Card title="Collection">
          <Donut
            center={<span style={{ fontSize: "0.9rem" }}>{money(sum(fees.rows))}</span>}
            segments={[
              { label: "Paid", value: sum(paid), color: "#10b981" },
              { label: "Due", value: sum(unpaid) - sum(overdue), color: "#f59e0b" },
              { label: "Overdue", value: sum(overdue), color: "#ef4444" },
            ]}
          />
        </Card>
      </div>
      <div style={{ marginTop: 18 }}>
        <Card title="Invoices">
          <div className="toolbar">
            <SearchBox value={q} onChange={setQ} placeholder="Search student or item…" />
            <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
              <option value="">All</option>
              <option value="paid">Paid</option>
              <option value="unpaid">Unpaid</option>
              <option value="overdue">Overdue</option>
            </select>
          </div>
          <DataTable
            rows={list}
            loading={fees.loading}
            error={fees.error}
            exportAs="fees"
            empty="No invoices."
            columns={[
              { key: "studentId", label: "Student", render: (r) => studentName(r.studentId), csv: (r) => studentName(r.studentId) },
              { key: "title", label: "Item" },
              { key: "amount", label: "Amount", render: (r) => money(Number(r.amount)) },
              { key: "dueDate", label: "Due" },
              {
                key: "status",
                label: "Status",
                render: (r) =>
                  r.status === "paid" ? (
                    <Pill tone="paid">paid</Pill>
                  ) : String(r.dueDate) < todayISO() ? (
                    <Pill tone="bad">overdue</Pill>
                  ) : (
                    <Pill tone="warn">unpaid</Pill>
                  ),
              },
              {
                key: "actions",
                label: "",
                render: (r) => (
                  <div className="row">
                    {r.status !== "paid" && (
                      <button
                        className="small"
                        onClick={async () => {
                          await updateSchoolDoc(schoolId!, "fees", r.id, { status: "paid", paidAt: new Date().toISOString() });
                          await fees.reload();
                          toast(`Payment recorded for ${studentName(r.studentId)}`);
                        }}
                      >
                        Mark paid
                      </button>
                    )}
                    <button
                      className="small danger"
                      aria-label="Delete invoice"
                      onClick={async () => {
                        const ok = await confirm({ title: "Delete this invoice?", message: `${fmt(r.title)} · ${money(Number(r.amount))} for ${studentName(r.studentId)}`, confirmLabel: "Delete", danger: true });
                        if (!ok) return;
                        await deleteSchoolDoc(schoolId!, "fees", r.id);
                        await fees.reload();
                        toast("Invoice deleted");
                      }}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                ),
              },
            ]}
          />
        </Card>
      </div>
    </>
  );
}

/* ============================ Announcements ============================ */
export function AnnouncementsPage() {
  const { user, role } = useSession();
  const { schoolId } = useWorkspace();
  const caps = useCaps();
  const { rows, loading, error, reload } = useDocs(schoolId, "announcements");
  const [audience, setAudience] = useState("");

  const visible = rows
    .filter((a) => caps.isStaff || a.audience === "all" || a.audience === role)
    .filter((a) => !audience || a.audience === audience)
    .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));

  return (
    <>
      <PageHeader title="Announcements" subtitle="News and notices for the school" />
      <div className={caps.announce ? "grid-2" : ""}>
        <Card
          title="Feed"
          actions={
            caps.isStaff && (
              <select value={audience} onChange={(e) => setAudience(e.target.value)} aria-label="Audience">
                <option value="">All audiences</option>
                <option value="all">Everyone</option>
                <option value="teacher">Teachers</option>
                <option value="student">Students</option>
                <option value="parent">Parents</option>
              </select>
            )
          }
        >
          {error && <p className="alert bad">{error}</p>}
          {loading && !rows.length && <p className="muted">Loading…</p>}
          {!loading && !visible.length && <Empty icon="megaphone" title="No announcements yet" />}
          <ul className="list">
            {visible.map((a) => (
              <li key={a.id}>
                <div className="stat-icon tone-info" style={{ width: 40, height: 40 }}>
                  <Icon name="megaphone" />
                </div>
                <div style={{ flex: 1 }}>
                  <div className="row">
                    <strong>{fmt(a.title)}</strong>
                    <Pill tone="info">{a.audience === "all" ? "Everyone" : `${fmt(a.audience)}s`}</Pill>
                  </div>
                  <p style={{ whiteSpace: "pre-wrap" }}>{fmt(a.body)}</p>
                  <small className="muted">
                    {fmt(a.authorName)} · {fmt(a.createdAt)}
                  </small>
                </div>
                {(caps.isAdmin || a.authorUid === user.uid) && caps.isStaff && (
                  <button
                    className="small danger"
                    aria-label="Delete announcement"
                    onClick={async () => {
                      await deleteSchoolDoc(schoolId!, "announcements", a.id);
                      await reload();
                    }}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Card>
        {caps.announce && (
          <Card title="New announcement">
            <SimpleForm
              submitLabel="Publish"
              fields={[
                { name: "title", label: "Title", required: true },
                { name: "body", label: "Message", type: "textarea", required: true },
                {
                  name: "audience",
                  label: "Audience",
                  type: "select",
                  required: true,
                  defaultValue: "all",
                  options: [
                    { value: "all", label: "Everyone" },
                    { value: "teacher", label: "Teachers" },
                    { value: "student", label: "Students" },
                    { value: "parent", label: "Parents" },
                  ],
                },
              ]}
              onSubmit={async (v) => {
                await addSchoolDoc(schoolId!, "announcements", { ...v, authorUid: user.uid, authorName: user.displayName ?? user.email });
                await reload();
                return "Published.";
              }}
            />
          </Card>
        )}
      </div>
    </>
  );
}
