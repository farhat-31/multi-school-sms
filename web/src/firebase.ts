import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

if (import.meta.env.VITE_USE_EMULATORS === "true") {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}

/** Cloudflare Worker (sync + per-school SQLite replica). */
export const REPLICA_URL: string = (import.meta.env.VITE_REPLICA_URL ?? "").replace(/\/$/, "");

/** Username login: "admin" -> admin@<project>.firebaseapp.com; full emails pass through. */
export function loginEmail(usernameOrEmail: string): string {
  const v = usernameOrEmail.trim().toLowerCase();
  return v.includes("@") ? v : `${v}@${firebaseConfig.projectId}.firebaseapp.com`;
}
