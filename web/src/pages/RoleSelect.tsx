import "../landing.css";
import { ROLE_INFO, ROLES, useAuth, type Role } from "../auth";
import { useTheme } from "../context";
import { Icon, type IconName } from "../components/icons";

const ROLE_STYLE: Record<Role, { icon: IconName; tone: string; points: string[] }> = {
  superAdmin: { icon: "shield", tone: "tone-primary", points: ["Create schools", "Grant admin permissions", "Platform analytics"] },
  schoolAdmin: { icon: "school", tone: "tone-info", points: ["Staff & students", "Fees & timetable", "Teacher permissions"] },
  teacher: { icon: "teacher", tone: "tone-ok", points: ["Mark attendance", "Results & homework", "Announcements"] },
  student: { icon: "student", tone: "tone-warn", points: ["Attendance & results", "Homework & timetable", "Fees"] },
  parent: { icon: "parent", tone: "tone-bad", points: ["Your child only", "Progress & report card", "School notices"] },
};

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  { icon: "school", title: "Every school, one platform", text: "Run any number of schools from one Firebase project, each fully isolated from the others." },
  { icon: "key", title: "Permissions that flow down", text: "Super Admin → School Admin → Teacher. Each level grants exactly what the next can do." },
  { icon: "check", title: "Attendance in seconds", text: "Mark a whole class in a few taps, with daily rates and 14-day trends." },
  { icon: "award", title: "Results & report cards", text: "Record marks, see subject averages and print a graded report card." },
  { icon: "money", title: "Fees & collection", text: "Invoices, payments, overdue tracking and collection-rate charts." },
  { icon: "clock", title: "Timetable & homework", text: "Weekly class schedules and assignments with due-date tracking." },
  { icon: "upload", title: "Bulk onboarding", text: "Import students, teachers and parents from one CSV, with children linked." },
  { icon: "cloud", title: "Edge-fast reads", text: "Each school gets its own SQLite database on Cloudflare's global network." },
];

const STEPS: { icon: IconName; who: string; does: string }[] = [
  { icon: "shield", who: "Super Admin", does: "creates a school and its School Admin, and grants their permissions" },
  { icon: "school", who: "School Admin", does: "adds teachers and decides what each teacher may do" },
  { icon: "teacher", who: "Teacher", does: "adds students and parents, and links each parent to their child" },
  { icon: "parent", who: "Students & Parents", does: "see only their own (or their child's) records" },
];

/** Main page: product landing + "Who are you?" */
export function RoleSelect() {
  const { selectRole } = useAuth();
  const theme = useTheme();
  const toRoles = () => document.getElementById("roles")?.scrollIntoView({ behavior: "smooth" });

  return (
    <div className="landing-page">
      {/* ---------- nav ---------- */}
      <nav className="lp-nav">
        <div className="lp-container lp-nav-inner">
          <div className="brand" style={{ padding: 0, color: "var(--text)" }}>
            <div className="brand-logo">
              <Icon name="school" size={20} />
            </div>
            <div>
              <strong>EduSphere</strong>
              <small className="muted">Multi-school management</small>
            </div>
          </div>
          <div className="row">
            <a className="lp-link hide-sm" href="#features">
              Features
            </a>
            <a className="lp-link hide-sm" href="#how">
              How it works
            </a>
            <button className="ghost icon" onClick={theme.toggle} aria-label="Toggle dark mode">
              <Icon name={theme.isDark ? "sun" : "moon"} />
            </button>
            <button onClick={toRoles}>Sign in</button>
          </div>
        </div>
      </nav>

      {/* ---------- hero ---------- */}
      <header className="lp-hero">
        <div className="lp-container lp-hero-inner">
          <div>
            <span className="lp-badge">
              <Icon name="shield" size={14} /> Secure · Multi-school · Role-based
            </span>
            <h1 className="lp-title">
              The modern way to run <span className="lp-gradient">every school</span> you manage.
            </h1>
            <p className="lp-sub">
              Admissions, attendance, results, fees, timetable and homework in one place, for admins, teachers, students and
              parents. Each school's data is isolated from every other school.
            </p>
            <div className="row" style={{ gap: 12 }}>
              <button className="lp-cta" onClick={toRoles}>
                Get started <Icon name="arrow" size={16} />
              </button>
              <button className="secondary lp-cta" onClick={() => selectRole("superAdmin")}>
                <Icon name="shield" size={16} /> Super Admin login
              </button>
            </div>
            <div className="lp-trust">
              <span>
                <Icon name="lock" size={14} /> Data isolated per school
              </span>
              <span>
                <Icon name="cloud" size={14} /> Firebase + Cloudflare
              </span>
              <span>
                <Icon name="key" size={14} /> Granular permissions
              </span>
            </div>
          </div>

          {/* dashboard preview (decorative) */}
          <div className="lp-preview" aria-hidden="true">
            <div className="lp-window">
              <div className="lp-window-bar">
                <i />
                <i />
                <i />
                <span>Green Valley High · Overview</span>
              </div>
              <div className="lp-window-body">
                <div className="lp-mini-stats">
                  {[
                    ["Students", "1,248", "tone-primary", "student"],
                    ["Attendance", "96%", "tone-ok", "check"],
                    ["Fees collected", "82%", "tone-warn", "money"],
                  ].map(([l, v, t, i]) => (
                    <div key={l} className="lp-mini-stat">
                      <span className={`stat-icon ${t}`}>
                        <Icon name={i as IconName} size={16} />
                      </span>
                      <div>
                        <small>{l}</small>
                        <strong>{v}</strong>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="lp-chart">
                  {[62, 78, 70, 88, 92, 84, 96].map((h, i) => (
                    <div key={i} style={{ height: `${h}%` }} />
                  ))}
                </div>
                <div className="lp-rows">
                  {["Asha Rao · Present", "Ravi Kumar · Late", "Meena Iyer · Present"].map((r, i) => (
                    <div key={r}>
                      <span className="avatar" style={{ width: 24, height: 24, fontSize: "0.6rem", background: ["#6366f1", "#f59e0b", "#10b981"][i] }}>
                        {r[0]}
                      </span>
                      <span>{r.split(" · ")[0]}</span>
                      <span className={`pill ${i === 1 ? "late" : "present"}`}>{r.split(" · ")[1]}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="lp-float lp-float-1">
              <Icon name="megaphone" size={16} /> Parent-teacher meeting on Friday
            </div>
            <div className="lp-float lp-float-2">
              <Icon name="award" size={16} /> Maths average +8%
            </div>
          </div>
        </div>
      </header>

      {/* ---------- stats strip ---------- */}
      <section className="lp-container lp-strip">
        {[
          ["5", "roles with tailored dashboards"],
          ["12+", "modules from fees to homework"],
          ["1", "isolated database per school"],
          ["100%", "permission-checked by security rules"],
        ].map(([n, t]) => (
          <div key={t}>
            <strong>{n}</strong>
            <span>{t}</span>
          </div>
        ))}
      </section>

      {/* ---------- features ---------- */}
      <section id="features" className="lp-section">
        <div className="lp-container">
          <div className="lp-heading">
            <span className="lp-eyebrow">Features</span>
            <h2>Everything a school needs, nothing it doesn't</h2>
            <p>Built for the daily work of admins and teachers, and easy for students and parents to follow.</p>
          </div>
          <div className="lp-features">
            {FEATURES.map((f) => (
              <div key={f.title} className="lp-feature">
                <span className="stat-icon tone-primary">
                  <Icon name={f.icon} size={20} />
                </span>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- how it works ---------- */}
      <section id="how" className="lp-section lp-alt">
        <div className="lp-container">
          <div className="lp-heading">
            <span className="lp-eyebrow">How access works</span>
            <h2>Access is granted level by level</h2>
            <p>Nobody signs themselves up. Every account and permission is granted by the level above.</p>
          </div>
          <div className="lp-steps">
            {STEPS.map((s, i) => (
              <div key={s.who} className="lp-step">
                <div className="lp-step-num">{i + 1}</div>
                <span className="stat-icon tone-primary">
                  <Icon name={s.icon} size={20} />
                </span>
                <h3>{s.who}</h3>
                <p>{s.does}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- roles ---------- */}
      <section id="roles" className="lp-section">
        <div className="lp-container">
          <div className="lp-heading">
            <span className="lp-eyebrow">Sign in</span>
            <h2>Who are you?</h2>
            <p>Choose your role to continue. If you pick a role that doesn't match your account, access is denied.</p>
          </div>
          <div className="role-grid">
            {ROLES.map((r) => (
              <button key={r} className="role-card" onClick={() => selectRole(r)}>
                <span className={`role-icon ${ROLE_STYLE[r].tone}`}>
                  <Icon name={ROLE_STYLE[r].icon} size={26} />
                </span>
                <strong>{ROLE_INFO[r].label}</strong>
                <small>{ROLE_INFO[r].blurb}</small>
                <ul className="role-points">
                  {ROLE_STYLE[r].points.map((p) => (
                    <li key={p}>
                      <Icon name="check" size={13} /> {p}
                    </li>
                  ))}
                </ul>
                <span className="role-go">
                  Continue <Icon name="arrow" size={14} />
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- footer ---------- */}
      <footer className="lp-footer">
        <div className="lp-container lp-footer-inner">
          <div className="brand" style={{ padding: 0, color: "var(--text)" }}>
            <div className="brand-logo" style={{ width: 30, height: 30 }}>
              <Icon name="school" size={16} />
            </div>
            <strong>EduSphere</strong>
          </div>
          <span className="muted small-print">Firebase (Auth, Firestore, Hosting) · Cloudflare Workers + SQLite per school</span>
          <span className="muted small-print">© {new Date().getFullYear()} EduSphere</span>
        </div>
      </footer>
    </div>
  );
}
