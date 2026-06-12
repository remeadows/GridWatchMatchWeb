import { assetManifest, audioManifest, lottieManifest } from "./assetManifest.generated";

export { assetManifest, audioManifest, lottieManifest };
export { resolveImageAssetPath, webOverridePath } from "./assetOverrides";

export function assetUrl(path: string): string {
  const base = import.meta.env.BASE_URL.endsWith("/")
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  return `${base}${path.replace(/^\//, "")}`;
}

export function levelUrl(levelId: number): string {
  return assetUrl(`levels/level_${String(levelId).padStart(3, "0")}.json`);
}

export function audioUrl(fileName: string): string {
  return assetUrl(`assets/audio/${fileName}`);
}
