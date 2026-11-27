import type { ReactNode } from "react";
import { ROLE_INFO, useAuth } from "../auth";
import { Card } from "../components/ui";

function Shell({ children }: { children: ReactNode }) {
  const { logout, user } = useAuth();
  return (
    <div className="auth">
      <div className="auth-card">
        {children}
        <p className="muted small-print">
          Signed in as {user?.email} ·{" "}
          <button className="link" onClick={logout}>
            Sign out
          </button>
        </p>
      </div>
    </div>
  );
}

/** Login exists but there is no active profile for it. */
export function NoAccess() {
  const { profile, selectedRole } = useAuth();
  return (
    <Shell>
      <Card title="🚫 No access">
        <p>
          {profile?.status === "disabled"
            ? "This account has been disabled."
            : "This login has not been given access to any school."}
        </p>
        <p className="muted">Contact {ROLE_INFO[selectedRole!].createdBy}.</p>
      </Card>
    </Shell>
  );
}

/** Active, but as a different role than the one picked on the main page. */
export function RoleMismatch() {
  const { profile, selectedRole, selectRole } = useAuth();
  return (
    <Shell>
      <Card title="🚫 Access denied">
        <p>
          You chose <strong>{ROLE_INFO[selectedRole!].label}</strong>, but this account is a{" "}
          <strong>{ROLE_INFO[profile!.role].label}</strong>
          {profile!.schoolId ? ` (${profile!.schoolId})` : ""}.
        </p>
        <div className="row">
          <button onClick={() => selectRole(profile!.role)}>Continue as {ROLE_INFO[profile!.role].label}</button>
          <button className="secondary" onClick={() => selectRole(null)}>
            Back
          </button>
        </div>
      </Card>
    </Shell>
  );
}
