// The Vite build has base "/play/match/". This worker serves the same build both on
// gridwatchmatchweb.warsignallabs.net and behind the Nexus proxy, so it strips the
// prefix before touching ASSETS or /api and sends every other path into the prefix.
export const PLAY_PREFIX = "/play/match";

export type PlayPathRewrite =
  | { kind: "redirect"; location: string }
  | { kind: "serve"; pathname: string };

export function rewritePlayPath(pathname: string): PlayPathRewrite {
  if (pathname === PLAY_PREFIX) return { kind: "redirect", location: `${PLAY_PREFIX}/` };
  if (pathname.startsWith(`${PLAY_PREFIX}/`)) return { kind: "serve", pathname: pathname.slice(PLAY_PREFIX.length) };
  return { kind: "redirect", location: `${PLAY_PREFIX}${pathname}` };
}

// 301 may be replayed as GET by browsers; 308 keeps method and body for legacy API writes.
export function redirectStatusFor(method: string): 301 | 308 {
  return method === "GET" || method === "HEAD" ? 301 : 308;
}
