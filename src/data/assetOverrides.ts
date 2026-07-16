import assetOverrideRulesJson from "./assetOverrideRules.json";

interface AssetOverrideRules {
  imageAssetPrefix: string;
  webImageOverridePrefix: string;
  audioAssetPrefix: string;
  webAudioOverridePrefix: string;
}

const assetOverrideRules = assetOverrideRulesJson as AssetOverrideRules;

export const IMAGE_ASSET_PREFIX = assetOverrideRules.imageAssetPrefix;
export const WEB_IMAGE_OVERRIDE_PREFIX = assetOverrideRules.webImageOverridePrefix;
export const AUDIO_ASSET_PREFIX = assetOverrideRules.audioAssetPrefix;
export const WEB_AUDIO_OVERRIDE_PREFIX = assetOverrideRules.webAudioOverridePrefix;

function normalizeManifestPath(assetPath: string): string {
  return assetPath.trim().replace(/^\/+/, "");
}

export function webOverridePath(assetPath: string): string | null {
  const normalized = normalizeManifestPath(assetPath);
  if (!normalized.startsWith(IMAGE_ASSET_PREFIX) || normalized.startsWith(WEB_IMAGE_OVERRIDE_PREFIX)) {
    return null;
  }

  const imageRelativePath = normalized.slice(IMAGE_ASSET_PREFIX.length);
  return imageRelativePath ? `${WEB_IMAGE_OVERRIDE_PREFIX}${imageRelativePath}` : null;
}

export function webAudioOverridePath(assetPath: string): string | null {
  const normalized = normalizeManifestPath(assetPath);
  if (!normalized || normalized.startsWith(WEB_AUDIO_OVERRIDE_PREFIX)) return null;

  const fileName = normalized.startsWith(AUDIO_ASSET_PREFIX)
    ? normalized.slice(AUDIO_ASSET_PREFIX.length)
    : normalized;
  return fileName && !fileName.includes("/") ? `${WEB_AUDIO_OVERRIDE_PREFIX}${fileName}` : null;
}

/*
 * Keep this module in sync with scripts/sync-ios-assets.mjs:
 * - IMAGE_ASSET_PREFIX/AUDIO_ASSET_PREFIX are the manifest roots.
 * - WEB_IMAGE_OVERRIDE_PREFIX must be inside IMAGE_ASSET_PREFIX.
 * - WEB_AUDIO_OVERRIDE_PREFIX must be inside AUDIO_ASSET_PREFIX.
 * - normalizeManifestPath trims whitespace and strips all leading slashes.
 * - webOverridePath maps assets/images/<path> to assets/images/web-overrides/<path>.
 * Both files read src/data/assetOverrideRules.json as the source of truth.
 */
function assertAssetOverrideRules(): void {
  if (!IMAGE_ASSET_PREFIX || !WEB_IMAGE_OVERRIDE_PREFIX || !AUDIO_ASSET_PREFIX || !WEB_AUDIO_OVERRIDE_PREFIX) {
    throw new Error("Asset override prefixes must be non-empty");
  }
  if (!WEB_IMAGE_OVERRIDE_PREFIX.startsWith(IMAGE_ASSET_PREFIX)) {
    throw new Error("WEB_IMAGE_OVERRIDE_PREFIX must be nested under IMAGE_ASSET_PREFIX");
  }
  if (!WEB_AUDIO_OVERRIDE_PREFIX.startsWith(AUDIO_ASSET_PREFIX)) {
    throw new Error("WEB_AUDIO_OVERRIDE_PREFIX must be nested under AUDIO_ASSET_PREFIX");
  }
  if (normalizeManifestPath(" ///assets/images/tiles/tile_packet.png ") !== "assets/images/tiles/tile_packet.png") {
    throw new Error("Asset override path normalization drifted from sync script rules");
  }
  if (webOverridePath("assets/images/tiles/tile_packet.png") !== "assets/images/web-overrides/tiles/tile_packet.png") {
    throw new Error("Asset override path construction drifted from sync script rules");
  }
  if (webOverridePath("assets/images/web-overrides/tiles/tile_packet.png") !== null) {
    throw new Error("Asset override paths must not be wrapped twice");
  }
  if (webAudioOverridePath(" ///tile_pop_a.mp3 ") !== "assets/audio/web-overrides/tile_pop_a.mp3") {
    throw new Error("Audio override path construction drifted from sync script rules");
  }
  if (webAudioOverridePath("assets/audio/web-overrides/tile_pop_a.mp3") !== null) {
    throw new Error("Audio override paths must not be wrapped twice");
  }
  if (normalizeManifestPath("") !== "" || webOverridePath("") !== null || resolveImageAssetPath("", () => true) !== "") {
    throw new Error("Empty asset paths must stay empty and never resolve to an override");
  }
}

export function resolveImageAssetPath(assetPath: string, exists: (candidatePath: string) => boolean): string {
  if (assetPath === "") return "";
  const normalized = normalizeManifestPath(assetPath);
  const overridePath = webOverridePath(normalized);
  return overridePath && exists(overridePath) ? overridePath : normalized;
}

assertAssetOverrideRules();
