import { useEffect, useState } from "react";

/** Tiny hash router: every section is its own page/URL (#/attendance, #/fees, ...). */
const current = () => location.hash.replace(/^#\/?/, "").split("?")[0];

export function useRoute(): string {
  const [route, setRoute] = useState(current);
  useEffect(() => {
    const on = () => setRoute(current());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export function navigate(path: string): void {
  location.hash = `/${path}`;
}
