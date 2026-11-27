import { collection, deleteDoc, doc, getDoc, serverTimestamp, writeBatch } from "firebase/firestore";
import { db, loginEmail } from "./firebase";
import { createAccount } from "./accounts";
import { TEACHER_PERMISSIONS, type Role } from "./auth";
import { syncToReplica, type Row } from "./data";

/** Show "greenvalley" instead of greenvalley@<project>.firebaseapp.com */
export const displayLogin = (email: string) => email.replace(/@[^@]+\.firebaseapp\.com$/, "");

export const PROFILE_COL: Partial<Record<Role, string>> = { teacher: "teachers", student: "students", parent: "parents" };

const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];

/* ============================ Teachers ============================ */
export async function createTeacher(p: {
  schoolId: string;
  creatorUid: string;
  name: string;
  login: string;
  password: string;
  subject?: string;
  classIds: string[];
}): Promise<string> {
  const email = loginEmail(p.login);
  const uid = await createAccount(email, p.password, p.name, async (newUid) => {
    const b = writeBatch(db);
    b.set(doc(db, "users", newUid), {
      uid: newUid,
      email,
      displayName: p.name,
      role: "teacher",
      schoolId: p.schoolId,
      status: "active",
      classIds: uniq(p.classIds),
      permissions: Object.fromEntries(TEACHER_PERMISSIONS.map((t) => [t.id, true])),
      createdBy: p.creatorUid,
      createdAt: serverTimestamp(),
    });
    b.set(doc(db, "schools", p.schoolId, "teachers", newUid), {
      uid: newUid,
      schoolId: p.schoolId,
      displayName: p.name,
      email,
      subject: p.subject ?? "",
      classIds: uniq(p.classIds),
      createdAt: serverTimestamp(),
    });
    await b.commit();
  });
  await syncToReplica(p.schoolId, [
    { collection: "users", docId: uid },
    { collection: "teachers", docId: uid },
  ]);
  return uid;
}

/** School Admin: set which classes a teacher is assigned to (class isolation). */
export async function setTeacherClasses(schoolId: string, teacherUid: string, classIds: string[]) {
  const b = writeBatch(db);
  b.update(doc(db, "users", teacherUid), { classIds: uniq(classIds) });
  b.set(doc(db, "schools", schoolId, "teachers", teacherUid), { classIds: uniq(classIds), schoolId }, { merge: true });
  await b.commit();
  await syncToReplica(schoolId, [
    { collection: "users", docId: teacherUid },
    { collection: "teachers", docId: teacherUid },
  ]);
}

/* ============================ Families ============================ */
/**
 * A FAMILY = one student + their parent sharing ONE login (the parent account).
 * Both are always created together: a student can't exist without a parent and
 * a parent can't exist without a student. Choosing "Student" or "Parent" on the
 * login page with the family login opens the matching portal.
 */
export async function createFamily(p: {
  schoolId: string;
  creatorUid: string;
  studentName: string;
  classId: string;
  parentName: string;
  phone?: string;
  login: string;
  password: string;
}): Promise<{ parentUid: string; studentId: string }> {
  if (!p.classId) throw new Error("Pick the student's class.");
  if (!p.parentName.trim()) throw new Error("A parent is required for every student.");
  const email = loginEmail(p.login);
  const studentRef = doc(collection(db, "schools", p.schoolId, "students"));
  const parentUid = await createAccount(email, p.password, p.parentName, async (uid) => {
    const b = writeBatch(db);
    b.set(doc(db, "users", uid), {
      uid,
      email,
      displayName: p.parentName,
      phone: p.phone ?? "",
      role: "parent",
      schoolId: p.schoolId,
      status: "active",
      childIds: [studentRef.id],
      classIds: [p.classId],
      createdBy: p.creatorUid,
      createdAt: serverTimestamp(),
    });
    b.set(doc(db, "schools", p.schoolId, "parents", uid), {
      uid,
      schoolId: p.schoolId,
      displayName: p.parentName,
      email,
      phone: p.phone ?? "",
      childIds: [studentRef.id],
      classIds: [p.classId],
      createdAt: serverTimestamp(),
    });
    b.set(studentRef, {
      studentId: studentRef.id,
      schoolId: p.schoolId,
      displayName: p.studentName,
      classId: p.classId,
      familyLogin: email,
      parentUid: uid,
      parentName: p.parentName,
      createdAt: serverTimestamp(),
    });
    await b.commit();
  });
  await syncToReplica(p.schoolId, [
    { collection: "users", docId: parentUid },
    { collection: "parents", docId: parentUid },
    { collection: "students", docId: studentRef.id },
  ]);
  return { parentUid, studentId: studentRef.id };
}

/** Add another child to an existing family (same login). */
export async function addSibling(p: { schoolId: string; parentUid: string; studentName: string; classId: string }) {
  if (!p.classId) throw new Error("Pick the student's class.");
  const parentSnap = await getDoc(doc(db, "users", p.parentUid));
  if (!parentSnap.exists()) throw new Error("Family not found.");
  const parent = parentSnap.data();
  const childIds: string[] = parent.childIds ?? [];
  if (childIds.length >= 10) throw new Error("A family can have at most 10 children.");
  const studentRef = doc(collection(db, "schools", p.schoolId, "students"));
  const newChildIds = [...childIds, studentRef.id];
  const newClassIds = uniq([...(parent.classIds ?? []), p.classId]);
  const b = writeBatch(db);
  b.set(studentRef, {
    studentId: studentRef.id,
    schoolId: p.schoolId,
    displayName: p.studentName,
    classId: p.classId,
    familyLogin: parent.email,
    parentUid: p.parentUid,
    parentName: parent.displayName ?? "",
    createdAt: serverTimestamp(),
  });
  b.update(doc(db, "users", p.parentUid), { childIds: newChildIds, classIds: newClassIds });
  b.set(doc(db, "schools", p.schoolId, "parents", p.parentUid), { childIds: newChildIds, classIds: newClassIds, schoolId: p.schoolId }, { merge: true });
  await b.commit();
  await syncToReplica(p.schoolId, [
    { collection: "students", docId: studentRef.id },
    { collection: "users", docId: p.parentUid },
    { collection: "parents", docId: p.parentUid },
  ]);
  return studentRef.id;
}

/**
 * Remove a student. Their parent stays only if other children remain;
 * a parent with no children is removed too (no parent without a student).
 */
export async function removeStudent(schoolId: string, student: Row): Promise<"student" | "family"> {
  const parentUid = student.parentUid as string | undefined;
  await deleteDoc(doc(db, "schools", schoolId, "students", student.id));
  const items = [{ collection: "students", docId: student.id }];
  let removed: "student" | "family" = "student";
  if (parentUid) {
    const snap = await getDoc(doc(db, "users", parentUid));
    if (snap.exists()) {
      const remaining = ((snap.get("childIds") as string[]) ?? []).filter((c) => c !== student.id);
      const b = writeBatch(db);
      if (!remaining.length) {
        b.delete(doc(db, "users", parentUid));
        b.delete(doc(db, "schools", schoolId, "parents", parentUid));
        removed = "family";
      } else {
        // recompute classes from the remaining children
        const kids = await Promise.all(remaining.map((id) => getDoc(doc(db, "schools", schoolId, "students", id)).catch(() => null)));
        // If a sibling is in a class this user can't see, keep the family's existing classes.
        const classIds = kids.every((k) => k)
          ? uniq(kids.map((k) => (k!.exists() ? (k!.get("classId") as string) : "")))
          : ((snap.get("classIds") as string[]) ?? []);
        b.update(doc(db, "users", parentUid), { childIds: remaining, classIds });
        b.set(doc(db, "schools", schoolId, "parents", parentUid), { childIds: remaining, classIds, schoolId }, { merge: true });
      }
      await b.commit();
      items.push({ collection: "users", docId: parentUid }, { collection: "parents", docId: parentUid });
    }
  }
  await syncToReplica(schoolId, items);
  return removed;
}

/** Give an existing student (with no parent) a parent + family login. */
export async function attachParent(p: {
  schoolId: string;
  creatorUid: string;
  student: Row;
  parentName: string;
  phone?: string;
  login: string;
  password: string;
}): Promise<string> {
  const email = loginEmail(p.login);
  const classIds = uniq([String(p.student.classId ?? "")]);
  const parentUid = await createAccount(email, p.password, p.parentName, async (uid) => {
    const b = writeBatch(db);
    b.set(doc(db, "users", uid), {
      uid,
      email,
      displayName: p.parentName,
      phone: p.phone ?? "",
      role: "parent",
      schoolId: p.schoolId,
      status: "active",
      childIds: [p.student.id],
      classIds,
      createdBy: p.creatorUid,
      createdAt: serverTimestamp(),
    });
    b.set(doc(db, "schools", p.schoolId, "parents", uid), {
      uid, schoolId: p.schoolId, displayName: p.parentName, email, phone: p.phone ?? "", childIds: [p.student.id], classIds, createdAt: serverTimestamp(),
    });
    b.set(doc(db, "schools", p.schoolId, "students", p.student.id), { familyLogin: email, parentUid: uid, parentName: p.parentName, schoolId: p.schoolId }, { merge: true });
    await b.commit();
  });
  await syncToReplica(p.schoolId, [
    { collection: "users", docId: parentUid },
    { collection: "parents", docId: parentUid },
    { collection: "students", docId: p.student.id },
  ]);
  return parentUid;
}
