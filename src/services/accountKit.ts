import { createAccountKit } from "@gridwatch/account-kit";

/** Accepts only an absolute http(s) URL and returns its origin; anything else → undefined. */
export function readPreviewOrigin(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

const previewOrigin = readPreviewOrigin(import.meta.env.VITE_NEXUS_ORIGIN);

export const accountKit = createAccountKit({
  returnPath: "/play/match/",
  nexusOrigin: previewOrigin || (typeof window !== "undefined" && import.meta.env.DEV ? window.location.origin : undefined),
});
