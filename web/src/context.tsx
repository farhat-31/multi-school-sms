import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "./firebase";
import { granted, useAuth, type Role } from "./auth";
import { getOne, plain, useDocs, useSource, type Row } from "./data";
import { fmt } from "./components/ui";

/* ----------------------------- theme ----------------------------- */
type Theme = "light" | "dark" | "system";
function applyTheme(t: Theme) {
  if (t === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
}
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem("theme") as Theme) || "system";
    } catch {
      return "system";
    }
  });
  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem("theme", theme);
    } catch {
      /* ignore */
    }
  }, [theme]);
  const isDark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  return { isDark, toggle: () => setTheme(isDark ? "light" : "dark") };
}

/* ----------------------------- workspace ----------------------------- */
interface Workspace {
  /** The school being viewed (fixed for school roles; chosen by the Super Admin). */
  schoolId?: string;
  setSchoolId: (id: string | undefined) => void;
  school: Row | null;
  schools: Row[];
  reloadSchools: () => Promise<void>;
  /** Parent: which child is selected. Student: themself. */
  studentId?: string;
  setChildId: (id: string) => void;
  children: Row[];
  /** The selected student's class (for timetable / homework). */
  studentClassId?: string;
}

const WorkspaceContext = createContext<Workspace | null>(null);

export function WorkspaceProvider({ children: kids }: { children: ReactNode }) {
  const { profile, user } = useAuth();
  const { source } = useSource();
  const role = profile?.role;
  const [schools, setSchools] = useState<Row[]>([]);
  const [chosen, setChosen] = useState<string | undefined>(() => {
    try {
      return localStorage.getItem("activeSchool") ?? undefined;
    } catch {
      return undefined;
    }
  });
  const [school, setSchool] = useState<Row | null>(null);
  const [childRows, setChildRows] = useState<Row[]>([]);
  const [childId, setChildId] = useState<string>("");

  const reloadSchools = useCallback(async () => {
    if (role !== "superAdmin") return;
    const snap = await getDocs(collection(db, "schools"));
    setSchools(snap.docs.map((d) => ({ ...(plain(d.data()) as object), id: d.id })).sort((a, b) => a.id.localeCompare(b.id)));
  }, [role]);

  useEffect(() => {
    void reloadSchools();
  }, [reloadSchools]);

  const schoolId = role === "superAdmin" ? (chosen && schools.some((s) => s.id === chosen) ? chosen : undefined) : profile?.schoolId;

  const setSchoolId = (id: string | undefined) => {
    setChosen(id);
    try {
      if (id) localStorage.setItem("activeSchool", id);
      else localStorage.removeItem("activeSchool");
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (!schoolId) return setSchool(null);
    getOne(source, schoolId).then(setSchool, () => setSchool(null));
  }, [schoolId, source]);

  const childKey = (profile?.childIds ?? []).join(",");
  useEffect(() => {
    if (role !== "parent" || !schoolId) return;
    const ids = childKey ? childKey.split(",") : [];
    Promise.all(ids.map((id) => getOne(source, schoolId, "students", id).catch(() => null))).then((rows) => {
      const found = rows.filter((r): r is Row => !!r);
      setChildRows(found);
      setChildId((cur) => (found.some((c) => c.id === cur) ? cur : found[0]?.id ?? ""));
    });
  }, [role, schoolId, childKey, source]);

  const studentId = role === "student" ? user?.uid : role === "parent" ? childId || undefined : undefined;
  const studentClassId =
    role === "student" ? profile?.classId : role === "parent" ? (childRows.find((c) => c.id === childId)?.classId as string | undefined) : undefined;

  const value = useMemo<Workspace>(
    () => ({ schoolId, setSchoolId, school, schools, reloadSchools, studentId, setChildId, children: childRows, studentClassId }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [schoolId, school, schools, reloadSchools, studentId, childRows, studentClassId],
  );
  return <WorkspaceContext.Provider value={value}>{kids}</WorkspaceContext.Provider>;
}

export function useWorkspace(): Workspace {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace outside provider");
  return ctx;
}

/* ----------------------------- capabilities ----------------------------- */
/** What the signed-in user may do, from the permissions granted down the chain. */
export function useCaps() {
  const { profile } = useAuth();
  const role = profile?.role as Role | undefined;
  const admin = (perm: string) => role === "superAdmin" || (role === "schoolAdmin" && granted(profile, perm));
  const teacher = (perm: string) => role === "teacher" && granted(profile, perm);
  return {
    role,
    isSuper: role === "superAdmin",
    isAdmin: role === "schoolAdmin" || role === "superAdmin",
    isTeacher: role === "teacher",
    isStaff: role === "schoolAdmin" || role === "teacher" || role === "superAdmin",
    isFamily: role === "student" || role === "parent",
    addTeachers: admin("people"),
    addStudents: admin("people") || teacher("students"),
    addParents: admin("people") || teacher("parents"),
    /** Student + parent are always added together, so both permissions are needed. */
    addFamilies: admin("people") || (teacher("students") && teacher("parents")),
    /** Teacher: the classes assigned by the School Admin (class isolation). */
    myClassIds: role === "teacher" ? profile?.classIds ?? [] : undefined,
    grantTeachers: admin("people"),
    classes: admin("classes"),
    attendance: admin("attendance") || teacher("attendance"),
    fees: admin("fees"),
    exams: admin("exams") || teacher("exams"),
    homework: admin("classes") || teacher("homework"),
    announce: admin("announcements") || teacher("announcements"),
  };
}

/** Classes this user may work with: all for admins, only assigned classes for teachers. */
export function useMyClasses() {
  const { schoolId } = useWorkspace();
  const { profile } = useAuth();
  const all = useDocs(schoolId, "classes");
  const mine = profile?.role === "teacher" ? all.rows.filter((c) => (profile.classIds ?? []).includes(c.id)) : all.rows;
  const name = (id: unknown) => fmt(all.rows.find((c) => c.id === id)?.name ?? id);
  return { classes: mine, all: all.rows, name, reload: all.reload, loading: all.loading };
}
