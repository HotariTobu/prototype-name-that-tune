import { useState, useCallback, useEffect } from "react";

type Route =
  | { path: "/"; params: {} }
  | { path: "/room/:code"; params: { code: string } };

function matchRoute(pathname: string): Route {
  // /room/:code
  const roomMatch = pathname.match(/^\/room\/([A-Za-z0-9]+)$/);
  if (roomMatch) {
    return { path: "/room/:code", params: { code: roomMatch[1]! } };
  }

  // / (default)
  return { path: "/", params: {} };
}

export type { Route };

export function useRouter() {
  const [pathname, setPathname] = useState(window.location.pathname);

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback((path: string) => {
    window.history.pushState(null, "", path);
    setPathname(path);
  }, []);

  const route = matchRoute(pathname);

  return { route, navigate };
}
