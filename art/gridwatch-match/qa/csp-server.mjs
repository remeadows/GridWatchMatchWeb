// Serve a built dist/ under /play/match/ with the Content-Security-Policy the live Nexus page
// carries (read from its response headers on 2026-10-10; Nexus sets it, not this repo), so a
// release can be checked for policy violations before it is deployed.
//   node csp-server.mjs <dist dir> <port>
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
const [distArg, port] = process.argv.slice(2);
const dist = path.resolve(distArg);
const csp = "default-src 'self'; base-uri 'self'; connect-src 'self' https://mggxfzzxrpjgpzhwiwqi.supabase.co; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: blob:; media-src 'self' blob:; object-src 'none'; script-src 'self'; style-src 'self'; worker-src 'self' blob:";
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".webp": "image/webp", ".mp3": "audio/mpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".wav": "audio/wav", ".jpg": "image/jpeg" };
createServer(async (request, response) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, "http://x").pathname).replace(/^\/play\/match/, "") || "/";
  } catch {
    // A path that cannot be decoded (`%E0%A4%A`) is a bad request, not a reason to stop serving.
    response.writeHead(400).end();
    return;
  }
  let file = path.join(dist, pathname);
  // Nothing outside dist/ is served, however the path is encoded (`..%2f` survives URL parsing).
  if (file !== dist && !file.startsWith(dist + path.sep)) {
    response.writeHead(403).end();
    return;
  }
  let body;
  try { body = await readFile(pathname.endsWith("/") ? path.join(file, "index.html") : file); if (pathname.endsWith("/")) file += "index.html"; }
  catch { file = path.join(dist, "index.html"); body = await readFile(file); }
  response.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream", "content-security-policy": csp });
  response.end(body);
}).listen(Number(port), "127.0.0.1");
