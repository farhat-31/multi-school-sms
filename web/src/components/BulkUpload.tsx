import { useState } from "react";
import { loginEmail } from "../firebase";
import { useSession } from "../auth";
import { addSibling, createFamily, createTeacher, displayLogin } from "../people-actions";
import type { Row } from "../data";
import type { Family } from "../pages/people";
import { Icon } from "./icons";
import { Card } from "./ui";

const TEMPLATE = `type,name,class,parent_name,username,password,subject
family,Asha Rao,Grade 6-A,Meena Rao,rao.family,Rao@12345,
family,Ravi Rao,Grade 7-A,Meena Rao,rao.family,,
teacher,Imran Khan,Grade 6-A;Grade 7-A,,imran.khan,Imran@1234,Mathematics
`;

/** Minimal CSV parser (handles quoted fields and commas inside quotes). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.trim());
      if (row.some((x) => x)) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell.trim());
  if (row.some((x) => x)) rows.push(row);
  return rows;
}

interface Result {
  line: number;
  name: string;
  type: string;
  ok: boolean;
  message: string;
}

/**
 * Bulk-create families (student + parent, one shared login) and teachers.
 * A family row whose username was already used (in this file or the school)
 * is added as a sibling to that family.
 */
export function BulkUpload({
  schoolId,
  canTeachers,
  canFamilies,
  classes,
  allClasses,
  families,
  onDone,
}: {
  schoolId: string;
  canTeachers: boolean;
  canFamilies: boolean;
  classes: Row[]; // classes this user may add families to
  allClasses: Row[];
  families: Family[];
  onDone: () => void;
}) {
  const { user } = useSession();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [progress, setProgress] = useState("");

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([TEMPLATE], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "people-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const findClass = (list: Row[], v: string) => list.find((x) => x.id === v || String(x.name ?? "").toLowerCase() === v.toLowerCase());

  async function run() {
    const rows = parseCsv(text);
    if (rows.length < 2) return setResults([{ line: 0, name: "", type: "", ok: false, message: "Paste or choose a CSV with a header row and at least one row." }]);
    const header = rows[0].map((h) => h.toLowerCase().trim());
    const col = (n: string) => header.indexOf(n);
    for (const req of ["type", "name", "username"]) {
      if (col(req) < 0) return setResults([{ line: 1, name: "", type: "", ok: false, message: `Missing column "${req}".` }]);
    }
    const get = (r: string[], n: string) => (col(n) >= 0 ? r[col(n)] ?? "" : "").trim();
    const items = rows.slice(1).map((r, i) => ({
      line: i + 2,
      type: get(r, "type").toLowerCase(),
      name: get(r, "name"),
      cls: get(r, "class"),
      parentName: get(r, "parent_name"),
      login: get(r, "username").toLowerCase(),
      password: get(r, "password"),
      subject: get(r, "subject"),
      phone: get(r, "phone"),
    }));

    // family login (email) -> parent uid, for siblings
    const parentByLogin = new Map<string, string>();
    for (const f of families) if (f.parentUid && f.login) parentByLogin.set(f.login.toLowerCase(), f.parentUid);

    setBusy(true);
    const out: Result[] = [];
    let n = 0;
    for (const it of items) {
      n++;
      setProgress(`Row ${n} of ${items.length}…`);
      const base = { line: it.line, name: it.name, type: it.type };
      try {
        if (!it.name || !it.login) throw new Error("Name and username are required.");
        if (it.type === "teacher") {
          if (!canTeachers) throw new Error("You may not add teachers.");
          if (it.password.length < 6) throw new Error("Password must be at least 6 characters.");
          const classIds = it.cls
            .split(/[;|]/)
            .map((c) => c.trim())
            .filter(Boolean)
            .map((c) => {
              const found = findClass(allClasses, c);
              if (!found) throw new Error(`Class "${c}" not found.`);
              return found.id;
            });
          await createTeacher({ schoolId, creatorUid: user.uid, name: it.name, subject: it.subject, login: it.login, password: it.password, classIds });
          out.push({ ...base, ok: true, message: `Teacher created (username ${it.login})` });
        } else if (it.type === "family" || it.type === "student") {
          if (!canFamilies) throw new Error("You may not add families.");
          const cls = findClass(classes, it.cls);
          if (!cls) throw new Error(it.cls ? `Class "${it.cls}" not found or not one of your classes.` : "Class is required.");
          const key = loginEmail(it.login);
          const existing = parentByLogin.get(key);
          if (existing) {
            await addSibling({ schoolId, parentUid: existing, studentName: it.name, classId: cls.id });
            out.push({ ...base, ok: true, message: `Added as sibling to family "${displayLogin(key)}"` });
          } else {
            if (!it.parentName) throw new Error("parent_name is required: every student needs a parent.");
            if (it.password.length < 6) throw new Error("Password must be at least 6 characters.");
            const r = await createFamily({
              schoolId,
              creatorUid: user.uid,
              studentName: it.name,
              classId: cls.id,
              parentName: it.parentName,
              phone: it.phone,
              login: it.login,
              password: it.password,
            });
            parentByLogin.set(key, r.parentUid);
            out.push({ ...base, ok: true, message: `Family created (login ${it.login})` });
          }
        } else {
          throw new Error(`Unknown type "${it.type}". Use family or teacher.`);
        }
      } catch (e) {
        out.push({ ...base, ok: false, message: (e as Error).message });
      }
      setResults([...out]);
    }
    setBusy(false);
    setProgress("");
    onDone();
  }

  const okCount = results.filter((r) => r.ok).length;

  return (
    <Card
      title="Bulk upload (CSV)"
      actions={
        <button className="secondary small" onClick={downloadTemplate}>
          <Icon name="download" size={14} /> Template
        </button>
      }
    >
      <p className="muted">
        Columns: <code>type, name, class, parent_name, username, password, subject</code>.
        <br />
        <strong>family</strong>: a student and their parent with one shared login (both required). Repeat a family's
        username to add a sibling (password can be empty).
        <br />
        <strong>teacher</strong>: put their classes in <code>class</code>, separated by <code>;</code>.
      </p>
      <input
        type="file"
        accept=".csv,text/csv"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) setText(await f.text());
        }}
      />
      <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={TEMPLATE} style={{ width: "100%", marginTop: 8 }} />
      <div className="row" style={{ marginTop: 8 }}>
        <button onClick={run} disabled={busy || !text.trim()}>
          {busy ? progress : "Upload & create"}
        </button>
        {results.length > 0 && !busy && (
          <span className="muted">
            {okCount} created, {results.length - okCount} failed
          </span>
        )}
      </div>
      {results.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table>
            <thead>
              <tr>
                <th>Line</th>
                <th>Name</th>
                <th>Type</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={i}>
                  <td>{r.line || "—"}</td>
                  <td>{r.name}</td>
                  <td>{r.type}</td>
                  <td className={r.ok ? "success" : "error"}>{r.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
