import { useMemo } from "react";
import { useSession } from "../auth";
import { useDocs } from "../data";
import { useCaps, useWorkspace } from "../context";
import { navigate } from "../router";
import { Icon, type IconName } from "../components/icons";
import { BarChart, BarLabels, Card, Donut, Empty, PageHeader, Pill, Stat, fmt, money, todayISO } from "../components/ui";

function QuickAction({ icon, label, to }: { icon: IconName; label: string; to: string }) {
  return (
    <button className="secondary" style={{ justifyContent: "flex-start", width: "100%" }} onClick={() => navigate(to)}>
      <Icon name={icon} /> {label}
    </button>
  );
}

/** School dashboard for School Admin / Teacher / Super Admin (selected school). */
export function SchoolOverview() {
  const { user } = useSession();
  const { schoolId, school } = useWorkspace();
  const caps = useCaps();
  const students = useDocs(schoolId, "students");
  const teachers = useDocs(schoolId, "teachers");
  // Families (= parents) derived from the student profiles this user can see.
  const familyCount = new Set(students.rows.map((s) => s.parentUid).filter(Boolean)).size;
  const classes = useDocs(schoolId, "classes");
  const attendance = useDocs(schoolId, "attendance");
  const announcements = useDocs(schoolId, "announcements");
  const homework = useDocs(schoolId, "homework");
  const fees = useDocs(schoolId, "fees", {}, caps.fees);

  const today = attendance.rows.filter((a) => a.date === todayISO());
  const rate = today.length ? Math.round((today.filter((a) => a.status !== "absent").length / today.length) * 100) : null;
  const trend = useMemo(() => {
    const out: { label: string; value: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const iso = d.toISOString().slice(0, 10);
      const recs = attendance.rows.filter((a) => a.date === iso);
      out.push({ label: d.toLocaleDateString(undefined, { weekday: "short" }), value: recs.length ? Math.round((recs.filter((r) => r.status !== "absent").length / recs.length) * 100) : 0 });
    }
    return out;
  }, [attendance.rows]);
  const perClass = classes.rows.map((c) => ({ label: fmt(c.name), value: students.rows.filter((s) => s.classId === c.id).length }));
  const sum = (rs: typeof fees.rows) => rs.reduce((a, f) => a + Number(f.amount ?? 0), 0);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <>
      <PageHeader
        title={`${greeting}, ${(user.displayName ?? "").split(" ")[0] || "there"} 👋`}
        subtitle={`${fmt(school?.name)} · ${new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}`}
      />
      <div className="stats">
        <Stat label="Students" value={students.rows.length} icon="student" />
        <Stat label="Teachers" value={teachers.rows.length} icon="teacher" tone="ok" />
        <Stat label="Families" value={familyCount} hint="parent + student share a login" icon="parent" tone="info" />
        <Stat label="Classes" value={classes.rows.length} icon="layers" tone="warn" />
        <Stat label="Attendance today" value={rate === null ? "—" : `${rate}%`} hint={`${today.length} marked`} icon="check" tone={rate !== null && rate < 75 ? "bad" : "ok"} />
      </div>
      <div className="grid-2">
        <div className="stack">
          <Card title="Attendance · last 7 days" subtitle="Share of students present or late">
            <BarChart data={trend} max={100} format={(v) => `${v}%`} />
            <BarLabels labels={trend.map((t) => t.label)} />
          </Card>
          <Card title="Students per class">
            {perClass.length ? (
              <>
                <BarChart data={perClass} height={150} />
                <BarLabels labels={perClass.map((p) => p.label)} />
              </>
            ) : (
              <Empty icon="layers" title="No classes yet" />
            )}
          </Card>
        </div>
        <div className="stack">
          <Card title="Quick actions">
            <div className="stack" style={{ gap: 8 }}>
              {(caps.addStudents || caps.addTeachers) && <QuickAction icon="upload" label="Add people" to="add-people" />}
              {caps.attendance && <QuickAction icon="check" label="Mark attendance" to="attendance" />}
              {caps.exams && <QuickAction icon="award" label="Record exam results" to="exams" />}
              {caps.homework && <QuickAction icon="book" label="Post homework" to="homework" />}
              {caps.announce && <QuickAction icon="megaphone" label="New announcement" to="announcements" />}
              {caps.fees && <QuickAction icon="money" label="Manage fees" to="fees" />}
            </div>
          </Card>
          {caps.fees && (
            <Card title="Fees">
              <Donut
                center={<span style={{ fontSize: "0.85rem" }}>{money(sum(fees.rows))}</span>}
                segments={[
                  { label: "Collected", value: sum(fees.rows.filter((f) => f.status === "paid")), color: "#10b981" },
                  { label: "Outstanding", value: sum(fees.rows.filter((f) => f.status !== "paid")), color: "#f59e0b" },
                ]}
              />
            </Card>
          )}
          <Card title="Latest announcements" actions={<button className="link" onClick={() => navigate("announcements")}>View all</button>}>
            {announcements.rows.length ? (
              <ul className="list">
                {[...announcements.rows]
                  .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")))
                  .slice(0, 4)
                  .map((a) => (
                    <li key={a.id}>
                      <div>
                        <strong>{fmt(a.title)}</strong> <Pill tone="info">{fmt(a.audience)}</Pill>
                        <p style={{ margin: "2px 0 0" }} className="muted">
                          {fmt(a.createdAt)}
                        </p>
                      </div>
                    </li>
                  ))}
              </ul>
            ) : (
              <Empty icon="megaphone" title="Nothing posted yet" />
            )}
          </Card>
          <Card title="Homework due soon">
            {homework.rows.filter((h) => String(h.dueDate) >= todayISO()).length ? (
              <ul className="list">
                {homework.rows
                  .filter((h) => String(h.dueDate) >= todayISO())
                  .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))
                  .slice(0, 4)
                  .map((h) => (
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
              <Empty icon="book" title="Nothing due" />
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
