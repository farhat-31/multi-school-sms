import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "./firebase";

export type Role = "superAdmin" | "schoolAdmin" | "teacher" | "student" | "parent";
export const ROLES: Role[] = ["superAdmin", "schoolAdmin", "teacher", "student", "parent"];

export const ROLE_INFO: Record<Role, { label: string; icon: string; blurb: string; createdBy: string }> = {
  superAdmin: { label: "Super Admin", icon: "🛡️", blurb: "Manage all schools", createdBy: "the system" },
  schoolAdmin: { label: "School Admin", icon: "🏫", blurb: "Run your own school", createdBy: "the Super Admin" },
  teacher: { label: "Teacher", icon: "👩‍🏫", blurb: "Classes, attendance, exams", createdBy: "your School Admin" },
  student: { label: "Student", icon: "🎓", blurb: "Your attendance, results, fees", createdBy: "your Teacher or School Admin" },
  parent: { label: "Parent", icon: "👪", blurb: "Your children's progress", createdBy: "your Teacher or School Admin" },
};

/** What a Super Admin can grant a School Admin (all granted by default). */
export const PERMISSIONS = [
  { id: "people", label: "People (teachers, students, parents)" },
  { id: "classes", label: "Classes" },
  { id: "attendance", label: "Attendance" },
  { id: "fees", label: "Fees" },
  { id: "exams", label: "Exams" },
  { id: "announcements", label: "Announcements" },
] as const;
export type Permission = (typeof PERMISSIONS)[number]["id"];

/** What a School Admin can grant a Teacher (all granted by default). */
export const TEACHER_PERMISSIONS = [
  { id: "students", label: "Manage students" },
  { id: "parents", label: "Manage parents" },
  { id: "attendance", label: "Attendance" },
  { id: "exams", label: "Exams" },
  { id: "homework", label: "Homework" },
  { id: "announcements", label: "Announcements" },
] as const;

/** Has this profile been granted `perm`? (missing = granted) */
export const granted = (p: { permissions?: Record<string, boolean> } | null | undefined, perm: string) =>
  p?.permissions?.[perm] !== false;

/** Firestore users/{uid}: created by the level above (no self sign-up). */
export interface Profile {
  uid: string;
  email: string;
  displayName?: string;
  role: Role;
  status: "active" | "disabled";
  schoolId?: string;
  classId?: string;
  /** Teacher: assigned classes. Parent (family login): their children's classes. */
  classIds?: string[];
  childIds?: string[];
  phone?: string;
  permissions?: Record<string, boolean>;
  createdBy?: string;
}

interface AuthState {
  loading: boolean;
  user: User | null;
  profile: Profile | null | undefined; // undefined = still loading
  selectedRole: Role | null;
  selectRole: (r: Role | null) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

function storedRole(): Role | null {
  try {
    const r = localStorage.getItem("selectedRole") as Role | null;
    return r && ROLES.includes(r) ? r : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const [selectedRole, setSelectedRole] = useState<Role | null>(storedRole);

  useEffect(
    () =>
      onAuthStateChanged(auth, (u) => {
        setUser(u);
        setProfile(undefined);
        setLoading(false);
      }),
    [],
  );

  // Live profile: access changes (disable / role) apply immediately.
  useEffect(() => {
    if (!user) return;
    return onSnapshot(
      doc(db, "users", user.uid),
      (snap) => setProfile(snap.exists() ? (snap.data() as Profile) : null),
      () => setProfile(null),
    );
  }, [user]);

  const selectRole = useCallback((r: Role | null) => {
    setSelectedRole(r);
    try {
      if (r) localStorage.setItem("selectedRole", r);
      else localStorage.removeItem("selectedRole");
    } catch {
      /* storage unavailable */
    }
  }, []);

  const logout = useCallback(async () => {
    await signOut(auth);
    selectRole(null);
  }, [selectRole]);

  return (
    <AuthContext.Provider value={{ loading, user, profile, selectedRole, selectRole, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}

/** For components rendered only for an active user. */
export function useSession() {
  const { user, profile } = useAuth();
  if (!user || !profile || profile.status !== "active" || !profile.role) throw new Error("No active session");
  return { user, profile, role: profile.role, schoolId: profile.schoolId };
}
