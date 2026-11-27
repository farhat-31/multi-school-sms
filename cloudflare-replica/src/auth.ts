import { createRemoteJWKSet, jwtVerify } from "jose";
import { decodeFields, Firestore } from "./firestore";
import type { Principal, Role } from "./types";

// Google's public keys for Firebase Auth ID tokens (cached per isolate).
const JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"),
);
const ROLES: Role[] = ["superAdmin", "schoolAdmin", "teacher", "student", "parent"];

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * 1. Verify the Firebase ID token signature/issuer/audience.
 * 2. Load users/{uid} from Firestore AS that user and require status == active.
 */
export async function authenticate(request: Request, projectId: string): Promise<Principal> {
  const match = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "");
  if (!match) throw new HttpError(401, "Missing bearer token");
  const idToken = match[1];

  let uid: string | undefined;
  let provider: string | undefined;
  try {
    const { payload } = await jwtVerify(idToken, JWKS, {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
      algorithms: ["RS256"],
    });
    uid = payload.sub;
    provider = (payload.firebase as { sign_in_provider?: string } | undefined)?.sign_in_provider;
  } catch {
    throw new HttpError(401, "Invalid or expired token");
  }
  if (!uid) throw new HttpError(401, "Invalid token");

  const doc = await new Firestore(projectId, idToken).get(`users/${uid}`);
  if (!doc) throw new HttpError(403, "This login has no access");
  const u = decodeFields(doc.fields);
  if (u.status !== "active") throw new HttpError(403, "Account is not active");
  const role = u.role as Role;
  if (!ROLES.includes(role)) throw new HttpError(403, "Account has no role");
  // Google sign-in is only allowed for the Super Admin.
  if (provider === "google.com" && role !== "superAdmin") throw new HttpError(403, "Google sign-in is only for the Super Admin");
  const schoolId = typeof u.schoolId === "string" ? u.schoolId : undefined;
  if (role !== "superAdmin" && !schoolId) throw new HttpError(403, "Account has no school");
  const childIds = Array.isArray(u.childIds) ? u.childIds.filter((x): x is string => typeof x === "string") : [];
  const permissions =
    u.permissions && typeof u.permissions === "object" ? (u.permissions as Record<string, boolean>) : {};
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const classIds = strings(u.classIds);
  const classId = typeof u.classId === "string" ? u.classId : undefined;
  return { uid, role, schoolId, childIds, classIds, classId, permissions, idToken };
}
