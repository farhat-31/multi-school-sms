/**
 * Read policy for the replica - mirrors firestore.rules, so the replica can
 * never reveal more than Firestore itself would. (School isolation is enforced
 * before this in index.ts, and physically by the per-school Durable Object.)
 *
 * Class isolation: teachers only see their assigned classes; families only see
 * their own children's class homework and timetable.
 */
import type { Principal, ReplicatedCollection } from "./types";

export type Scope =
  | { kind: "all" }
  | { kind: "none" }
  | { kind: "docIds"; ids: string[] } // only these document ids
  | { kind: "students"; ids: string[] } // data.studentId in ids
  | { kind: "classes"; ids: string[] } // data.classId in ids
  | { kind: "classOverlap"; ids: string[] } // data.classIds shares an id with ids
  | { kind: "colleaguesOrClasses"; ids: string[] }; // users: teachers/admins, or families of these classes

export type PolicyPrincipal = Pick<Principal, "uid" | "role" | "childIds" | "permissions" | "classIds" | "classId">;

export function readScope(p: PolicyPrincipal, collection: ReplicatedCollection): Scope {
  if (p.role === "superAdmin") return { kind: "all" };
  const admin = p.role === "schoolAdmin";
  const teacher = p.role === "teacher";
  const myClasses: Scope = { kind: "classes", ids: p.classIds };
  const familyClasses: Scope = { kind: "classes", ids: p.role === "student" ? (p.classId ? [p.classId] : []) : p.classIds };
  const own = (): Scope =>
    p.role === "student" ? { kind: "students", ids: [p.uid] } : p.role === "parent" ? { kind: "students", ids: p.childIds } : { kind: "none" };

  switch (collection) {
    case "_school":
    case "teachers":
    case "classes":
    case "announcements":
      return { kind: "all" };
    case "timetable":
    case "homework":
      return admin ? { kind: "all" } : teacher ? myClasses : familyClasses;
    case "students":
      if (admin) return { kind: "all" };
      if (teacher) return myClasses;
      if (p.role === "student") return { kind: "docIds", ids: [p.uid] };
      return { kind: "docIds", ids: p.childIds };
    case "parents":
      if (admin) return { kind: "all" };
      if (teacher) return { kind: "classOverlap", ids: p.classIds };
      if (p.role === "parent") return { kind: "docIds", ids: [p.uid] };
      return { kind: "none" };
    case "attendance":
    case "exams":
      return admin ? { kind: "all" } : teacher ? myClasses : own();
    case "fees":
      if (admin) return p.permissions.fees === false ? { kind: "none" } : { kind: "all" };
      return teacher ? { kind: "none" } : own();
    case "users":
      if (admin) return { kind: "all" };
      if (teacher) return { kind: "colleaguesOrClasses", ids: p.classIds };
      return { kind: "docIds", ids: [p.uid] };
  }
}
