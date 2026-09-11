// Single place that knows the app may be mounted below the host root (Vite `base`).
function baseWithSlash(): string {
  const base = import.meta.env.BASE_URL;
  return base.endsWith("/") ? base : `${base}/`;
}

export function apiUrl(endpoint: string): string {
  return `${baseWithSlash()}api/${endpoint.replace(/^\//, "")}`;
}
