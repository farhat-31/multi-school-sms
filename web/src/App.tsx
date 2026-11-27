import { useAuth } from "./auth";
import { WorkspaceProvider } from "./context";
import { Shell } from "./shell/Shell";
import { RoleSelect } from "./pages/RoleSelect";
import { Login } from "./pages/Login";
import { NoAccess, RoleMismatch } from "./pages/AccessCheck";

/**
 * 1. "Who are you?"   2. Sign in (username/email + password; Google for Super Admin only)
 * 3. Account must exist & be active (created by the level above)
 * 4. Role must match the one chosen   5. App shell with a page per feature
 */
export function App() {
  const { loading, user, profile, selectedRole } = useAuth();
  const wait = <div className="auth muted">Loading…</div>;

  if (loading) return wait;
  if (!selectedRole) return <RoleSelect />;
  if (!user) return <Login />;
  if (profile === undefined) return wait;
  if (profile === null || profile.status !== "active" || !profile.role) return <NoAccess />;
  // Family login: a parent's login may also open the Student portal (their children only).
  const familyStudent = selectedRole === "student" && profile.role === "parent";
  if (profile.role !== selectedRole && !familyStudent) return <RoleMismatch />;

  return (
    <WorkspaceProvider>
      <Shell />
    </WorkspaceProvider>
  );
}
