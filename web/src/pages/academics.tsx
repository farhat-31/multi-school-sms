import { useMemo, useState } from "react";
import { useSession } from "../auth";
import { addSchoolDoc, deleteSchoolDoc, setSchoolDoc, syncToReplica, useDocs, type Row } from "../data";
import { useCaps, useMyClasses, useWorkspace } from "../context";
import { Icon } from "../components/icons";
import { useConfirm, useToast } from "../components/feedback";
import { BarChart, BarLabels, Card, DataTable, Empty, PageHeader, Pill, Progress, SearchBox, SimpleForm, Stat, fmt, todayISO } from "../components/ui";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
type Status = "present" | "absent" | "late";

/** Classes this user may work with (teachers: only their assigned classes). */
function useClassName(_schoolId?: string) {
  const m = useMyClasses();
  return { classes: { rows: m.classes, reload: m.reload }, name: m.name };
}

/* ============================ Classes ============================ */
export function ClassesPage() {
  const { schoolId } = useWorkspace();
  const confirm = useConfirm();
  const toast = useToast();
  const caps = useCaps();
  const my = useMyClasses();
  const classes = { rows: my.classes, reload: my.reload };
  const students = useDocs(schoolId, "students");
  const teachers = useDocs(schoolId, "teachers");
  const teacherName = (id: unknown) => fmt(teachers.rows.find((t) => t.id === id)?.displayName ?? "—");

  return (
    <>
      <PageHeader
        title={caps.isTeacher ? "My classes" : "Classes"}
        subtitle={`${classes.rows.length} classes · ${students.rows.length} students${caps.isTeacher ? " · only your assigned classes are shown" : ""}`}
      />
      <div className={caps.classes ? "grid-2" : ""}>
        <Card title="All classes">
          {classes.rows.length === 0 ? (
            <Empty icon="layers" title={caps.isTeacher ? "No classes assigned to you yet" : "No classes yet"} />
          ) : (
            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
              {classes.rows.map((c) => {
                const n = students.rows.filter((s) => s.classId === c.id).length;
                return (
                  <div key={c.id} className="card" style={{ boxShadow: "none" }}>
                    <header>
                      <div>
                        <h2>{fmt(c.name)}</h2>
                        <p>
                          Grade {fmt(c.grade)} · Room {fmt(c.room)}
                        </p>
                      </div>
                      {caps.classes && (
                        <button
                          className="small danger"
                          aria-label={`Delete ${c.name}`}
                          onClick={async () => {
                            const ok = await confirm({ title: `Delete ${fmt(c.name)}?`, message: "Students stay enrolled but will show no class until reassigned.", confirmLabel: "Delete class", danger: true });
                            if (!ok) return;
                            await deleteSchoolDoc(schoolId!, "classes", c.id);
                            await classes.reload();
                            toast(`${fmt(c.name)} deleted`);
                          }}
                        >
                          <Icon name="trash" size={14} />
                        </button>
                      )}
                    </header>
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <span className="muted">Class teacher</span>
                      <strong>{teacherName(c.teacherId)}</strong>
                    </div>
                    <div className="row" style={{ justifyContent: "space-between", marginTop: 6 }}>
                      <span className="muted">Students</span>
                      <Pill tone="primary">{n}</Pill>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
        {caps.classes && (
          <Card title="New class">
            <SimpleForm
              submitLabel="Create class"
              fields={[
                { name: "name", label: "Name", required: true, placeholder: "Grade 5-A" },
                { name: "grade", label: "Grade", placeholder: "5" },
                { name: "room", label: "Room", placeholder: "B-12" },
                { name: "teacherId", label: "Class teacher", type: "select", options: teachers.rows.map((t) => ({ value: t.id, label: fmt(t.displayName) })) },
              ]}
              onSubmit={async (v) => {
                await addSchoolDoc(schoolId!, "classes", v);
                await classes.reload();
                return `Class ${v.name} created.`;
              }}
            />
          </Card>
        )}
      </div>
    </>
  );
}

/* ============================ Timetable ============================ */
export function TimetablePage() {
  const { schoolId, studentClassId } = useWorkspace();
  const caps = useCaps();
  const { classes, name } = useClassName(schoolId);
  const teachers = useDocs(schoolId, "teachers");
  const entries = useDocs(schoolId, "timetable");
  const [picked, setPicked] = useState("");
  const classId = caps.isFamily ? studentClassId ?? "" : picked || classes.rows[0]?.id || "";

  const mine = entries.rows.filter((e) => e.classId === classId);
  const slots = [...new Set(mine.map((e) => `${e.start}–${e.end}`))].sort();

  return (
    <>
      <PageHeader
        title="Timetable"
        subtitle={classId ? `Weekly schedule for ${name(classId)}` : "Weekly schedule per class"}
        actions={
          !caps.isFamily && (
            <select value={classId} onChange={(e) => setPicked(e.target.value)} aria-label="Class">
              {classes.rows.map((c) => (
                <option key={c.id} value={c.id}>
                  {fmt(c.name)}
                </option>
              ))}
            </select>
          )
        }
      />
      <div className={caps.classes ? "grid-2" : ""}>
        <Card title="Week view">
          {!classId ? (
            <Empty icon="clock" title={caps.isFamily ? "No class assigned yet" : "Create a class first"} />
          ) : !slots.length ? (
            <Empty icon="clock" title="No periods scheduled yet" />
          ) : (
            <div className="table-wrap">
              <table className="timetable">
                <thead>
                  <tr>
                    <th>Time</th>
                    {DAYS.map((d) => (
                      <th key={d}>{d.slice(0, 3)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {slots.map((slot) => (
                    <tr key={slot}>
                      <td>
                        <strong>{slot}</strong>
                      </td>
                      {DAYS.map((d) => (
                        <td key={d}>
                          {mine
                            .filter((e) => e.day === d && `${e.start}–${e.end}` === slot)
                            .map((e) => (
                              <div className="slot" key={e.id}>
                                <strong>{fmt(e.subject)}</strong>
                                {fmt(teachers.rows.find((t) => t.id === e.teacherId)?.displayName ?? "")}
                                {caps.classes && (
                                  <button
                                    className="ghost x"
                                    aria-label="Remove period"
                                    onClick={async () => {
                                      await deleteSchoolDoc(schoolId!, "timetable", e.id);
                                      await entries.reload();
                                    }}
                                  >
                                    <Icon name="trash" size={12} />
                                  </button>
                                )}
                              </div>
                            ))}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        {caps.classes && (
          <Card title="Add period">
            <SimpleForm
              submitLabel="Add to timetable"
              fields={[
                { name: "classId", label: "Class", type: "select", required: true, defaultValue: classId, options: classes.rows.map((c) => ({ value: c.id, label: fmt(c.name) })) },
                { name: "day", label: "Day", type: "select", required: true, options: DAYS.map((d) => ({ value: d, label: d })) },
                { name: "start", label: "Start", type: "time", required: true },
                { name: "end", label: "End", type: "time", required: true },
                { name: "subject", label: "Subject", required: true, placeholder: "Mathematics" },
                { name: "teacherId", label: "Teacher", type: "select", options: teachers.rows.map((t) => ({ value: t.id, label: fmt(t.displayName) })) },
              ]}
              onSubmit={async (v) => {
                if (String(v.end) <= String(v.start)) throw new Error("End time must be after start time.");
                await addSchoolDoc(schoolId!, "timetable", v);
                setPicked(String(v.classId));
                await entries.reload();
                return "Period added.";
              }}
            />
          </Card>
        )}
      </div>
    </>
  );
}

/* ============================ Attendance (staff) ============================ */
export function AttendancePage() {
  const { user } = useSession();
  const { schoolId } = useWorkspace();
  const caps = useCaps();
  const { classes, name } = useClassName(schoolId);
  const students = useDocs(schoolId, "students");
  const all = useDocs(schoolId, "attendance");
  const [classId, setClassId] = useState("");
  const [date, setDate] = useState(todayISO);
  const [marks, setMarks] = useState<Record<string, Status>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [filterDate, setFilterDate] = useState("");
  const [q, setQ] = useState("");

  const roster = students.rows.filter((s) => s.classId === classId);
  const existing = (id: string) => all.rows.find((a) => a.studentId === id && a.date === date)?.status as Status | undefined;
  const current = (id: string) => marks[id] ?? existing(id);

  const today = all.rows.filter((a) => a.date === todayISO());
  const trend = useMemo(() => {
    const days: { label: string; value: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      const recs = all.rows.filter((a) => a.date === d);
      days.push({ label: d.slice(5), value: recs.length ? Math.round((recs.filter((r) => r.status !== "absent").length / recs.length) * 100) : 0 });
    }
    return days;
  }, [all.rows]);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const marked = roster.filter((s) => current(s.id));
      await Promise.all(
        marked.map((s) =>
          setSchoolDoc(schoolId!, "attendance", `${date}_${s.id}`, { date, classId, studentId: s.id, status: current(s.id), markedBy: user.uid }, false),
        ),
      );
      await syncToReplica(schoolId!, marked.map((s) => ({ collection: "attendance", docId: `${date}_${s.id}` })));
      setMarks({});
      await all.reload();
      setMsg({ ok: true, text: `Saved attendance for ${marked.length} students.` });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  const studentName = (id: unknown) => fmt(students.rows.find((s) => s.id === id)?.displayName ?? id);
  const records = all.rows
    .filter((a) => !filterDate || a.date === filterDate)
    .filter((a) => !q || studentName(a.studentId).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  return (
    <>
      <PageHeader title="Attendance" subtitle="Daily attendance across the school" />
      <div className="stats">
        <Stat label="Present today" value={today.filter((a) => a.status === "present").length} icon="check" tone="ok" />
        <Stat label="Absent today" value={today.filter((a) => a.status === "absent").length} icon="user" tone="bad" />
        <Stat label="Late today" value={today.filter((a) => a.status === "late").length} icon="clock" tone="warn" />
        <Stat
          label="Today's rate"
          value={today.length ? `${Math.round((today.filter((a) => a.status !== "absent").length / today.length) * 100)}%` : "—"}
          icon="chart"
        />
      </div>
      <div className="grid">
        {caps.attendance && (
          <Card title="Mark attendance" subtitle="Pick a class and date, tap a status for each student, then save.">
            <div className="toolbar">
              <select value={classId} onChange={(e) => setClassId(e.target.value)} aria-label="Class">
                <option value="">Select class…</option>
                {classes.rows.map((c) => (
                  <option key={c.id} value={c.id}>
                    {fmt(c.name)}
                  </option>
                ))}
              </select>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
              {classId && roster.length > 0 && (
                <button className="secondary small" onClick={() => setMarks(Object.fromEntries(roster.map((s) => [s.id, "present" as Status])))}>
                  Mark all present
                </button>
              )}
            </div>
            {!classId ? (
              <Empty icon="check" title="Select a class to start" />
            ) : !roster.length ? (
              <Empty icon="student" title="No students in this class" />
            ) : (
              <>
                <DataTable
                  rows={roster}
                  columns={[
                    { key: "displayName", label: "Student" },
                    {
                      key: "status",
                      label: "Status",
                      render: (s) => (
                        <div className="row">
                          {(["present", "absent", "late"] as Status[]).map((st) => (
                            <button key={st} className={`small ${current(s.id) === st ? st : "secondary"}`} onClick={() => setMarks((m) => ({ ...m, [s.id]: st }))}>
                              {st}
                            </button>
                          ))}
                        </div>
                      ),
                    },
                  ]}
                />
                <div className="row" style={{ marginTop: 12 }}>
                  <button onClick={save} disabled={saving}>
                    {saving ? "Saving…" : "Save attendance"}
                  </button>
                  <span className="muted">{roster.filter((s) => current(s.id)).length} of {roster.length} marked</span>
                </div>
              </>
            )}
            {msg && <p className={`alert ${msg.ok ? "ok" : "bad"}`} style={{ marginTop: 10 }}>{msg.text}</p>}
          </Card>
        )}
        <Card title="Attendance rate · last 14 days">
          <BarChart data={trend} max={100} format={(v) => `${v}%`} />
          <BarLabels labels={trend.map((t) => t.label)} />
        </Card>
      </div>
      <div style={{ marginTop: 18 }}>
        <Card title="Records">
          <div className="toolbar">
            <SearchBox value={q} onChange={setQ} placeholder="Search student…" />
            <input type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)} aria-label="Filter date" />
            {filterDate && (
              <button className="secondary small" onClick={() => setFilterDate("")}>
                Clear date
              </button>
            )}
          </div>
          <DataTable
            rows={records}
            loading={all.loading}
            error={all.error}
            exportAs="attendance"
            empty="No attendance recorded."
            columns={[
              { key: "date", label: "Date" },
              { key: "studentId", label: "Student", render: (r) => studentName(r.studentId), csv: (r) => studentName(r.studentId) },
              { key: "classId", label: "Class", render: (r) => name(r.classId), csv: (r) => name(r.classId) },
              { key: "status", label: "Status", render: (r) => <Pill tone={String(r.status)}>{fmt(r.status)}</Pill>, csv: (r) => String(r.status) },
            ]}
          />
        </Card>
      </div>
    </>
  );
}

/* ============================ Exams (staff) ============================ */
export function ExamsPage() {
  const { schoolId } = useWorkspace();
  const caps = useCaps();
  const { classes, name } = useClassName(schoolId);
  const students = useDocs(schoolId, "students");
  const exams = useDocs(schoolId, "exams");
  const [q, setQ] = useState("");
  const [subject, setSubject] = useState("");
  const studentName = (id: unknown) => fmt(students.rows.find((s) => s.id === id)?.displayName ?? id);
  const pct = (r: Row) => (Number(r.maxMarks) ? (Number(r.marks) / Number(r.maxMarks)) * 100 : 0);

  const subjects = [...new Set(exams.rows.map((e) => String(e.subject ?? "")))].filter(Boolean).sort();
  const bySubject = subjects.map((s) => {
    const rs = exams.rows.filter((e) => e.subject === s);
    return { label: s, value: Math.round(rs.reduce((a, r) => a + pct(r), 0) / rs.length) };
  });
  const list = exams.rows
    .filter((e) => !subject || e.subject === subject)
    .filter((e) => !q || `${studentName(e.studentId)} ${e.name}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const avg = exams.rows.length ? Math.round(exams.rows.reduce((a, r) => a + pct(r), 0) / exams.rows.length) : 0;

  return (
    <>
      <PageHeader title="Exams & results" subtitle={`${exams.rows.length} results recorded`} />
      <div className="stats">
        <Stat label="Results" value={exams.rows.length} icon="award" />
        <Stat label="School average" value={exams.rows.length ? `${avg}%` : "—"} icon="chart" tone="info" />
        <Stat label="Subjects" value={subjects.length} icon="book" tone="ok" />
        <Stat label="Below 40%" value={exams.rows.filter((r) => pct(r) < 40).length} icon="user" tone="bad" />
      </div>
      <div className="grid">
        {caps.exams && (
          <Card title="Record a result">
            <SimpleForm
              submitLabel="Save result"
              columns={2}
              fields={[
                { name: "studentId", label: "Student", type: "select", required: true, options: students.rows.map((s) => ({ value: s.id, label: `${fmt(s.displayName)} (${name(s.classId)})` })) },
                { name: "name", label: "Exam", required: true, placeholder: "Midterm" },
                { name: "subject", label: "Subject", required: true, placeholder: "Mathematics" },
                { name: "date", label: "Date", type: "date", required: true, defaultValue: todayISO() },
                { name: "marks", label: "Marks", type: "number", required: true },
                { name: "maxMarks", label: "Out of", type: "number", required: true, defaultValue: "100" },
              ]}
              onSubmit={async (v) => {
                const st = students.rows.find((s) => s.id === v.studentId);
                if (Number(v.marks) > Number(v.maxMarks)) throw new Error("Marks cannot exceed the maximum.");
                await addSchoolDoc(schoolId!, "exams", { ...v, classId: st?.classId ?? null, marks: Number(v.marks), maxMarks: Number(v.maxMarks) });
                await exams.reload();
                return "Result saved.";
              }}
            />
          </Card>
        )}
        <Card title="Average score by subject">
          <BarChart data={bySubject} max={100} format={(v) => `${v}%`} />
          <BarLabels labels={bySubject.map((b) => b.label)} />
        </Card>
      </div>
      <div style={{ marginTop: 18 }}>
        <Card title="All results">
          <div className="toolbar">
            <SearchBox value={q} onChange={setQ} placeholder="Search student or exam…" />
            <select value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject">
              <option value="">All subjects</option>
              {subjects.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <DataTable
            rows={list}
            loading={exams.loading}
            error={exams.error}
            exportAs="exam-results"
            empty="No results yet."
            columns={[
              { key: "studentId", label: "Student", render: (r) => studentName(r.studentId), csv: (r) => studentName(r.studentId) },
              { key: "classId", label: "Class", render: (r) => name(r.classId), csv: (r) => name(r.classId) },
              { key: "name", label: "Exam" },
              { key: "subject", label: "Subject" },
              {
                key: "marks",
                label: "Score",
                csv: (r) => `${r.marks}/${r.maxMarks} (${Math.round(pct(r))}%)`,
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
              { key: "date", label: "Date" },
            ]}
          />
        </Card>
      </div>
    </>
  );
}

/* ============================ Homework (staff + family) ============================ */
export function HomeworkPage() {
  const { user } = useSession();
  const { schoolId, studentClassId } = useWorkspace();
  const caps = useCaps();
  const { classes, name } = useClassName(schoolId);
  const hw = useDocs(schoolId, "homework");
  const [cls, setCls] = useState("");

  const list = hw.rows
    .filter((h) => (caps.isFamily ? h.classId === studentClassId : !cls || h.classId === cls))
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
  const today = todayISO();

  return (
    <>
      <PageHeader title="Homework" subtitle={caps.isFamily ? `Assignments for ${name(studentClassId)}` : "Assignments posted to classes"} />
      <div className={caps.homework ? "grid-2" : ""}>
        <Card
          title={`Assignments (${list.length})`}
          actions={
            !caps.isFamily && (
              <select value={cls} onChange={(e) => setCls(e.target.value)} aria-label="Class">
                <option value="">All classes</option>
                {classes.rows.map((c) => (
                  <option key={c.id} value={c.id}>
                    {fmt(c.name)}
                  </option>
                ))}
              </select>
            )
          }
        >
          {!list.length ? (
            <Empty icon="book" title="No homework" />
          ) : (
            <ul className="list">
              {list.map((h) => {
                const overdue = String(h.dueDate) < today;
                return (
                  <li key={h.id}>
                    <div className="stat-icon tone-primary" style={{ width: 40, height: 40 }}>
                      <Icon name="book" />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div className="row">
                        <strong>{fmt(h.title)}</strong>
                        <Pill tone="primary">{fmt(h.subject)}</Pill>
                        {!caps.isFamily && <Pill>{name(h.classId)}</Pill>}
                        <Pill tone={overdue ? "bad" : String(h.dueDate) === today ? "warn" : "ok"}>
                          {overdue ? "Past due" : "Due"} {fmt(h.dueDate)}
                        </Pill>
                      </div>
                      <p>{fmt(h.details)}</p>
                      <small className="muted">Posted by {fmt(h.authorName)}</small>
                    </div>
                    {(caps.isAdmin || h.authorUid === user.uid) && !caps.isFamily && (
                      <button
                        className="small danger"
                        aria-label="Delete homework"
                        onClick={async () => {
                          await deleteSchoolDoc(schoolId!, "homework", h.id);
                          await hw.reload();
                        }}
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        {caps.homework && (
          <Card title="Post homework">
            <SimpleForm
              submitLabel="Post"
              fields={[
                { name: "classId", label: "Class", type: "select", required: true, options: classes.rows.map((c) => ({ value: c.id, label: fmt(c.name) })) },
                { name: "subject", label: "Subject", required: true },
                { name: "title", label: "Title", required: true, placeholder: "Chapter 4 exercises" },
                { name: "details", label: "Details", type: "textarea" },
                { name: "dueDate", label: "Due date", type: "date", required: true },
              ]}
              onSubmit={async (v) => {
                await addSchoolDoc(schoolId!, "homework", { ...v, authorUid: user.uid, authorName: user.displayName ?? user.email });
                await hw.reload();
                return "Homework posted.";
              }}
            />
          </Card>
        )}
      </div>
    </>
  );
}
