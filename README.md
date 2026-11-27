# EduSphere: Multi-School Management System

**Live:** https://farhat-edbc8.web.app · **Cloudflare layer:** https://school-replica.veeraopstechnologies.workers.dev

One Firebase project runs every school. Each school's data is isolated from the others, and within a
school each class is isolated too. Firestore is the **primary** database. Cloudflare Workers with SQLite
Durable Objects (free plan) hold a **secondary** read copy, with one private database per school.

```
Landing page → "Who are you?" → sign in → account active? → role matches? → dashboard
                                                             │
React (Firebase Hosting) ── Firebase Auth ── Firestore (primary · security rules = business logic)
        │ writes ───────────────────────────────▶ Firestore
        │ "sync these docs" ─▶ Cloudflare Worker ─ re-reads them from Firestore AS THE USER
        │                                        └▶ Durable Object "school_001" (own SQLite DB)
        │ reads ◀──────────── Cloudflare Worker ──▶ Durable Object "school_002" (own SQLite DB)
        │ (falls back to Firestore automatically if Cloudflare is unavailable)
```

## Roles and access

| Role | Signs in with | Created by | Can do |
|---|---|---|---|
| Super Admin | username `admin` (or an allow-listed Google account) | built in | Create and delete schools, create School Admins, grant School Admin permissions |
| School Admin | username / email + password | Super Admin | Everything in their school that the Super Admin granted: people, classes, attendance, fees, exams, announcements |
| Teacher | username / email + password | School Admin | Only **their assigned classes**: students, families, attendance, exams, homework, within the permissions the School Admin granted |
| Parent + Student | **one shared family login** | School Admin or Teacher | Parent portal or Student portal: their own child(ren) only |

- **Families:** a student is always created together with their parent, and they share one login. Choose **Parent** or **Student** on the sign-in page. Siblings join the same family.
- **Class isolation:** each teacher's `classIds` is set by the School Admin. Teachers only reach those classes. Families only see their own class's homework and timetable.
- **School isolation:** nobody except the Super Admin can reach another school.
- **Enforcement:** everything above is enforced by `firestore.rules` and mirrored in `cloudflare-replica/src/policy.ts`, not just hidden in the UI.

## Features

- Dashboards with charts for every role, dark/light theme, mobile layout.
- Students, Families, Teachers: searchable lists, CSV export, print.
- Add people one by one or by **bulk CSV upload** (families, siblings, teachers with classes).
- Classes, weekly **timetable**, **attendance** (mark a whole class, 14-day trends), **exams and results**, printable **report cards**, **homework**, **fees** (invoices, payments, overdue), **announcements** with a notification bell.
- School profile settings, My account (change password).
- Super Admin: platform overview, schools (create, open, delete with full wipe), School Admin permissions, Cloudflare sync tools.

## Repository layout

| Path | What it is |
|---|---|
| `firebase.json`, `.firebaserc` | Firebase CLI config: Hosting, Firestore, Auth providers, Storage rules |
| `firestore.rules` | All access control: school, class and family isolation; permission chain |
| `firestore.indexes.json` | Composite indexes |
| `storage.rules` | Per-school file rules (deploy once Storage is enabled) |
| `web/` | React + Vite + TypeScript app (code-split pages) |
| `cloudflare-replica/` | Cloudflare Worker + SQLite Durable Objects (one per school) |

## Setup

Prerequisites: Node 20+, Firebase CLI (`npm i -g firebase-tools`), a Cloudflare account (free plan is enough).

1. **Firebase**
   ```bash
   firebase login
   firebase use --add                 # select your project
   ```
   Add a Web app in the Firebase console. Copy `web/.env.example` to `web/.env.local` and fill in the config.
2. **Cloudflare**
   ```bash
   cd cloudflare-replica && npm install
   # set FIREBASE_PROJECT_ID and ALLOWED_ORIGINS in wrangler.jsonc
   npx wrangler login && npx wrangler deploy
   ```
   Put the Worker URL in `VITE_REPLICA_URL` in `web/.env.local`.
3. **Super Admin:** create the `admin@<project>.firebaseapp.com` user in Firebase Auth. Put its UID in `isSuperIdentity()` in `firestore.rules`. Optionally add Google emails to the same function.
4. **Deploy**
   ```bash
   cd web && npm install && cd ..
   firebase deploy --only auth,firestore
   firebase deploy --only hosting
   ```

## Local development
```bash
cd web && npm run dev                                  # http://localhost:5173
cd cloudflare-replica && npm run dev                   # local Worker
```

## Security notes
- Change the Super Admin password after setup (**My account → Change password**).
- `web/.env.local` (Firebase web config) is git-ignored. Firebase web keys are not secrets, but keep the file out of the repo anyway.
- The Worker needs no secrets. It reads Firestore with the caller's own ID token, so the Firestore rules always apply.
