import { useAuth, useSession } from "../auth";
import { useDocs, type Row } from "../data";
import { useWorkspace } from "../context";
import { navigate } from "../router";
import { Icon } from "../components/icons";
import { BarChart, BarLabels, Card, DataTable, Donut, Empty, PageHeader, Pill, Progress, Stat, fmt, money, todayISO } from "../components/ui";

/** The student whose records are shown: the student themself, or the parent's selected child. */
function useStudent() {
  const { selectedRole } = useAuth();
  const session = useSession();
  // A family login opened as "Student" behaves like the student (wording), with the parent's access.
  const role = session.role === "parent" && selectedRole === "student" ? "student" : session.role;
  const { schoolId, studentId, children, studentClassId } = useWorkspace();
  const classes = useDocs(schoolId, "classes");
  const child = children.find((c) => c.id === studentId);
  const { user } = useSession();
  const name = session.role === "parent" ? fmt(child?.displayName) : user.displayName ?? "You";
  const className = fmt(classes.rows.find((c) => c.id === studentClassId)?.name ?? studentClassId);
  const filter: Record<string, string> = studentId ? { studentId } : {};
  return { role, schoolId, studentId, name, className, filter, enabled: !!studentId };
}

const pct = (r: Row) => (Number(r.maxMarks) ? (Number(r.marks) / Number(r.maxMarks)) * 100 : 0);

export function MyOverview() {
  const s = useStudent();
  const attendance = useDocs(s.schoolId, "attendance", s.filter, s.enabled);
  const exams = useDocs(s.schoolId, "exams", s.filter, s.enabled);
  const fees = useDocs(s.schoolId, "fees", s.filter, s.enabled);
  const homework = useDocs(s.schoolId, "homework");
  const { studentClassId } = useWorkspace();
  if (!s.studentId) return <Empty icon="student" title="No child linked to your account yet" />;

  const present = attendance.rows.filter((a) => a.status !== "absent").length;
  const rate = attendance.rows.length ? Math.round((present / attendance.rows.length) * 100) : null;
  const avg = exams.rows.length ? Math.round(exams.rows.reduce((a, r) => a + pct(r), 0) / exams.rows.length) : null;
  const due = fees.rows.filter((f) => f.status !== "paid").reduce((a, f) => a + Number(f.amount ?? 0), 0);
  const upcoming = homework.rows.filter((h) => h.classId === studentClassId && String(h.dueDate) >= todayISO()).sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
  const recent = [...exams.rows].sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(-8);

  return (
    <>
      <PageHeader title={s.role === "parent" ? `${s.name}'s progress` : `Hi, ${s.name.split(" ")[0]} 👋`} subtitle={`Class ${s.className}`} />
      <div className="stats">
        <Stat label="Attendance" value={rate === null ? "—" : `${rate}%`} hint={`${attendance.rows.length} days recorded`} icon="check" tone={rate !== null && rate < 75 ? "bad" : "ok"} />
        <Stat label="Average score" value={avg === null ? "—" : `${avg}%`} hint={`${exams.rows.length} results`} icon="award" />
        <Stat label="Fees due" value={money(due)} hint={`${fees.rows.filter((f) => f.status !== "paid").length} unpaid`} icon="money" tone={due ? "warn" : "ok"} />
        <Stat label="Homework due" value={upcoming.length} icon="book" tone="info" />
      </div>
      <div className="grid-2">
        <Card title="Recent results" actions={<button className="link" onClick={() => navigate("results")}>All results</button>}>
          {recent.length ? (
            <>
              <BarChart data={recent.map((r) => ({ label: String(r.subject ?? r.name), value: Math.round(pct(r)) }))} max={100} format={(v) => `${v}%`} />
              <BarLabels labels={recent.map((r) => String(r.subject ?? r.name))} />
            </>
          ) : (
            <Empty icon="award" title="No results yet" />
          )}
        </Card>
        <Card title="Homework due" actions={<button className="link" onClick={() => navigate("homework")}>All homework</button>}>
          {upcoming.length ? (
            <ul className="list">
              {upcoming.slice(0, 5).map((h) => (
                <li key={h.id}>
                  <div>
                    <strong>{fmt(h.title)}</strong> <Pill tone="primary">{fmt(h.subject)}</Pill>
                    <p style={{ margin: "2px 0 0" }} className="muted">
                      Due {fmt(h.dueDate)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon="book" title="Nothing due 🎉" />
          )}
        </Card>
      </div>
    </>
  );
}

export function MyAttendance() {
  const s = useStudent();
  const attendance = useDocs(s.schoolId, "attendance", s.filter, s.enabled);
  const rows = [...attendance.rows].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const count = (st: string) => rows.filter((r) => r.status === st).length;
  return (
    <>
      <PageHeader title="Attendance" subtitle={s.name} />
      <div className="stats">
        <Stat label="Present" value={count("present")} icon="check" tone="ok" />
        <Stat label="Late" value={count("late")} icon="clock" tone="warn" />
        <Stat label="Absent" value={count("absent")} icon="user" tone="bad" />
      </div>
      <div className="grid-2">
        <Card title="Daily record">
          <DataTable
            rows={rows}
            loading={attendance.loading}
            error={attendance.error}
            empty="No attendance recorded yet."
            columns={[
              { key: "date", label: "Date", render: (r) => new Date(String(r.date)).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) },
              { key: "status", label: "Status", render: (r) => <Pill tone={String(r.status)}>{fmt(r.status)}</Pill> },
            ]}
          />
        </Card>
        <Card title="Summary">
          <Donut
            center={<span>{rows.length ? `${Math.round(((count("present") + count("late")) / rows.length) * 100)}%` : "—"}</span>}
            segments={[
              { label: "Present", value: count("present"), color: "#10b981" },
              { label: "Late", value: count("late"), color: "#f59e0b" },
              { label: "Absent", value: count("absent"), color: "#ef4444" },
            ]}
          />
        </Card>
      </div>
    </>
  );
}

export function MyResults() {
  const s = useStudent();
  const { school } = useWorkspace();
  const exams = useDocs(s.schoolId, "exams", s.filter, s.enabled);
  const rows = [...exams.rows].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const subjects = [...new Set(rows.map((r) => String(r.subject ?? "")))].filter(Boolean);
  const bySubject = subjects.map((sub) => {
    const rs = rows.filter((r) => r.subject === sub);
    return { label: sub, value: Math.round(rs.reduce((a, r) => a + pct(r), 0) / rs.length) };
  });
  const overall = rows.length ? Math.round(rows.reduce((a, r) => a + pct(r), 0) / rows.length) : null;
  const grade = (p: number) => (p >= 90 ? "A+" : p >= 80 ? "A" : p >= 70 ? "B" : p >= 60 ? "C" : p >= 50 ? "D" : p >= 40 ? "E" : "F");
  return (
    <>
      <PageHeader
        title="Results"
        subtitle={s.name}
        actions={
          rows.length > 0 && (
            <button className="no-print" onClick={() => window.print()}>
              <Icon name="download" /> Print report card
            </button>
          )
        }
      />
      <div className="print-only" style={{ marginBottom: 16 }}>
        <h1>{fmt(school?.name)} — Report card</h1>
        <p>
          Student: <strong>{s.name}</strong> · Class: <strong>{s.className}</strong> · Printed {new Date().toLocaleDateString()}
        </p>
        <p>
          Overall average: <strong>{overall === null ? "—" : `${overall}% (${grade(overall)})`}</strong>
        </p>
      </div>
      <div className="stats">
        <Stat label="Overall average" value={overall === null ? "—" : `${overall}%`} icon="award" />
        <Stat label="Grade" value={overall === null ? "—" : grade(overall)} icon="chart" tone="ok" />
        <Stat label="Subjects" value={subjects.length} icon="book" tone="info" />
      </div>
      <div className="grid-2">
        <Card title="All results">
          <DataTable
            rows={rows}
            loading={exams.loading}
            error={exams.error}
            empty="No results yet."
            columns={[
              { key: "name", label: "Exam" },
              { key: "subject", label: "Subject" },
              {
                key: "marks",
                label: "Score",
                render: (r) => (
                  <div style={{ minWidth: 120 }}>
                    <strong>
                      {fmt(r.marks)}/{fmt(r.maxMarks)}
                    </strong>{" "}
                    <span className="muted">({Math.round(pct(r))}%)</span>
                    <Progress value={pct(r)} />
                  </div>
                ),
              },
              { key: "grade", label: "Grade", render: (r) => <Pill tone="primary">{grade(pct(r))}</Pill> },
              { key: "date", label: "Date" },
            ]}
          />
        </Card>
        <Card title="Average by subject">
          <BarChart data={bySubject} max={100} format={(v) => `${v}%`} />
          <BarLabels labels={bySubject.map((b) => b.label)} />
        </Card>
      </div>
    </>
  );
}

export function MyFees() {
  const s = useStudent();
  const fees = useDocs(s.schoolId, "fees", s.filter, s.enabled);
  const rows = [...fees.rows].sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
  const sum = (rs: Row[]) => rs.reduce((a, f) => a + Number(f.amount ?? 0), 0);
  const unpaid = rows.filter((f) => f.status !== "paid");
  return (
    <>
      <PageHeader title="Fees" subtitle={s.name} />
      <div className="stats">
        <Stat label="Total billed" value={money(sum(rows))} icon="money" />
        <Stat label="Paid" value={money(sum(rows.filter((f) => f.status === "paid")))} icon="check" tone="ok" />
        <Stat label="Outstanding" value={money(sum(unpaid))} icon="clock" tone={unpaid.length ? "warn" : "ok"} />
      </div>
      <Card title="Invoices">
        <DataTable
          rows={rows}
          loading={fees.loading}
          error={fees.error}
          empty="No fees."
          columns={[
            { key: "title", label: "Item" },
            { key: "amount", label: "Amount", render: (r) => money(Number(r.amount)) },
            { key: "dueDate", label: "Due" },
            {
              key: "status",
              label: "Status",
              render: (r) =>
                r.status === "paid" ? <Pill tone="paid">paid</Pill> : String(r.dueDate) < todayISO() ? <Pill tone="bad">overdue</Pill> : <Pill tone="warn">unpaid</Pill>,
            },
          ]}
        />
      </Card>
    </>
  );
}
