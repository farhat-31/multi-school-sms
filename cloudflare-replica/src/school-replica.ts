import { DurableObject } from "cloudflare:workers";
import { readScope, type PolicyPrincipal } from "./policy";
import type { Env, Principal, ReplicaChange, ReplicatedCollection } from "./types";

export interface QueryInput {
  principal: PolicyPrincipal;
  collection: ReplicatedCollection;
  docId?: string;
  filters: Record<string, string>;
  limit: number;
  after?: string;
}

export interface ReplicaDoc {
  id: string;
  data: Record<string, unknown>;
  version: number;
}

/**
 * One instance == one school, backed by its OWN SQLite database (Cloudflare
 * Durable Objects, free plan). It holds only that school's documents, so even
 * a bug in query code cannot leak another school's data.
 */
export class SchoolReplica extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec(`
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS docs (
          collection TEXT NOT NULL,
          doc_id     TEXT NOT NULL,
          data       TEXT,                 -- JSON, NULL when deleted (tombstone)
          version    INTEGER NOT NULL,     -- Firestore updateTime in micros
          deleted    INTEGER NOT NULL DEFAULT 0,
          synced_at  INTEGER NOT NULL,
          PRIMARY KEY (collection, doc_id)
        );
        CREATE INDEX IF NOT EXISTS docs_student
          ON docs (collection, json_extract(data, '$.studentId'));
      `);
    });
  }

  /** Bind this instance to its school on first use; refuse anything else. */
  private assertSchool(schoolId: string): void {
    const row = this.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = 'schoolId'").toArray()[0];
    if (!row) this.sql.exec("INSERT INTO meta (key, value) VALUES ('schoolId', ?)", schoolId);
    else if (row.value !== schoolId) throw new Error(`Isolation violation: replica of ${row.value} got ${schoolId}`);
  }

  private upsert(c: ReplicaChange, now: number): boolean {
    const cursor = this.sql.exec(
      `INSERT INTO docs (collection, doc_id, data, version, deleted, synced_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (collection, doc_id) DO UPDATE SET
         data = excluded.data, version = excluded.version,
         deleted = excluded.deleted, synced_at = excluded.synced_at
       WHERE excluded.version > docs.version`,
      c.collection,
      c.docId,
      c.op === "delete" ? null : JSON.stringify(c.data ?? {}),
      c.version,
      c.op === "delete" ? 1 : 0,
      now,
    );
    return cursor.rowsWritten > 0;
  }

  /** Apply changes read from Firestore. Last-writer-wins by version -> idempotent. */
  async applyChanges(schoolId: string, changes: ReplicaChange[]): Promise<{ applied: number }> {
    this.assertSchool(schoolId);
    let applied = 0;
    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      for (const c of changes) if (this.upsert(c, now)) applied++;
    });
    return { applied };
  }

  /** Full resync of one collection: upsert all, tombstone what no longer exists. */
  async replaceCollection(schoolId: string, collection: string, changes: ReplicaChange[]): Promise<{ applied: number; removed: number }> {
    this.assertSchool(schoolId);
    const now = Date.now();
    let applied = 0;
    let removed = 0;
    this.ctx.storage.transactionSync(() => {
      for (const c of changes) if (this.upsert(c, now)) applied++;
      const keep = JSON.stringify(changes.map((c) => c.docId));
      removed = this.sql.exec(
        `UPDATE docs SET deleted = 1, data = NULL, version = version + 1, synced_at = ?
         WHERE collection = ? AND deleted = 0 AND doc_id NOT IN (SELECT value FROM json_each(?))`,
        now,
        collection,
        keep,
      ).rowsWritten;
    });
    return { applied, removed };
  }

  /** Read documents, applying the same role rules as firestore.rules. */
  async query(input: QueryInput): Promise<{ docs: ReplicaDoc[]; next?: string }> {
    const scope = readScope(input.principal, input.collection);
    if (scope.kind === "none") return { docs: [] };

    const where: string[] = ["collection = ?", "deleted = 0"];
    const args: (string | number)[] = [input.collection];
    if (scope.kind === "docIds") {
      where.push("doc_id IN (SELECT value FROM json_each(?))");
      args.push(JSON.stringify(scope.ids));
    } else if (scope.kind === "students") {
      where.push("json_extract(data, '$.studentId') IN (SELECT value FROM json_each(?))");
      args.push(JSON.stringify(scope.ids));
    } else if (scope.kind === "classes") {
      where.push("json_extract(data, '$.classId') IN (SELECT value FROM json_each(?))");
      args.push(JSON.stringify(scope.ids));
    } else if (scope.kind === "classOverlap") {
      where.push("EXISTS (SELECT 1 FROM json_each(json_extract(data, '$.classIds')) c WHERE c.value IN (SELECT value FROM json_each(?)))");
      args.push(JSON.stringify(scope.ids));
    } else if (scope.kind === "colleaguesOrClasses") {
      where.push(
        "(json_extract(data, '$.role') IN ('teacher', 'schoolAdmin') OR EXISTS (SELECT 1 FROM json_each(json_extract(data, '$.classIds')) c WHERE c.value IN (SELECT value FROM json_each(?))))",
      );
      args.push(JSON.stringify(scope.ids));
    }
    if (input.docId) {
      where.push("doc_id = ?");
      args.push(input.docId);
    }
    for (const [field, value] of Object.entries(input.filters)) {
      where.push(`json_extract(data, '$.${field}') = ?`); // field names whitelisted in index.ts
      args.push(value);
    }
    if (input.after) {
      where.push("doc_id > ?");
      args.push(input.after);
    }
    args.push(input.limit + 1);

    const rows = this.sql
      .exec<{ doc_id: string; data: string; version: number }>(
        `SELECT doc_id, data, version FROM docs WHERE ${where.join(" AND ")} ORDER BY doc_id LIMIT ?`,
        ...args,
      )
      .toArray();
    const more = rows.length > input.limit;
    const page = more ? rows.slice(0, input.limit) : rows;
    return {
      docs: page.map((r) => ({ id: r.doc_id, data: JSON.parse(r.data), version: r.version })),
      next: more ? page[page.length - 1].doc_id : undefined,
    };
  }

  /** Wipe this school's entire database (school deleted by the Super Admin). */
  async purge(): Promise<{ purged: true }> {
    await this.ctx.storage.deleteAll();
    return { purged: true };
  }

  async stats(): Promise<{ schoolId: string | null; counts: Record<string, number> }> {
    const sid = this.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = 'schoolId'").toArray()[0];
    const counts: Record<string, number> = {};
    for (const r of this.sql
      .exec<{ collection: string; n: number }>("SELECT collection, COUNT(*) AS n FROM docs WHERE deleted = 0 GROUP BY collection")
      .toArray()) {
      counts[r.collection] = r.n;
    }
    return { schoolId: sid?.value ?? null, counts };
  }
}
