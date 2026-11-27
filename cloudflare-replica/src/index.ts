/**
 * Cloudflare layer for the multi-school system (Workers + SQLite Durable Objects, free plan).
 *
 *  GET  /health
 *  GET  /api/me                                    the caller's approved profile
 *  POST /api/schools/:schoolId/sync                {items:[{collection, docId}]} pull those docs from Firestore
 *  POST /api/schools/:schoolId/resync              (admins) full pull of the school from Firestore
 *  POST /api/schools/:schoolId/purge               (Super Admin) wipe the school's database
 *  GET  /api/schools/:schoolId                     school document
 *  GET  /api/schools/:schoolId/stats               per-collection counts (admins)
 *  GET  /api/schools/:schoolId/:collection         list (?limit, ?after, ?studentId, ?classId, ...)
 *  GET  /api/schools/:schoolId/:collection/:docId  single document
 *
 * Sync never trusts data from the browser: the worker re-reads each document
 * from Firestore WITH THE CALLER'S TOKEN (so Firestore rules apply) and stores
 * Firestore's own copy and updateTime.
 *
 * Isolation layers:
 *  1. Verified Firebase token + approved users/{uid}; its schoolId must equal :schoolId
 *  2. Routed to idFromName(schoolId): every school has its own DO + SQLite database
 *  3. Role policy (policy.ts) mirrors firestore.rules inside the DO
 */
import { authenticate, HttpError } from "./auth";
import { docToChange, Firestore, FirestoreError } from "./firestore";
import type { ReplicaDoc } from "./school-replica";
import {
  DOC_ID_RE,
  FILTERABLE_FIELDS,
  REPLICATED_COLLECTIONS,
  SCHOOL_ID_RE,
  SCHOOL_SUBCOLLECTIONS,
  type Env,
  type Principal,
  type ReplicaChange,
  type ReplicatedCollection,
} from "./types";

export { SchoolReplica } from "./school-replica";

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("origin");
  const allowed = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim());
  if (!origin || !allowed.includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

const stub = (env: Env, schoolId: string) => env.SCHOOL_REPLICA.get(env.SCHOOL_REPLICA.idFromName(schoolId));
const isCollection = (c: string): c is ReplicatedCollection => (REPLICATED_COLLECTIONS as readonly string[]).includes(c);

/** Firestore path of a replicated doc. */
function firestorePath(schoolId: string, collection: ReplicatedCollection, docId: string): string {
  if (collection === "_school") return `schools/${schoolId}`;
  if (collection === "users") return `users/${docId}`;
  return `schools/${schoolId}/${collection}/${docId}`;
}

async function handleSync(request: Request, env: Env, schoolId: string, p: Principal): Promise<Response> {
  const body = (await request.json()) as { items?: { collection?: string; docId?: string }[] };
  const items = Array.isArray(body.items) ? body.items.slice(0, 50) : [];
  const fs = new Firestore(env.FIREBASE_PROJECT_ID, p.idToken);
  const changes: ReplicaChange[] = [];
  const skipped: string[] = [];

  await Promise.all(
    items.map(async (it) => {
      const collection = String(it.collection ?? "");
      const docId = collection === "_school" ? schoolId : String(it.docId ?? "");
      if (!isCollection(collection) || !DOC_ID_RE.test(docId)) return void skipped.push(`${collection}/${docId}`);
      try {
        const doc = await fs.get(firestorePath(schoolId, collection, docId));
        if (!doc) {
          changes.push({ collection, docId, op: "delete", data: null, version: Date.now() * 1000 });
          return;
        }
        const change = docToChange(collection, doc);
        // A users doc only belongs in the replica of the school it names.
        if (collection === "users" && change.data?.schoolId !== schoolId) {
          changes.push({ collection, docId, op: "delete", data: null, version: change.version });
          return;
        }
        changes.push(change);
      } catch (e) {
        if (e instanceof FirestoreError && e.status === 403) return void skipped.push(`${collection}/${docId}`);
        throw e;
      }
    }),
  );
  const result = await stub(env, schoolId).applyChanges(schoolId, changes);
  return json({ ok: true, ...result, skipped });
}

async function handleResync(env: Env, schoolId: string, p: Principal): Promise<Response> {
  if (p.role !== "superAdmin" && p.role !== "schoolAdmin") throw new HttpError(403, "Admins only");
  const fs = new Firestore(env.FIREBASE_PROJECT_ID, p.idToken);
  const replica = stub(env, schoolId);
  const summary: Record<string, number> = {};

  const school = await fs.get(`schools/${schoolId}`);
  if (!school) throw new HttpError(404, "School not found in Firestore");
  await replica.replaceCollection(schoolId, "_school", [docToChange("_school", school)]);

  for (const col of SCHOOL_SUBCOLLECTIONS) {
    const docs = await fs.list(`schools/${schoolId}/${col}`);
    await replica.replaceCollection(schoolId, col, docs.map((d) => docToChange(col, d)));
    summary[col] = docs.length;
  }
  const users = await fs.usersOfSchool(schoolId);
  await replica.replaceCollection(schoolId, "users", users.map((d) => docToChange("users", d)));
  summary.users = users.length;
  return json({ ok: true, schoolId, summary });
}

async function handleRead(request: Request, env: Env, parts: string[], p: Principal): Promise<Response> {
  const [, , schoolId, collectionPart, docId] = parts;
  const replica = stub(env, schoolId);

  if (collectionPart === "stats") {
    if (p.role !== "superAdmin" && p.role !== "schoolAdmin") throw new HttpError(403, "Admins only");
    return json(await replica.stats());
  }
  const collection = collectionPart ?? "_school";
  if (!isCollection(collection)) throw new HttpError(404, "Unknown collection");
  if (docId !== undefined && !DOC_ID_RE.test(docId)) throw new HttpError(400, "Bad doc id");

  const url = new URL(request.url);
  const filters: Record<string, string> = {};
  for (const f of FILTERABLE_FIELDS) {
    const v = url.searchParams.get(f);
    if (v !== null) filters[f] = v;
  }
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), 500);
  const after = url.searchParams.get("after") ?? undefined;

  // RPC typing can't serialize `unknown`; the payload is plain JSON from SQLite.
  const result = (await replica.query({
    principal: { uid: p.uid, role: p.role, childIds: p.childIds, permissions: p.permissions, classIds: p.classIds, classId: p.classId },
    collection,
    docId: collectionPart ? docId : schoolId,
    filters,
    limit,
    after,
  })) as unknown as { docs: ReplicaDoc[]; next?: string };

  if (docId !== undefined || !collectionPart) {
    if (!result.docs[0]) throw new HttpError(404, "Not found");
    return json(result.docs[0]);
  }
  return json(result);
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

  if (url.pathname === "/health") return json({ ok: true });

  if (parts[0] !== "api") throw new HttpError(404, "Not found");
  const p = await authenticate(request, env.FIREBASE_PROJECT_ID);

  if (parts[1] === "me" && parts.length === 2) {
    return json({ uid: p.uid, role: p.role, schoolId: p.schoolId ?? null, childIds: p.childIds, classIds: p.classIds });
  }
  if (parts[1] !== "schools") throw new HttpError(404, "Not found");

  const schoolId = parts[2];
  if (!schoolId || !SCHOOL_ID_RE.test(schoolId) || parts.length > 5) throw new HttpError(404, "Not found");

  // ---- Isolation layer 1: only your own school (super admin excepted) ----
  if (p.role !== "superAdmin" && p.schoolId !== schoolId) throw new HttpError(403, "Cross-school access denied");

  if (request.method === "POST" && parts[3] === "sync" && parts.length === 4) return handleSync(request, env, schoolId, p);
  if (request.method === "POST" && parts[3] === "resync" && parts.length === 4) return handleResync(env, schoolId, p);
  if (request.method === "POST" && parts[3] === "purge" && parts.length === 4) {
    if (p.role !== "superAdmin") throw new HttpError(403, "Super Admin only");
    // Only purge once the school is really gone from Firestore.
    if (await new Firestore(env.FIREBASE_PROJECT_ID, p.idToken).get(`schools/${schoolId}`)) {
      throw new HttpError(409, "Delete the school in Firestore first");
    }
    return json(await stub(env, schoolId).purge());
  }
  if (request.method === "GET") return handleRead(request, env, parts, p);
  throw new HttpError(405, "Method not allowed");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    let res: Response;
    try {
      res = await route(request, env);
    } catch (err) {
      if (err instanceof HttpError) res = json({ error: err.message }, err.status);
      else if (err instanceof SyntaxError) res = json({ error: "Invalid JSON" }, 400);
      else {
        console.error(err);
        res = json({ error: "Internal error" }, 500);
      }
    }
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  },
} satisfies ExportedHandler<Env>;
