/**
 * Data access.
 *  - Writes go to Firestore (source of truth, protected by security rules),
 *    then the Cloudflare Worker is asked to pull those documents into the
 *    school's own SQLite replica.
 *  - Reads come from the Cloudflare replica by default (switchable to Firestore).
 */
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  deleteDoc,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { auth, db, REPLICA_URL } from "./firebase";
import { useAuth, type Profile } from "./auth";

export type Source = "firestore" | "replica";
export type Row = { id: string; [key: string]: unknown };
export type Filters = Record<string, string>;
export interface SyncItem {
  collection: string;
  docId: string;
}

export const SourceContext = createContext<{ source: Source; setSource: (s: Source) => void }>({
  source: "firestore",
  setSource: () => undefined,
});
export const useSource = () => useContext(SourceContext);

/** Reads go to Cloudflare (secondary, per-school SQLite) whenever it is configured. */
export function initialSource(): Source {
  return REPLICA_URL ? "replica" : "firestore";
}

export function plain(v: unknown): unknown {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
  return v;
}

export async function worker(path: string, init: RequestInit = {}, params: Filters = {}): Promise<Response> {
  const token = await auth.currentUser?.getIdToken();
  const qs = new URLSearchParams(params).toString();
  return fetch(`${REPLICA_URL}${path}${qs ? `?${qs}` : ""}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

async function workerJson<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Cloudflare: ${(body as { error?: string }).error ?? res.status}`);
  return body as T;
}

/** Ask Cloudflare to pull these docs from Firestore into the school replica. */
export async function syncToReplica(schoolId: string, items: SyncItem[]): Promise<void> {
  if (!REPLICA_URL || !items.length) return;
  try {
    for (let i = 0; i < items.length; i += 50) {
      await workerJson(
        await worker(`/api/schools/${schoolId}/sync`, { method: "POST", body: JSON.stringify({ items: items.slice(i, i + 50) }) }),
      );
    }
  } catch (e) {
    console.warn("Replica sync failed (Firestore write succeeded):", e);
  }
}

export async function resyncSchool(schoolId: string): Promise<Record<string, number>> {
  const r = await workerJson<{ summary: Record<string, number> }>(
    await worker(`/api/schools/${schoolId}/resync`, { method: "POST", body: "{}" }),
  );
  return r.summary;
}

export async function replicaStats(schoolId: string): Promise<Record<string, number>> {
  return (await workerJson<{ counts: Record<string, number> }>(await worker(`/api/schools/${schoolId}/stats`))).counts;
}

/**
 * Read a school collection. Cloudflare first; if it is unreachable or errors,
 * fall back to Firestore (the primary) automatically, so pages never break.
 */
export async function listDocs(
  source: Source,
  schoolId: string,
  col: string,
  filters: Filters = {},
  classScope?: string[],
): Promise<Row[]> {
  if (source === "replica") {
    try {
      // Cloudflare applies the same class isolation server-side.
      return await listFromReplica(schoolId, col, filters);
    } catch (e) {
      console.warn(`Cloudflare read failed for ${col}; using Firestore`, e);
    }
  }
  if (!classScope) return listFromFirestore(schoolId, col, filters);
  // Class-isolated reader: one query per allowed class (what the security rules permit).
  const classes = filters.classId ? classScope.filter((c) => c === filters.classId) : classScope;
  const parts = await Promise.all(classes.map((c) => listFromFirestore(schoolId, col, { ...filters, classId: c })));
  return parts.flat();
}

/** Collections that are isolated per class (teachers: assigned classes; families: their children's classes). */
const CLASS_SCOPED_TEACHER = new Set(["students", "attendance", "exams", "homework", "timetable"]);
const CLASS_SCOPED_FAMILY = new Set(["homework", "timetable"]);

/** The classes this user is limited to for `col`, or undefined if not class-limited. */
export function classScopeFor(profile: Profile | null | undefined, col: string): string[] | undefined {
  if (!profile) return undefined;
  if (profile.role === "teacher" && CLASS_SCOPED_TEACHER.has(col)) return profile.classIds ?? [];
  if (profile.role === "parent" && CLASS_SCOPED_FAMILY.has(col)) return profile.classIds ?? [];
  if (profile.role === "student" && CLASS_SCOPED_FAMILY.has(col)) return profile.classId ? [profile.classId] : [];
  return undefined;
}

async function listFromReplica(schoolId: string, col: string, filters: Filters): Promise<Row[]> {
  {
    const out: Row[] = [];
    let after: string | undefined;
    do {
      const body = await workerJson<{ docs: { id: string; data: Record<string, unknown> }[]; next?: string }>(
        await worker(`/api/schools/${schoolId}/${col}`, {}, { ...filters, limit: "500", ...(after ? { after } : {}) }),
      );
      out.push(...body.docs.map((d) => ({ ...d.data, id: d.id })));
      after = body.next;
    } while (after);
    return out;
  }
}

async function listFromFirestore(schoolId: string, col: string, filters: Filters): Promise<Row[]> {
  const constraints = Object.entries(filters).map(([k, v]) => where(k, "==", v));
  const snap = await getDocs(query(collection(db, "schools", schoolId, col), ...constraints));
  return snap.docs.map((d) => ({ ...(plain(d.data()) as object), id: d.id }));
}

/** One doc of a school. `col` undefined = the school doc itself. */
export async function getOne(source: Source, schoolId: string, col?: string, id?: string): Promise<Row | null> {
  if (source === "replica") {
    try {
      const res = await worker(`/api/schools/${schoolId}${col ? `/${col}/${id}` : ""}`);
      if (res.ok) {
        const d = (await res.json()) as { id: string; data: Record<string, unknown> };
        return { ...d.data, id: d.id };
      }
      // 404 may just mean "not copied yet": confirm with Firestore below.
    } catch (e) {
      console.warn("Cloudflare read failed; using Firestore", e);
    }
  }
  const ref = !col ? doc(db, "schools", schoolId) : doc(db, "schools", schoolId, col, id!);
  const snap = await getDoc(ref);
  return snap.exists() ? { ...(plain(snap.data()) as object), id: snap.id } : null;
}

/** Create a document inside one school (stamped with schoolId), then sync. */
export async function addSchoolDoc(schoolId: string, col: string, data: Record<string, unknown>) {
  const ref = await addDoc(collection(db, "schools", schoolId, col), { ...data, schoolId, createdAt: serverTimestamp() });
  await syncToReplica(schoolId, [{ collection: col, docId: ref.id }]);
  return ref;
}

export async function setSchoolDoc(schoolId: string, col: string, id: string, data: Record<string, unknown>, sync = true) {
  await setDoc(doc(db, "schools", schoolId, col, id), { ...data, schoolId, updatedAt: serverTimestamp() });
  if (sync) await syncToReplica(schoolId, [{ collection: col, docId: id }]);
}

export async function updateSchoolDoc(schoolId: string, col: string, id: string, patch: Record<string, unknown>) {
  await updateDoc(doc(db, "schools", schoolId, col, id), { ...patch, updatedAt: serverTimestamp() });
  await syncToReplica(schoolId, [{ collection: col, docId: id }]);
}

/** React hook: load a school collection from the current source. */
export function useDocs(schoolId: string | undefined, col: string, filters: Filters = {}, enabled = true) {
  const { source } = useSource();
  const { profile } = useAuth();
  const scope = classScopeFor(profile, col);
  const scopeKey = scope ? scope.join(",") : "*";
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(filters);

  const reload = useCallback(async () => {
    if (!schoolId || !enabled) return;
    setLoading(true);
    setError(null);
    try {
      setRows(await listDocs(source, schoolId, col, JSON.parse(key), scopeKey === "*" ? undefined : scopeKey ? scopeKey.split(",") : []));
    } catch (e) {
      setError((e as Error).message);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [schoolId, col, key, source, enabled, scopeKey]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { rows, loading, error, reload };
}

/** Super Admin: wipe a deleted school's Cloudflare database. */
export async function purgeReplica(schoolId: string): Promise<void> {
  if (!REPLICA_URL) return;
  await workerJson(await worker(`/api/schools/${schoolId}/purge`, { method: "POST", body: "{}" }));
}

export async function deleteSchoolDoc(schoolId: string, col: string, id: string) {
  await deleteDoc(doc(db, "schools", schoolId, col, id));
  await syncToReplica(schoolId, [{ collection: col, docId: id }]);
}
