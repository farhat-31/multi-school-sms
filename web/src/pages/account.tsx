import { EmailAuthProvider, reauthenticateWithCredential, updatePassword, updateProfile } from "firebase/auth";
import { ROLE_INFO, useSession } from "../auth";
import { displayLogin } from "../people-actions";
import { useWorkspace } from "../context";
import { Avatar, Card, PageHeader, Pill, SimpleForm, fmt } from "../components/ui";

/** Profile + change password (works for every role, including the Super Admin "admin"). */
export function AccountPage() {
  const { user, profile } = useSession();
  const { school } = useWorkspace();
  const isGoogle = user.providerData.some((p) => p.providerId === "google.com");
  const name = profile.displayName ?? user.displayName ?? user.email ?? "";

  return (
    <>
      <PageHeader title="My account" subtitle="Your profile and sign-in" />
      <div className="grid">
        <Card title="Profile">
          <div className="row" style={{ gap: 16, marginBottom: 16 }}>
            <div style={{ transform: "scale(1.6)", transformOrigin: "left center", marginRight: 18 }}>
              <Avatar name={name} />
            </div>
            <div>
              <h2>{name}</h2>
              <div className="muted">{displayLogin(user.email ?? "")}</div>
            </div>
          </div>
          <div className="stack" style={{ gap: 10 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="muted">Role</span>
              <Pill tone="primary">{ROLE_INFO[profile.role].label}</Pill>
            </div>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="muted">School</span>
              <strong>{profile.schoolId ? `${fmt(school?.name)} (${profile.schoolId})` : "All schools"}</strong>
            </div>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="muted">Sign-in</span>
              <strong>{isGoogle ? "Google" : "Username & password"}</strong>
            </div>
          </div>
        </Card>
        {isGoogle ? (
          <Card title="Password">
            <p className="muted">You sign in with Google, so your password is managed by your Google account.</p>
          </Card>
        ) : (
          <Card title="Change password" subtitle="Use at least 8 characters with letters, numbers and a symbol.">
            <SimpleForm
              submitLabel="Update password"
              fields={[
                { name: "current", label: "Current password", type: "password", required: true },
                { name: "next", label: "New password", type: "password", required: true },
                { name: "confirm", label: "Confirm new password", type: "password", required: true },
              ]}
              onSubmit={async (v) => {
                const next = String(v.next);
                if (next.length < 8) throw new Error("New password must be at least 8 characters.");
                if (next !== v.confirm) throw new Error("The new passwords do not match.");
                try {
                  await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email!, String(v.current)));
                } catch {
                  throw new Error("Current password is incorrect.");
                }
                await updatePassword(user, next);
                return "Password updated.";
              }}
            />
          </Card>
        )}
        <Card title="Display name">
          <SimpleForm
            submitLabel="Save"
            fields={[{ name: "name", label: "Name shown in the app", required: true, defaultValue: name }]}
            onSubmit={async (v) => {
              await updateProfile(user, { displayName: String(v.name) });
              return "Saved. (Your school records keep the name your administrator entered.)";
            }}
          />
        </Card>
      </div>
    </>
  );
}
