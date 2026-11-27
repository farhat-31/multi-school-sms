import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, doc, getDocs, query, updateDoc, where } from "firebase/firestore";
import { db } from "../firebase";
import { granted, TEACHER_PERMISSIONS, useSession, type Profile } from "../auth";
import { syncToReplica, useDocs, type Row } from "../data";
import { addSibling, attachParent, createFamily, createTeacher, displayLogin, removeStudent, setTeacherClasses } from "../people-actions";
import { useCaps, useMyClasses, useWorkspace } from "../context";
import { navigate } from "../router";
import { Icon } from "../components/icons";
import { BulkUpload } from "../components/BulkUpload";
import { useConfirm, useToast } from "../components/feedback";
import { Card, DataTable, PageHeader, Person, Pill, SearchBox, SimpleForm, Stat, fmt } from "../components/ui";

/** School Admin: all accounts of the school (users where schoolId == X). */
export function usePeople(schoolId?: string, enabled = true) {
  const [people, setPeople] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!schoolId || !enabled) return setLoading(false);
    setLoading(true);
    try {
      const snap = await getDocs(query(collection(db, "users"), where("schoolId", "==", schoolId)));
      setPeople(snap.docs.map((d) => d.data() as Profile).sort((a, b) => (a.displayName ?? "").localeCompare(b.displayName ?? "")));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [schoolId, enabled]);
  useEffect(() => {
    void load();
  }, [load]);
  return { people, loading, error, reload: load };
}

export interface Family {
  parentUid: string;
  parentName: string;
  login: string;
  children: Row[];
}

/** Families visible to this user (built from student profiles, which are class-isolated). */
export function useFamilies(schoolId?: string) {
  const students = useDocs(schoolId, "students");
  const families = useMemo(() => {
    const map = new Map<string, Family>();
    for (const s of students.rows) {
      const key = String(s.parentUid ?? s.familyLogin ?? s.id);
      const f = map.get(key) ?? { parentUid: String(s.parentUid ?? ""), parentName: String(s.parentName ?? "—"), login: String(s.familyLogin ?? ""), children: [] };
      f.children.push(s);
      map.set(key, f);
    }
    return [...map.values()].sort((a, b) => a.parentName.localeCompare(b.parentName));
  }, [students.rows]);
  return { students, families };
}

/* ============================ Students ============================ */
function StudentsList() {
  const { schoolId } = useWorkspace();
  const caps = useCaps();
  const { classes, name } = useMyClasses();
  const { students } = useFamilies(schoolId);
  const confirm = useConfirm();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [cls, setCls] = useState("");

  const list = students.rows
    .filter((s) => !cls || s.classId === cls)
    .filter((s) => `${s.displayName} ${s.parentName} ${s.familyLogin}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => String(a.displayName).localeCompare(String(b.displayName)));

  async function remove(s: Row) {
    const ok = await confirm({
      title: `Remove ${fmt(s.displayName)}?`,
      message: "The student's records are kept. If this is the family's only child, the parent's login is removed too.",
      confirmLabel: "Remove student",
      danger: true,
    });
    if (!ok) return;
    try {
      const r = await removeStudent(schoolId!, s);
      await students.reload();
      toast(r === "family" ? `${fmt(s.displayName)} and their family login removed` : `${fmt(s.displayName)} removed`);
    } catch (e) {
      toast((e as Error).message, "bad");
    }
  }

  return (
    <>
      <PageHeader
        title="Students"
        subtitle={caps.isTeacher ? "Students of your classes" : `${students.rows.length} students in this school`}
        actions={
          caps.addFamilies && (
            <button onClick={() => navigate("add-people")}>
              <Icon name="plus" /> Add student & parent
            </button>
          )
        }
      />
      <div className="stats">
        <Stat label="Students" value={students.rows.length} icon="student" />
        <Stat label={caps.isTeacher ? "My classes" : "Classes"} value={classes.length} icon="layers" tone="info" />
        <Stat label="Families" value={new Set(students.rows.map((s) => s.parentUid)).size} icon="parent" tone="ok" />
      </div>
      <Card title="All students">
        <div className="toolbar">
          <SearchBox value={q} onChange={setQ} placeholder="Search student, parent or login…" />
          <select value={cls} onChange={(e) => setCls(e.target.value)} aria-label="Filter by class">
            <option value="">{caps.isTeacher ? "All my classes" : "All classes"}</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {fmt(c.name)}
              </option>
            ))}
          </select>
        </div>
        <DataTable
          rows={list}
          loading={students.loading}
          error={students.error}
          exportAs="students"
          empty="No students found."
          columns={[
            { key: "displayName", label: "Student", render: (r) => <Person name={fmt(r.displayName)} />, csv: (r) => String(r.displayName ?? "") },
            { key: "classId", label: "Class", render: (r) => <Pill tone="primary">{name(r.classId)}</Pill>, csv: (r) => name(r.classId) },
            {
              key: "parentName",
              label: "Parent",
              render: (r) => (r.parentUid ? fmt(r.parentName) : <Pill tone="bad">No parent: add one</Pill>),
              csv: (r) => String(r.parentName ?? ""),
            },
            {
              key: "familyLogin",
              label: "Family login",
              render: (r) => <code>{displayLogin(String(r.familyLogin ?? ""))}</code>,
              csv: (r) => displayLogin(String(r.familyLogin ?? "")),
            },
            {
              key: "actions",
              label: "",
              render: (r) =>
                caps.addFamilies && (
                  <button className="small danger" onClick={() => remove(r)} aria-label={`Remove ${r.displayName}`}>
                    <Icon name="trash" size={14} />
                  </button>
                ),
            },
          ]}
        />
      </Card>
    </>
  );
}

/* ============================ Parents (families) ============================ */
function ParentsList() {
  const { schoolId } = useWorkspace();
  const caps = useCaps();
  const { name } = useMyClasses();
  const { families, students } = useFamilies(schoolId);
  const admin = usePeople(schoolId, caps.isAdmin); // login status is admin-only
  const toast = useToast();
  const [q, setQ] = useState("");
  const statusOf = (uid: string) => admin.people.find((p) => p.uid === uid)?.status;

  async function setStatus(uid: string, status: "active" | "disabled") {
    await updateDoc(doc(db, "users", uid), { status });
    await syncToReplica(schoolId!, [{ collection: "users", docId: uid }]);
    await admin.reload();
    toast(status === "active" ? "Family login enabled" : "Family login disabled (parent and student)", status === "active" ? "ok" : "info");
  }

  const rows = families
    .filter((f) => `${f.parentName} ${f.login} ${f.children.map((c) => c.displayName).join(" ")}`.toLowerCase().includes(q.toLowerCase()))
    .map((f) => ({ ...f, id: f.parentUid || f.login }));

  return (
    <>
      <PageHeader
        title="Parents & families"
        subtitle="Each family shares one login. Choose Parent or Student on the sign-in page."
        actions={
          caps.addFamilies && (
            <button onClick={() => navigate("add-people")}>
              <Icon name="plus" /> Add family
            </button>
          )
        }
      />
      <Card title={`Families (${families.length})`}>
        <div className="toolbar">
          <SearchBox value={q} onChange={setQ} placeholder="Search parent, child or login…" />
        </div>
        <DataTable
          rows={rows as unknown as Row[]}
          loading={students.loading}
          exportAs="families"
          empty="No families yet."
          columns={[
            { key: "parentName", label: "Parent", render: (r) => <Person name={fmt(r.parentName)} />, csv: (r) => String(r.parentName) },
            { key: "login", label: "Family login", render: (r) => <code>{displayLogin(String(r.login))}</code>, csv: (r) => displayLogin(String(r.login)) },
            {
              key: "children",
              label: "Children",
              render: (r) => (
                <div className="row">
                  {(r.children as Row[]).map((c) => (
                    <Pill key={c.id} tone="primary">
                      {fmt(c.displayName)} · {name(c.classId)}
                    </Pill>
                  ))}
                </div>
              ),
              csv: (r) => (r.children as Row[]).map((c) => `${c.displayName} (${name(c.classId)})`).join("; "),
            },
            ...(caps.isAdmin
              ? [
                  {
                    key: "status",
                    label: "Login",
                    render: (r: Row) => {
                      const st = statusOf(String(r.parentUid));
                      return st ? (
                        <div className="row">
                          <Pill tone={st}>{st}</Pill>
                          {caps.addFamilies && (
                            <button className="small secondary" onClick={() => setStatus(String(r.parentUid), st === "active" ? "disabled" : "active")}>
                              {st === "active" ? "Disable" : "Enable"}
                            </button>
                          )}
                        </div>
                      ) : (
                        "—"
                      );
                    },
                    csv: (r: Row) => statusOf(String(r.parentUid)) ?? "",
                  },
                ]
              : []),
          ]}
        />
      </Card>
    </>
  );
}

/* ============================ Teachers ============================ */
function TeachersList() {
  const { schoolId } = useWorkspace();
  const caps = useCaps();
  const teachers = useDocs(schoolId, "teachers");
  const allClasses = useDocs(schoolId, "classes");
  const admin = usePeople(schoolId, caps.isAdmin);
  const [q, setQ] = useState("");
  const className = (id: string) => fmt(allClasses.rows.find((c) => c.id === id)?.name ?? id);
  const statusOf = (uid: string) => admin.people.find((p) => p.uid === uid)?.status;
  const classIdsOf = (r: Row) => (admin.people.find((p) => p.uid === r.id)?.classIds ?? (r.classIds as string[]) ?? []) as string[];

  const list = teachers.rows
    .filter((t) => `${t.displayName} ${t.subject}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => String(a.displayName).localeCompare(String(b.displayName)));

  return (
    <>
      <PageHeader
        title="Teachers"
        subtitle={`${teachers.rows.length} teachers`}
        actions={
          caps.addTeachers && (
            <button onClick={() => navigate("add-people")}>
              <Icon name="plus" /> Add teacher
            </button>
          )
        }
      />
      <Card title="All teachers">
        <div className="toolbar">
          <SearchBox value={q} onChange={setQ} placeholder="Search teacher or subject…" />
          {caps.grantTeachers && (
            <button className="secondary small" onClick={() => navigate("teacher-permissions")}>
              <Icon name="key" size={14} /> Classes & permissions
            </button>
          )}
        </div>
        <DataTable
          rows={list}
          loading={teachers.loading}
          error={teachers.error}
          exportAs="teachers"
          empty="No teachers yet."
          columns={[
            {
              key: "displayName",
              label: "Teacher",
              render: (r) => <Person name={fmt(r.displayName)} sub={displayLogin(String(r.email ?? ""))} />,
              csv: (r) => String(r.displayName ?? ""),
            },
            { key: "subject", label: "Subject" },
            {
              key: "classes",
              label: "Classes",
              render: (r) => {
                const ids = classIdsOf(r);
                return ids.length ? (
                  <div className="row">
                    {ids.map((c) => (
                      <Pill key={c}>{className(c)}</Pill>
                    ))}
                  </div>
                ) : (
                  <span className="muted">Not assigned</span>
                );
              },
              csv: (r) => classIdsOf(r).map(className).join("; "),
            },
            ...(caps.isAdmin
              ? [{ key: "status", label: "Status", render: (r: Row) => <Pill tone={statusOf(r.id)}>{statusOf(r.id) ?? "—"}</Pill>, csv: (r: Row) => statusOf(r.id) ?? "" }]
              : []),
          ]}
        />
      </Card>
    </>
  );
}

export function PeopleList({ role }: { role: "student" | "teacher" | "parent" }) {
  return role === "student" ? <StudentsList /> : role === "parent" ? <ParentsList /> : <TeachersList />;
}

/* ============================ Add people ============================ */
export function AddPeoplePage() {
  const { user } = useSession();
  const { schoolId } = useWorkspace();
  const caps = useCaps();
  const { classes } = useMyClasses();
  const allClasses = useDocs(schoolId, "classes");
  const { families, students } = useFamilies(schoolId);
  const classOptions = classes.map((c) => ({ value: c.id, label: fmt(c.name) }));

  return (
    <>
      <PageHeader
        title="Add people"
        subtitle="Every student is added together with a parent; they share one login. Teachers are assigned to classes."
      />
      <div className="grid">
        {caps.addFamilies && (
          <Card title="New family" subtitle="Student + parent with one shared login. Both are required.">
            {!classOptions.length ? (
              <p className="alert info">{caps.isTeacher ? "You have no classes assigned yet. Ask your School Admin." : "Create a class first."}</p>
            ) : (
              <SimpleForm
                submitLabel="Create family"
                columns={2}
                fields={[
                  { name: "studentName", label: "Student name", required: true },
                  { name: "classId", label: "Class", type: "select", required: true, options: classOptions },
                  { name: "parentName", label: "Parent name", required: true },
                  { name: "phone", label: "Parent phone" },
                  { name: "login", label: "Family username or email", required: true, placeholder: "rao.family" },
                  { name: "password", label: "Password (min 6)", type: "password", required: true },
                ]}
                onSubmit={async (v) => {
                  const login = String(v.login).trim().toLowerCase();
                  await createFamily({
                    schoolId: schoolId!,
                    creatorUid: user.uid,
                    studentName: String(v.studentName),
                    classId: String(v.classId),
                    parentName: String(v.parentName),
                    phone: String(v.phone ?? ""),
                    login,
                    password: String(v.password),
                  });
                  await students.reload();
                  return `Family created. Login "${login}": choose Parent or Student on the sign-in page.`;
                }}
              />
            )}
          </Card>
        )}
        {caps.addFamilies && families.some((f) => f.parentUid) && (
          <Card title="Add a sibling" subtitle="Another child for an existing family (same login).">
            <SimpleForm
              submitLabel="Add sibling"
              fields={[
                {
                  name: "parentUid",
                  label: "Family",
                  type: "select",
                  required: true,
                  options: families.filter((f) => f.parentUid).map((f) => ({ value: f.parentUid, label: `${f.parentName} (${displayLogin(f.login)})` })),
                },
                { name: "studentName", label: "Student name", required: true },
                { name: "classId", label: "Class", type: "select", required: true, options: classOptions },
              ]}
              onSubmit={async (v) => {
                await addSibling({ schoolId: schoolId!, parentUid: String(v.parentUid), studentName: String(v.studentName), classId: String(v.classId) });
                await students.reload();
                return "Sibling added to the family.";
              }}
            />
          </Card>
        )}
        {caps.addFamilies && students.rows.some((s) => !s.parentUid) && (
          <Card title="Students without a parent" subtitle="Every student needs a parent. Create their family login here.">
            <SimpleForm
              submitLabel="Add parent"
              columns={2}
              fields={[
                {
                  name: "studentId",
                  label: "Student",
                  type: "select",
                  required: true,
                  options: students.rows.filter((s) => !s.parentUid).map((s) => ({ value: s.id, label: fmt(s.displayName) })),
                },
                { name: "parentName", label: "Parent name", required: true },
                { name: "phone", label: "Parent phone" },
                { name: "login", label: "Family username or email", required: true },
                { name: "password", label: "Password (min 6)", type: "password", required: true },
              ]}
              onSubmit={async (v) => {
                const student = students.rows.find((s) => s.id === v.studentId)!;
                const login = String(v.login).trim().toLowerCase();
                await attachParent({
                  schoolId: schoolId!,
                  creatorUid: user.uid,
                  student,
                  parentName: String(v.parentName),
                  phone: String(v.phone ?? ""),
                  login,
                  password: String(v.password),
                });
                await students.reload();
                return `Parent added. ${fmt(student.displayName)} and the parent now share the login "${login}".`;
              }}
            />
          </Card>
        )}
        {caps.addTeachers && (
          <Card title="New teacher" subtitle="Assign the classes they teach. They only see those classes.">
            <SimpleForm
              submitLabel="Create teacher"
              fields={[
                { name: "name", label: "Full name", required: true },
                { name: "subject", label: "Subject" },
                { name: "login", label: "Username or email", required: true },
                { name: "password", label: "Password (min 6)", type: "password", required: true },
                {
                  name: "classIds",
                  label: "Classes (ctrl/cmd-click for several)",
                  type: "select",
                  multiple: true,
                  options: allClasses.rows.map((c) => ({ value: c.id, label: fmt(c.name) })),
                },
              ]}
              onSubmit={async (v) => {
                const login = String(v.login).trim().toLowerCase();
                await createTeacher({
                  schoolId: schoolId!,
                  creatorUid: user.uid,
                  name: String(v.name),
                  subject: String(v.subject ?? ""),
                  login,
                  password: String(v.password),
                  classIds: (v.classIds as string[]) ?? [],
                });
                return `Teacher created. Username: ${login}`;
              }}
            />
          </Card>
        )}
        {(caps.addFamilies || caps.addTeachers) && (
          <BulkUpload
            schoolId={schoolId!}
            canTeachers={caps.addTeachers}
            canFamilies={caps.addFamilies}
            classes={classes}
            allClasses={allClasses.rows}
            families={families}
            onDone={students.reload}
          />
        )}
        {!caps.addFamilies && !caps.addTeachers && (
          <Card title="No permission">
            <p className="muted">You have not been given permission to add people. Ask the level above you.</p>
          </Card>
        )}
      </div>
    </>
  );
}

/* ============================ Teacher classes & permissions ============================ */
export function TeacherPermissionsPage() {
  const { schoolId } = useWorkspace();
  const { people, loading, reload } = usePeople(schoolId);
  const classes = useDocs(schoolId, "classes");
  const toast = useToast();
  const teachers = people.filter((p) => p.role === "teacher");

  async function toggle(t: Profile, perm: string) {
    const permissions = { ...Object.fromEntries(TEACHER_PERMISSIONS.map((x) => [x.id, granted(t, x.id)])), [perm]: !granted(t, perm) };
    await updateDoc(doc(db, "users", t.uid), { permissions });
    await syncToReplica(schoolId!, [{ collection: "users", docId: t.uid }]);
    await reload();
    toast(`${permissions[perm] ? "Granted" : "Removed"} “${TEACHER_PERMISSIONS.find((x) => x.id === perm)?.label}” for ${t.displayName}`);
  }
  async function toggleClass(t: Profile, classId: string) {
    const cur = t.classIds ?? [];
    const next = cur.includes(classId) ? cur.filter((c) => c !== classId) : [...cur, classId];
    await setTeacherClasses(schoolId!, t.uid, next);
    await reload();
    const cname = fmt(classes.rows.find((c) => c.id === classId)?.name);
    toast(cur.includes(classId) ? `${t.displayName} removed from ${cname}` : `${t.displayName} assigned to ${cname}`);
  }

  return (
    <>
      <PageHeader
        title="Teacher classes & permissions"
        subtitle="Teachers only see the classes ticked here. Changes are enforced by the security rules immediately."
      />
      <div className="stack">
        <Card title="Class assignment" subtitle="Which classes each teacher can see and work with.">
          <DataTable
            rows={teachers.map((t) => ({ ...t, id: t.uid }))}
            loading={loading}
            empty="No teachers yet."
            columns={[
              { key: "displayName", label: "Teacher", render: (r) => <Person name={fmt(r.displayName)} /> },
              ...classes.rows.map((c) => ({
                key: `c_${c.id}`,
                label: fmt(c.name),
                render: (r: Row) => {
                  const t = r as unknown as Profile;
                  return (
                    <input
                      type="checkbox"
                      checked={(t.classIds ?? []).includes(c.id)}
                      onChange={() => toggleClass(t, c.id)}
                      aria-label={`${t.displayName} teaches ${c.name}`}
                    />
                  );
                },
              })),
            ]}
          />
        </Card>
        <Card title="Permissions">
          <DataTable
            rows={teachers.map((t) => ({ ...t, id: t.uid }))}
            loading={loading}
            empty="No teachers yet."
            columns={[
              { key: "displayName", label: "Teacher", render: (r) => <Person name={fmt(r.displayName)} /> },
              ...TEACHER_PERMISSIONS.map((perm) => ({
                key: perm.id,
                label: perm.label,
                render: (r: Row) => {
                  const t = r as unknown as Profile;
                  return <input type="checkbox" checked={granted(t, perm.id)} onChange={() => toggle(t, perm.id)} aria-label={`${perm.label} for ${t.displayName}`} />;
                },
              })),
            ]}
          />
        </Card>
      </div>
    </>
  );
}
