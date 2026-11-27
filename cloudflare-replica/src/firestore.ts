/**
 * Minimal Firestore REST client that acts AS THE SIGNED-IN USER (their Firebase
 * ID token). Firestore security rules therefore still decide what the worker
 * may read - the worker never has more access than the user calling it.
 */
import type { ReplicaChange } from "./types";

type FsValue = Record<string, unknown>;
export interface FsDoc {
  name: string;
  fields?: Record<string, FsValue>;
  updateTime: string;
}

export function decodeValue(v: FsValue): unknown {
  if ("nullValue" in v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("timestampValue" in v) return v.timestampValue;
  if ("referenceValue" in v) return String(v.referenceValue).replace(/^projects\/[^/]+\/databases\/[^/]+\/documents\//, "");
  if ("geoPointValue" in v) {
    const g = v.geoPointValue as { latitude?: number; longitude?: number };
    return { lat: g.latitude ?? 0, lng: g.longitude ?? 0 };
  }
  if ("arrayValue" in v) return ((v.arrayValue as { values?: FsValue[] }).values ?? []).map(decodeValue);
  if ("mapValue" in v) return decodeFields((v.mapValue as { fields?: Record<string, FsValue> }).fields);
  if ("bytesValue" in v) return v.bytesValue;
  return null;
}

export function decodeFields(fields: Record<string, FsValue> | undefined): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields ?? {}).map(([k, v]) => [k, decodeValue(v)]));
}

/** RFC3339 with nanoseconds -> integer microseconds (monotonic version). */
export function toMicros(ts: string): number {
  const m = /^(.*?)(?:\.(\d+))?Z$/.exec(ts);
  if (!m) return Date.parse(ts) * 1000;
  const secs = Date.parse(`${m[1]}Z`) / 1000;
  const frac = (m[2] ?? "").padEnd(6, "0").slice(0, 6);
  return secs * 1_000_000 + Number(frac);
}

export function docToChange(collection: string, doc: FsDoc): ReplicaChange {
  return {
    collection,
    docId: doc.name.split("/").pop()!,
    op: "upsert",
    data: decodeFields(doc.fields),
    version: toMicros(doc.updateTime),
  };
}

export class Firestore {
  private base: string;
  constructor(projectId: string, private idToken: string) {
    this.base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
  }

  private headers() {
    return { authorization: `Bearer ${this.idToken}`, "content-type": "application/json" };
  }

  /** Returns the doc, null if it does not exist, or throws {status} if denied. */
  async get(path: string): Promise<FsDoc | null> {
    const res = await fetch(`${this.base}/${path}`, { headers: this.headers() });
    if (res.status === 404) return null;
    if (!res.ok) throw new FirestoreError(res.status, await res.text());
    return res.json();
  }

  async list(collectionPath: string): Promise<FsDoc[]> {
    const out: FsDoc[] = [];
    let pageToken = "";
    do {
      const qs = new URLSearchParams({ pageSize: "300", ...(pageToken ? { pageToken } : {}) });
      const res = await fetch(`${this.base}/${collectionPath}?${qs}`, { headers: this.headers() });
      if (!res.ok) throw new FirestoreError(res.status, await res.text());
      const body = (await res.json()) as { documents?: FsDoc[]; nextPageToken?: string };
      out.push(...(body.documents ?? []));
      pageToken = body.nextPageToken ?? "";
    } while (pageToken);
    return out;
  }

  /** users where schoolId == X */
  async usersOfSchool(schoolId: string): Promise<FsDoc[]> {
    const res = await fetch(`${this.base}:runQuery`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "users" }],
          where: { fieldFilter: { field: { fieldPath: "schoolId" }, op: "EQUAL", value: { stringValue: schoolId } } },
        },
      }),
    });
    if (!res.ok) throw new FirestoreError(res.status, await res.text());
    const rows = (await res.json()) as { document?: FsDoc }[];
    return rows.flatMap((r) => (r.document ? [r.document] : []));
  }
}

export class FirestoreError extends Error {
  constructor(public status: number, body: string) {
    super(`Firestore ${status}: ${body.slice(0, 200)}`);
  }
}
