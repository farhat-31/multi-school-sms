import { Suspense, useEffect, useState, type ReactElement } from "react";
import { ROLE_INFO, useAuth } from "../auth";
import { useCaps, useTheme, useWorkspace } from "../context";
import { navigate, useRoute } from "../router";
import { Icon, type IconName } from "../components/icons";
import { Avatar, Empty, fmt } from "../components/ui";
import { ErrorBoundary } from "../components/feedback";
import { NotificationBell } from "./NotificationBell";
import { displayLogin } from "../people-actions";
import * as P from "../pages";

interface NavItem {
  id: string;
  label: string;
  icon: IconName;
  page: () => ReactElement;
}
interface NavGroup {
  group: string;
  items: NavItem[];
}

/** Builds the sidebar for the signed-in role, honouring granted permissions. */
function useNav(): NavGroup[] {
  const caps = useCaps();
  const { selectedRole } = useAuth();
  const { schoolId } = useWorkspace();
  const groups: NavGroup[] = [];
  const item = (id: string, label: string, icon: IconName, page: () => ReactElement, show = true) => (show ? [{ id, label, icon, page }] : []);

  if (caps.isSuper) {
    groups.push({
      group: "Platform",
      items: [
        ...item("platform", "Platform overview", "chart", () => <P.PlatformOverview />),
        ...item("schools", "Schools", "school", () => <P.SchoolsPage />),
        ...item("admins", "School Admins", "shield", () => <P.AdminPermissionsPage />),
        ...item("cloud", "Cloudflare sync", "cloud", () => <P.CloudPage />),
      ],
    });
  }

  if (caps.isStaff && schoolId) {
    groups.push({ group: caps.isSuper ? "Selected school" : "Dashboard", items: item("overview", "Overview", "home", () => <P.SchoolOverview />) });
    groups.push({
      group: "People",
      items: [
        ...item("students", "Students", "student", () => <P.PeopleList role="student" />),
        ...item("teachers", "Teachers", "teacher", () => <P.PeopleList role="teacher" />),
        ...item("parents", "Parents", "parent", () => <P.PeopleList role="parent" />),
        ...item("add-people", "Add people", "upload", () => <P.AddPeoplePage />, caps.addStudents || caps.addParents || caps.addTeachers),
        ...item("teacher-permissions", "Teacher permissions", "key", () => <P.TeacherPermissionsPage />, caps.grantTeachers),
      ],
    });
    groups.push({
      group: "Academics",
      items: [
        ...item("classes", "Classes", "layers", () => <P.ClassesPage />),
        ...item("timetable", "Timetable", "clock", () => <P.TimetablePage />),
        ...item("attendance", "Attendance", "check", () => <P.AttendancePage />),
        ...item("exams", "Exams & results", "award", () => <P.ExamsPage />),
        ...item("homework", "Homework", "book", () => <P.HomeworkPage />),
      ],
    });
    groups.push({
      group: "Finance & comms",
      items: [
        ...item("fees", "Fees", "money", () => <P.FeesPage />, caps.fees),
        ...item("announcements", "Announcements", "megaphone", () => <P.AnnouncementsPage />),
        ...item("settings", "School profile", "settings", () => <P.SchoolSettingsPage />, caps.isAdmin),
      ],
    });
  }

  if (caps.isFamily && schoolId) {
    groups.push({
      group: caps.role === "parent" && selectedRole !== "student" ? "My child" : "My school",
      items: [
        ...item("overview", "Overview", "home", () => <P.MyOverview />),
        ...item("attendance", "Attendance", "check", () => <P.MyAttendance />),
        ...item("results", "Results", "award", () => <P.MyResults />),
        ...item("fees", "Fees", "money", () => <P.MyFees />),
        ...item("homework", "Homework", "book", () => <P.HomeworkPage />),
        ...item("timetable", "Timetable", "clock", () => <P.TimetablePage />),
        ...item("announcements", "Announcements", "megaphone", () => <P.AnnouncementsPage />),
      ],
    });
  }

  groups.push({ group: "Account", items: item("account", "My account", "settings", () => <P.AccountPage />) });
  return groups.filter((g) => g.items.length);
}

export function Shell() {
  const { profile, user, logout, selectedRole } = useAuth();
  const ws = useWorkspace();
  const caps = useCaps();
  const theme = useTheme();
  const route = useRoute();
  const nav = useNav();
  const [open, setOpen] = useState(false);

  const all = nav.flatMap((g) => g.items);
  const current = all.find((i) => i.id === route) ?? all[0];

  const currentId = current?.id;
  useEffect(() => {
    if (currentId && currentId !== route) navigate(currentId);
    setOpen(false);
    window.scrollTo(0, 0);
  }, [currentId, route]);

  useEffect(() => {
    const label = all.find((i) => i.id === currentId)?.label;
    document.title = [label, ws.school ? fmt(ws.school.name) : null, "EduSphere"].filter(Boolean).join(" · ");
  });

  const name = profile?.displayName || displayLogin(user?.email ?? "");

  return (
    <div className={`shell ${open ? "open" : ""}`}>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo">
            <Icon name="school" size={20} />
          </div>
          <div>
            <strong>EduSphere</strong>
            <small>Multi-school management</small>
          </div>
        </div>
        {nav.map((g) => (
          <div key={g.group}>
            <div className="nav-group">{g.group}</div>
            {g.items.map((i) => (
              <a key={i.id} href={`#/${i.id}`} className={`nav-item ${current?.id === i.id ? "active" : ""}`}>
                <Icon name={i.icon} />
                {i.label}
              </a>
            ))}
          </div>
        ))}
        {caps.isSuper && !ws.schoolId && (
          <p className="small-print" style={{ color: "var(--sidebar-muted)", padding: "10px" }}>
            Select a school in the top bar to manage its people, classes and records.
          </p>
        )}
        <div className="sidebar-footer">
          <div className="me">
            <Avatar name={name} />
            <div>
              <strong>{name}</strong>
              <small>
                {profile ? (profile.role === "parent" && selectedRole === "student" ? "Student (family login)" : ROLE_INFO[profile.role].label) : ""}
              </small>
            </div>
          </div>
          <button className="ghost" onClick={logout}>
            <Icon name="logout" /> Sign out
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="ghost icon menu-btn" onClick={() => setOpen(true)} aria-label="Open menu">
            <Icon name="menu" />
          </button>
          <div className="grow crumbs">
            {ws.school ? <strong>{fmt(ws.school.name)}</strong> : caps.isSuper ? <strong>All schools</strong> : null}
            {current && <span className="hide-sm"> · {current.label}</span>}
          </div>
          {caps.isSuper && (
            <select value={ws.schoolId ?? ""} onChange={(e) => ws.setSchoolId(e.target.value || undefined)} aria-label="Select school">
              <option value="">— Select a school —</option>
              {ws.schools.map((s) => (
                <option key={s.id} value={s.id}>
                  {fmt(s.name)} ({s.id})
                </option>
              ))}
            </select>
          )}
          {caps.role === "parent" && ws.children.length > 1 && (
            <select value={ws.studentId ?? ""} onChange={(e) => ws.setChildId(e.target.value)} aria-label="Select child">
              {ws.children.map((c) => (
                <option key={c.id} value={c.id}>
                  {fmt(c.displayName)}
                </option>
              ))}
            </select>
          )}
          {ws.schoolId && <NotificationBell />}
          <button className="ghost icon" onClick={theme.toggle} aria-label="Toggle dark mode" title="Toggle dark mode">
            <Icon name={theme.isDark ? "sun" : "moon"} />
          </button>
        </header>
        <main className="content">
          {current ? (
            <ErrorBoundary key={`${current.id}:${ws.schoolId}:${ws.studentId}`}>
              <Suspense fallback={<div className="skeleton" style={{ height: 240 }} />}>{current.page()}</Suspense>
            </ErrorBoundary>
          ) : (
            <Empty icon="school" title="Nothing here yet" />
          )}
        </main>
      </div>
    </div>
  );
}
