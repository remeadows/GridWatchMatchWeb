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

// ASSETS.fetch redirects (e.g. its default auto-trailing-slash handling) are generated in
// the stripped namespace, since we strip PLAY_PREFIX before calling it. Route those
// Location headers back through the prefix so a redirect behind the Nexus proxy doesn't
// land the player outside /play/match. Only root-relative locations (a single leading
// "/", not "//...") that aren't already under the prefix get rewritten; anything absolute
// or protocol-relative is left untouched.
export function prefixRedirectLocation(location: string): string {
  const isRootRelative = location.startsWith("/") && !location.startsWith("//");
  if (!isRootRelative) return location;
  if (location === PLAY_PREFIX || location.startsWith(`${PLAY_PREFIX}/`)) return location;
  return `${PLAY_PREFIX}${location}`;
}
