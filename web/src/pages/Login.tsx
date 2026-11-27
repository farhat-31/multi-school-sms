import { useState, type FormEvent } from "react";
import { GoogleAuthProvider, signInWithEmailAndPassword, signInWithPopup, signOut } from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db, loginEmail } from "../firebase";
import { ROLE_INFO, useAuth } from "../auth";

/**
 * Username/email + password for everyone. Google sign-in is offered ONLY on the
 * Super Admin login (and only allow-listed Google accounts pass the security rules).
 */
export function Login() {
  const { selectedRole, selectRole } = useAuth();
  const role = selectedRole!;
  const info = ROLE_INFO[role];
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function google() {
    setBusy(true);
    setError(null);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      const { user } = await signInWithPopup(auth, provider);
      // First Google login of an allowed Super Admin creates/refreshes their profile.
      try {
        const ref = doc(db, "users", user.uid);
        const snap = await getDoc(ref);
        if (!snap.exists() || snap.get("role") !== "superAdmin" || snap.get("status") !== "active") {
          await setDoc(ref, {
            uid: user.uid,
            email: user.email,
            displayName: user.displayName ?? user.email,
            role: "superAdmin",
            status: "active",
            createdAt: serverTimestamp(),
          });
        }
      } catch {
        await signOut(auth);
        throw new Error("This Google account is not a Super Admin.");
      }
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== "auth/popup-closed-by-user" && code !== "auth/cancelled-popup-request") {
        setError((err as Error).message.replace("Firebase: ", ""));
      }
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const { user } = await signInWithEmailAndPassword(auth, loginEmail(String(fd.get("login"))), String(fd.get("password")));
      // Self-heal: if the built-in Super Admin's profile was deleted, recreate it.
      // (Security rules only allow this for the real Super Admin account.)
      if (role === "superAdmin") {
        const ref = doc(db, "users", user.uid);
        const snap = await getDoc(ref).catch(() => null);
        if (snap && (!snap.exists() || snap.get("role") !== "superAdmin" || snap.get("status") !== "active")) {
          await setDoc(ref, {
            uid: user.uid,
            email: user.email,
            displayName: user.displayName ?? "Super Admin",
            role: "superAdmin",
            status: "active",
            createdAt: serverTimestamp(),
          }).catch(() => undefined);
        }
      }
    } catch (err) {
      const code = (err as { code?: string }).code ?? "";
      setError(
        /invalid-credential|wrong-password|user-not-found|invalid-email/.test(code)
          ? "Wrong username/email or password."
          : code === "auth/too-many-requests"
            ? "Too many attempts. Try again in a few minutes."
            : (err as Error).message.replace("Firebase: ", ""),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth-card">
      <form className="card form" onSubmit={submit}>
        <button type="button" className="link" style={{ alignSelf: "flex-start" }} onClick={() => selectRole(null)}>
          ← Change role
        </button>
        <div>
          <h1>{info.label} sign in</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>{info.blurb}</p>
        </div>
        <label>
          <span>Username or email</span>
          <input
            name="login"
            type="text"
            required
            autoComplete="username"
            autoCapitalize="none"
          />
        </label>
        <label>
          <span>Password</span>
          <input name="password" type="password" required autoComplete="current-password" />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        {role === "superAdmin" && (
          <>
            <div className="divider">
              <span>or</span>
            </div>
            <button type="button" className="google" onClick={google} disabled={busy}>
              <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
                <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
                <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
                <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
              </svg>
              Continue with Google
            </button>
          </>
        )}
        {error && <p className="alert bad">{error}</p>}
        {role === "student" && (
          <p className="alert info small-print">
            No login of your own? Use your parent's username and password. Families share one login.
          </p>
        )}
        {role !== "superAdmin" && (
          <p className="muted small-print">No account? Your login is created by {info.createdBy}.</p>
        )}
      </form>
      </div>
    </div>
  );
}
