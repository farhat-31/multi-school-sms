import type { SchoolReplica } from "./school-replica";

export interface Env {
  SCHOOL_REPLICA: DurableObjectNamespace<SchoolReplica>;
  FIREBASE_PROJECT_ID: string;
  ALLOWED_ORIGINS: string;
}

export type Role = "superAdmin" | "schoolAdmin" | "teacher" | "student" | "parent";

/** An APPROVED user, as read from Firestore users/{uid}. */
export interface Principal {
  uid: string;
  role: Role;
  schoolId?: string;
  childIds: string[];
  classIds: string[]; // teacher: assigned classes; parent: children's classes
  classId?: string; // legacy student account: own class
  permissions: Record<string, boolean>; // School Admin permissions granted by the Super Admin
  idToken: string; // used to read Firestore on the user's behalf (rules apply)
}

export interface ReplicaChange {
  collection: string;
  docId: string;
  op: "upsert" | "delete";
  data: Record<string, unknown> | null;
  version: number;
}

/** Collections the replica stores. `_school` = the school doc itself. */
export const REPLICATED_COLLECTIONS = [
  "_school",
  "users",
  "students",
  "teachers",
  "parents",
  "classes",
  "attendance",
  "fees",
  "exams",
  "announcements",
  "timetable",
  "homework",
] as const;
export type ReplicatedCollection = (typeof REPLICATED_COLLECTIONS)[number];
export const SCHOOL_SUBCOLLECTIONS = REPLICATED_COLLECTIONS.filter((c) => c !== "_school" && c !== "users");

export const SCHOOL_ID_RE = /^school_[a-z0-9_]{1,40}$/;
export const DOC_ID_RE = /^[^/]{1,1500}$/;

/** Fields clients may filter on with ?field=value. */
export const FILTERABLE_FIELDS = ["studentId", "classId", "date", "audience", "status"] as const;
