export const IMAGE_ASSET_PREFIX = "assets/images/";
export const WEB_IMAGE_OVERRIDE_PREFIX = "assets/images/web-overrides/";

function normalizeManifestPath(assetPath: string): string {
  return assetPath.replace(/^\/+/, "");
}

export function webOverridePath(assetPath: string): string | null {
  const normalized = normalizeManifestPath(assetPath);
  if (!normalized.startsWith(IMAGE_ASSET_PREFIX) || normalized.startsWith(WEB_IMAGE_OVERRIDE_PREFIX)) {
    return null;
  }

  const imageRelativePath = normalized.slice(IMAGE_ASSET_PREFIX.length);
  return imageRelativePath ? `${WEB_IMAGE_OVERRIDE_PREFIX}${imageRelativePath}` : null;
}

export function resolveImageAssetPath(assetPath: string, exists: (candidatePath: string) => boolean): string {
  const normalized = normalizeManifestPath(assetPath);
  const overridePath = webOverridePath(normalized);
  return overridePath && exists(overridePath) ? overridePath : normalized;
}
