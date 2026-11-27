import { useEffect, useRef, useState } from "react";
import { useSession } from "../auth";
import { useDocs } from "../data";
import { useCaps, useWorkspace } from "../context";
import { navigate } from "../router";
import { Icon } from "../components/icons";
import { Empty, fmt } from "../components/ui";

/** Unread announcements for this user in the active school. */
export function NotificationBell() {
  const { user, role } = useSession();
  const { schoolId } = useWorkspace();
  const caps = useCaps();
  const { rows } = useDocs(schoolId, "announcements");
  const key = `seen:${user.uid}:${schoolId}`;
  const [seen, setSeen] = useState(() => {
    try {
      return localStorage.getItem(key) ?? "";
    } catch {
      return "";
    }
  });
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const mine = rows
    .filter((a) => caps.isStaff || a.audience === "all" || a.audience === role)
    .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
  const unread = mine.filter((a) => String(a.createdAt ?? "") > seen && a.authorUid !== user.uid).length;

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  function toggle() {
    setOpen((o) => !o);
    const latest = String(mine[0]?.createdAt ?? "");
    if (latest) {
      setSeen(latest);
      try {
        localStorage.setItem(key, latest);
      } catch {
        /* ignore */
      }
    }
  }

  return (
    <div className="bell" ref={ref}>
      <button className="ghost icon" onClick={toggle} aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} title="Notifications">
        <Icon name="megaphone" />
        {unread > 0 && <span className="dot">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className="popover">
          <h3>Announcements</h3>
          {mine.length ? (
            <ul className="list">
              {mine.slice(0, 6).map((a) => (
                <li key={a.id}>
                  <div>
                    <strong>{fmt(a.title)}</strong>
                    <p style={{ margin: "2px 0" }}>{String(a.body ?? "").slice(0, 90)}</p>
                    <small className="muted">{fmt(a.createdAt)}</small>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon="megaphone" title="You're all caught up" />
          )}
          <button
            className="link"
            onClick={() => {
              setOpen(false);
              navigate("announcements");
            }}
          >
            View all announcements →
          </button>
        </div>
      )}
    </div>
  );
}
