import { deleteApp, initializeApp } from "firebase/app";
import { createUserWithEmailAndPassword, getAuth, signOut, updateProfile } from "firebase/auth";
import { firebaseConfig } from "./firebase";

/**
 * Create a login for someone else WITHOUT signing the current user out:
 * uses a temporary secondary Firebase app. `then(uid)` writes the Firestore
 * profile as the CURRENT user (security rules check they may create that role);
 * if it fails, the new login is deleted again.
 */
export async function createAccount(
  email: string,
  password: string,
  displayName: string,
  then: (uid: string) => Promise<void>,
): Promise<string> {
  const temp = initializeApp(firebaseConfig, `create-${Date.now()}`);
  const tempAuth = getAuth(temp);
  try {
    const cred = await createUserWithEmailAndPassword(tempAuth, email.trim().toLowerCase(), password);
    await updateProfile(cred.user, { displayName });
    try {
      await then(cred.user.uid);
    } catch (e) {
      await cred.user.delete().catch(() => undefined);
      throw e;
    }
    return cred.user.uid;
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "auth/email-already-in-use") throw new Error("That email already has a login. Use a different email.");
    if (code === "auth/weak-password") throw new Error("Password must be at least 6 characters.");
    if (code === "auth/invalid-email") throw new Error("Invalid email address.");
    throw e;
  } finally {
    await signOut(tempAuth).catch(() => undefined);
    await deleteApp(temp).catch(() => undefined);
  }
}
