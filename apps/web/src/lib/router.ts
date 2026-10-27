import { useSyncExternalStore } from "react";

const NAVIGATE_EVENT = "tempass:navigate";

export type Route =
  | { name: "home" }
  | { name: "join"; roomId: string }
  | { name: "room"; roomId: string }
  | { name: "notFound" };

function subscribe(callback: () => void): () => void {
  window.addEventListener("popstate", callback);
  window.addEventListener(NAVIGATE_EVENT, callback);

  return () => {
    window.removeEventListener("popstate", callback);
    window.removeEventListener(NAVIGATE_EVENT, callback);
  };
}

function getPathname(): string {
  return window.location.pathname;
}

export function usePathname(): string {
  return useSyncExternalStore(subscribe, getPathname, () => "/");
}

export function navigate(path: string): void {
  if (window.location.pathname !== path) {
    window.history.pushState({}, "", path);
  }

  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

export function matchRoute(pathname: string): Route {
  if (pathname === "/" || pathname === "") {
    return { name: "home" };
  }

  const joinMatch = /^\/join\/([^/]+)\/?$/.exec(pathname);

  if (joinMatch?.[1]) {
    return { name: "join", roomId: joinMatch[1] };
  }

  const roomMatch = /^\/room\/([^/]+)\/?$/.exec(pathname);

  if (roomMatch?.[1]) {
    return { name: "room", roomId: roomMatch[1] };
  }

  return { name: "notFound" };
}
