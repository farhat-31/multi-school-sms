import { useCallback, useEffect, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getCountFromServer,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentReference,
} from "firebase/firestore";
import { db, REPLICA_URL } from "../firebase";
import { PERMISSIONS, granted, useSession, type Profile, type Role } from "../auth";
import { displayLogin } from "../people-actions";
import { createAccount } from "../accounts";
import { loginEmail } from "../firebase";
import { purgeReplica, replicaStats, resyncSchool, syncToReplica, type Row } from "../data";
import { useWorkspace } from "../context";
import { navigate } from "../router";
import { useConfirm, useToast } from "../components/feedback";
import { Icon } from "../components/icons";
import { BarChart, BarLabels, Card, DataTable, Donut, Empty, PageHeader, Person, Pill, SearchBox, SimpleForm, Stat, fmt } from "../components/ui";

const SCHOOL_COLLECTIONS = ["students", "teachers", "parents", "classes", "attendance", "fees", "exams", "announcements", "timetable", "homework"];

/** "" -> next free id, "5" / "School 5" -> school_005, "Green Valley" -> school_green_valley */
export function toSchoolId(input: string, fallback: string): string {
  const raw = input.trim().toLowerCase();
  if (!raw) return fallback;
  const slug = raw.replace(/^school[_\s-]*/, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  if (!slug) throw new Error("Please type a school ID with letters or numbers, or leave it empty.");
  return /^\d+$/.test(slug) ? `school_${slug.padStart(3, "0")}` : `school_${slug}`;
}

/** Student counts per school (students are profiles, not logins). */
function useStudentCounts(schoolIds: string[]) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const key = schoolIds.join(",");
  useEffect(() => {
    if (!key) return;
    Promise.all(
      key.split(",").map(async (id) => [id, (await getCountFromServer(collection(db, "schools", id, "students"))).data().count] as const),
    ).then((pairs) => setCounts(Object.fromEntries(pairs)), () => undefined);
  }, [key]);
  return counts;
}

/** All users across schools (Super Admin can read them all). */
function useAllUsers() {
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    const snap = await getDocs(collection(db, "users"));
    setUsers(snap.docs.map((d) => d.data() as Profile));
    setLoading(false);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return { users, loading, reload: load };
}

/* ============================ Platform overview ============================ */
export function PlatformOverview() {
  const { schools } = useWorkspace();
  const { users } = useAllUsers();
  const count = (r: Role) => users.filter((u) => u.role === r).length;
  const studentCounts = useStudentCounts(schools.map((s) => s.id));
  const totalStudents = Object.values(studentCounts).reduce((a, b) => a + b, 0);
  const perSchool = schools.map((s) => ({ label: fmt(s.name), value: studentCounts[s.id] ?? 0 }));
  return (
    <>
      <PageHeader
        title="Platform overview"
        subtitle="Every school on one Firebase project, each with its own isolated Cloudflare database."
        actions={
          <button onClick={() => navigate("schools")}>
            <Icon name="plus" /> Add school
          </button>
        }
      />
      <div className="stats">
        <Stat label="Schools" value={schools.length} icon="school" />
        <Stat label="School Admins" value={count("schoolAdmin")} icon="shield" tone="info" />
        <Stat label="Teachers" value={count("teacher")} icon="teacher" tone="ok" />
        <Stat label="Students" value={totalStudents} icon="student" tone="warn" />
        <Stat label="Families" value={count("parent")} icon="parent" tone="bad" />
      </div>
      <div className="grid-2">
        <Card title="Students per school">
          {perSchool.length ? (
            <>
              <BarChart data={perSchool} />
              <BarLabels labels={perSchool.map((p) => p.label)} />
            </>
          ) : (
            <Empty icon="school" title="No schools yet" />
          )}
        </Card>
        <Card title="People by role">
          <Donut
            center={<span>{count("schoolAdmin") + count("teacher") + totalStudents + count("parent")}</span>}
            segments={[
              { label: "School Admins", value: count("schoolAdmin"), color: "#0ea5e9" },
              { label: "Teachers", value: count("teacher"), color: "#10b981" },
              { label: "Students", value: totalStudents, color: "#f59e0b" },
              { label: "Families", value: count("parent"), color: "#ec4899" },
            ]}
          />
        </Card>
      </div>
    </>
  );
}

/* ============================ Schools ============================ */
export function SchoolsPage() {
  const { user } = useSession();
  const ws = useWorkspace();
  const { users, reload } = useAllUsers();
  const [q, setQ] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const confirm = useConfirm();
  const toast = useToast();

  const taken = new Set(ws.schools.map((s) => s.id));
  let n = 1;
  while (taken.has(`school_${String(n).padStart(3, "0")}`)) n++;
  const nextId = `school_${String(n).padStart(3, "0")}`;

  async function deleteSchool(id: string) {
    const s = ws.schools.find((x) => x.id === id);
    const ok = await confirm({
      title: `Delete ${fmt(s?.name)}?`,
      message: "All students, teachers, parents, classes, attendance, fees, exams, homework, timetable and announcements are removed, its Cloudflare database is wiped, and everyone in this school loses access. This cannot be undone.",
      confirmLabel: "Delete school",
      danger: true,
      typeToConfirm: id,
    });
    if (!ok) return;
    setDeleting(id);
    try {
      const refs: DocumentReference[] = [];
      for (const col of SCHOOL_COLLECTIONS) (await getDocs(collection(db, "schools", id, col))).docs.forEach((d) => refs.push(d.ref));
      (await getDocs(query(collection(db, "users"), where("schoolId", "==", id)))).docs.forEach((d) => refs.push(d.ref));
      for (let i = 0; i < refs.length; i += 400) {
        const b = writeBatch(db);
        refs.slice(i, i + 400).forEach((r) => b.delete(r));
        await b.commit();
      }
      await deleteDoc(doc(db, "schools", id));
      await purgeReplica(id).catch(() => undefined);
      if (ws.schoolId === id) ws.setSchoolId(undefined);
      await Promise.all([ws.reloadSchools(), reload()]);
      toast(`${fmt(s?.name)} deleted`);
    } catch (e) {
      toast(`Delete failed: ${(e as Error).message}`, "bad");
    } finally {
      setDeleting(null);
    }
  }

  const rows = ws.schools.filter((s) => `${s.name} ${s.id}`.toLowerCase().includes(q.toLowerCase()));
  const adminsOf = (sid: string) => users.filter((u) => u.schoolId === sid && u.role === "schoolAdmin");
  const studentCounts = useStudentCounts(ws.schools.map((s) => s.id));
  const studentsOf = (sid: string) => studentCounts[sid] ?? 0;

  return (
    <>
      <PageHeader title="Schools" subtitle="Create schools with their School Admin login, open a school to manage it, or remove it." />
      <div className="grid-2">
        <Card title={`All schools (${ws.schools.length})`}>
          <div className="toolbar">
            <SearchBox value={q} onChange={setQ} placeholder="Search schools…" />
          </div>
          <DataTable
            rows={rows}
            exportAs="schools"
            empty="No schools yet. Create the first one."
            columns={[
              { key: "name", label: "School", render: (r) => <Person name={fmt(r.name)} sub={r.id} />, csv: (r) => `${r.name} (${r.id})` },
              {
                key: "admin",
                label: "School Admin",
                render: (r) => adminsOf(r.id).map((a) => displayLogin(a.email)).join(", ") || "—",
                csv: (r) => adminsOf(r.id).map((a) => displayLogin(a.email)).join("; "),
              },
              { key: "students", label: "Students", render: (r) => studentsOf(r.id), csv: (r) => studentsOf(r.id) },
              { key: "createdAt", label: "Created" },
              {
                key: "actions",
                label: "",
                render: (r) => (
                  <div className="row">
                    <button
                      className="small"
                      onClick={() => {
                        ws.setSchoolId(r.id);
                        navigate("overview");
                      }}
                    >
                      Open <Icon name="arrow" size={14} />
                    </button>
                    <button className="small danger" disabled={deleting === r.id} onClick={() => deleteSchool(r.id)}>
                      <Icon name="trash" size={14} /> {deleting === r.id ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                ),
              },
            ]}
          />
        </Card>
        <div className="stack">
          <Card title="New school" subtitle="Creates the school and its School Admin login.">
            <SimpleForm
              submitLabel="Create school"
              fields={[
                { name: "name", label: "School name", required: true, placeholder: "Green Valley High" },
                { name: "schoolId", label: "School ID", placeholder: `Leave empty for ${nextId}` },
                { name: "address", label: "Address" },
                { name: "adminName", label: "School Admin name", required: true },
                { name: "adminLogin", label: "School Admin username", required: true, placeholder: "greenvalley" },
                { name: "adminPassword", label: "Password (min 6)", type: "password", required: true },
              ]}
              onSubmit={async (v) => {
                const sid = toSchoolId(String(v.schoolId ?? ""), nextId);
                if ((await getDoc(doc(db, "schools", sid))).exists()) throw new Error(`${sid} already exists`);
                const login = String(v.adminLogin).trim().toLowerCase();
                const email = loginEmail(login);
                const uid = await createAccount(email, String(v.adminPassword), String(v.adminName), async (newUid) => {
                  const b = writeBatch(db);
                  b.set(doc(db, "schools", sid), { schoolId: sid, name: v.name, address: v.address ?? "", status: "active", ownerUid: newUid, createdAt: serverTimestamp() });
                  b.set(doc(db, "users", newUid), {
                    uid: newUid,
                    email,
                    displayName: v.adminName,
                    role: "schoolAdmin",
                    schoolId: sid,
                    status: "active",
                    permissions: Object.fromEntries(PERMISSIONS.map((p) => [p.id, true])),
                    createdBy: user.uid,
                    createdAt: serverTimestamp(),
                  });
                  await b.commit();
                });
                await syncToReplica(sid, [
                  { collection: "_school", docId: sid },
                  { collection: "users", docId: uid },
                ]);
                await Promise.all([ws.reloadSchools(), reload()]);
                return `Created ${sid}. School Admin username: ${login}`;
              }}
            />
          </Card>
          <Card title="Add a School Admin" subtitle="Another admin login for an existing school.">
            <SimpleForm
              submitLabel="Create login"
              fields={[
                { name: "schoolId", label: "School", type: "select", required: true, options: ws.schools.map((s) => ({ value: s.id, label: `${fmt(s.name)} (${s.id})` })) },
                { name: "adminName", label: "Full name", required: true },
                { name: "login", label: "Username", required: true },
                { name: "password", label: "Password (min 6)", type: "password", required: true },
              ]}
              onSubmit={async (v) => {
                const sid = String(v.schoolId);
                const login = String(v.login).trim().toLowerCase();
                const email = loginEmail(login);
                const uid = await createAccount(email, String(v.password), String(v.adminName), async (newUid) => {
                  const b = writeBatch(db);
                  b.set(doc(db, "users", newUid), {
                    uid: newUid,
                    email,
                    displayName: v.adminName,
                    role: "schoolAdmin",
                    schoolId: sid,
                    status: "active",
                    permissions: Object.fromEntries(PERMISSIONS.map((p) => [p.id, true])),
                    createdBy: user.uid,
                    createdAt: serverTimestamp(),
                  });
                  await b.commit();
                });
                await syncToReplica(sid, [{ collection: "users", docId: uid }]);
                await reload();
                return `School Admin for ${sid} created. Username: ${login}`;
              }}
            />
          </Card>
        </div>
      </div>
    </>
  );
}

/* ============================ School Admin permissions ============================ */
export function AdminPermissionsPage() {
  const { users, loading, reload } = useAllUsers();
  const toast = useToast();
  const ws = useWorkspace();
  const admins = users.filter((u) => u.role === "schoolAdmin");
  const schoolName = (id?: string) => fmt(ws.schools.find((s) => s.id === id)?.name ?? id);

  async function toggle(a: Profile, perm: string) {
    const permissions = { ...Object.fromEntries(PERMISSIONS.map((p) => [p.id, granted(a, p.id)])), [perm]: !granted(a, perm) };
    await updateDoc(doc(db, "users", a.uid), { permissions });
    await syncToReplica(a.schoolId!, [{ collection: "users", docId: a.uid }]);
    await reload();
    toast(`${permissions[perm] ? "Granted" : "Removed"} “${PERMISSIONS.find((p) => p.id === perm)?.label}” for ${a.displayName}`);
  }
  async function setStatus(a: Profile, status: "active" | "disabled") {
    await updateDoc(doc(db, "users", a.uid), { status });
    await syncToReplica(a.schoolId!, [{ collection: "users", docId: a.uid }]);
    await reload();
    toast(`${a.displayName} ${status === "active" ? "enabled" : "disabled"}`, status === "active" ? "ok" : "info");
  }

  return (
    <>
      <PageHeader
        title="School Admins"
        subtitle="Grant or remove what each School Admin can do. Changes apply instantly and are enforced by the security rules."
      />
      <Card title={`School Admins (${admins.length})`}>
        <DataTable
          rows={admins.map((a) => ({ ...a, id: a.uid }))}
          loading={loading}
          empty="No School Admins yet."
          columns={[
            { key: "displayName", label: "Admin", render: (r) => <Person name={fmt(r.displayName)} sub={`${displayLogin(String(r.email))} · ${schoolName(r.schoolId as string)}`} /> },
            ...PERMISSIONS.map((perm) => ({
              key: perm.id,
              label: perm.label.split(" (")[0],
              render: (r: Row) => {
                const a = r as unknown as Profile;
                return <input type="checkbox" checked={granted(a, perm.id)} onChange={() => toggle(a, perm.id)} aria-label={`${perm.label} for ${a.displayName}`} />;
              },
            })),
            {
              key: "status",
              label: "Access",
              render: (r) => {
                const a = r as unknown as Profile;
                return (
                  <div className="row">
                    <Pill tone={a.status}>{a.status}</Pill>
                    <button className="small secondary" onClick={() => setStatus(a, a.status === "active" ? "disabled" : "active")}>
                      {a.status === "active" ? "Disable" : "Enable"}
                    </button>
                  </div>
                );
              },
            },
          ]}
        />
      </Card>
    </>
  );
}

/* ============================ Cloudflare ============================ */
export function CloudPage() {
  const ws = useWorkspace();
  const [result, setResult] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (sid: string, fn: () => Promise<string>) => {
    setBusy(sid);
    try {
      setResult((r) => ({ ...r, [sid]: "…" }));
      const text = await fn();
      setResult((r) => ({ ...r, [sid]: text }));
    } catch (e) {
      setResult((r) => ({ ...r, [sid]: (e as Error).message }));
    } finally {
      setBusy(null);
    }
  };
  const show = (c: Record<string, number>) => Object.entries(c).map(([k, v]) => `${k}: ${v}`).join(" · ") || "empty";

  return (
    <>
      <PageHeader
        title="Cloudflare sync"
        subtitle="Each school has its own SQLite database on Cloudflare (free plan). Writes go to Firestore first, then sync automatically."
      />
      {!REPLICA_URL ? (
        <Card title="Not configured">
          <p className="muted">Set VITE_REPLICA_URL to enable the Cloudflare layer.</p>
        </Card>
      ) : (
        <Card title="Per-school databases" subtitle={REPLICA_URL}>
          <DataTable
            rows={ws.schools}
            empty="No schools yet."
            columns={[
              { key: "name", label: "School", render: (r) => <Person name={fmt(r.name)} sub={r.id} /> },
              {
                key: "actions",
                label: "",
                render: (r) => (
                  <div className="row">
                    <button className="small secondary" disabled={busy === r.id} onClick={() => run(r.id, async () => show(await replicaStats(r.id)))}>
                      <Icon name="chart" size={14} /> Stats
                    </button>
                    <button className="small secondary" disabled={busy === r.id} onClick={() => run(r.id, async () => `Resynced · ${show(await resyncSchool(r.id))}`)}>
                      <Icon name="refresh" size={14} /> Resync from Firestore
                    </button>
                  </div>
                ),
              },
              { key: "result", label: "Result", render: (r) => <span className="muted">{result[r.id] ?? ""}</span> },
            ]}
          />
        </Card>
      )}
    </>
  );
}
