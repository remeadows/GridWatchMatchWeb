import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const defaultSourceRoots = [
  path.resolve(repoRoot, "../GridWatchMatch/GridWatchMatch/GridWatchMatch"),
  path.resolve(repoRoot, "../../GridWatchMatch/GridWatchMatch/GridWatchMatch")
];
const defaultSourceRoot = defaultSourceRoots.find((candidate) => existsSync(candidate)) ?? defaultSourceRoots[0];
const sourceRoot = process.env.GRIDWATCH_IOS_SOURCE
  ? path.resolve(process.env.GRIDWATCH_IOS_SOURCE)
  : defaultSourceRoot;

const publicRoot = path.join(repoRoot, "public");
const imageOut = path.join(publicRoot, "assets/images");
const imageOverrideOut = path.join(imageOut, "web-overrides");
const audioOut = path.join(publicRoot, "assets/audio");
const lottieOut = path.join(publicRoot, "assets/lottie");
const videoOut = path.join(publicRoot, "assets/video");
const levelsOut = path.join(publicRoot, "levels");
const generatedAssetManifestPath = path.join(repoRoot, "src/data/assetManifest.generated.ts");
const assetSyncStatePath = path.join(repoRoot, "src/data/assetSyncState.generated.json");
const imageAssetPrefix = "assets/images/";
const webImageOverridePrefix = "assets/images/web-overrides/";
const syncedImageDirectories = ["tiles", "powerups", "boosters", "backgrounds", "villains", "heroes", "app"];

const images = {
  tiles: {
    packet: "assets/images/tiles/tile_packet.png",
    firewall: "assets/images/tiles/tile_firewall.png",
    key: "assets/images/tiles/tile_key.png",
    threat: "assets/images/tiles/tile_threat.png",
    zeroDay: "assets/images/tiles/tile_zeroday.png"
  },
  powerUps: {
    rocketH: "assets/images/powerups/powerup_rocket_h.png",
    rocketV: "assets/images/powerups/powerup_rocket_v.png",
    propeller: "assets/images/powerups/powerup_propeller.png",
    tnt: "assets/images/powerups/powerup_tnt.png",
    lightBall: "assets/images/powerups/powerup_lightball.png"
  },
  boosters: {
    rocketH: "assets/images/boosters/booster_rocket_h.png",
    rocketV: "assets/images/boosters/booster_rocket_v.png",
    propeller: "assets/images/boosters/booster_propeller.png",
    tnt: "assets/images/boosters/booster_tnt.png",
    lightBall: "assets/images/boosters/booster_lightball.png"
  },
  backgrounds: {
    home: "assets/images/backgrounds/home_background.png",
    gamePanel: "assets/images/backgrounds/game_panel.png"
  },
  villains: {
    vexis: "assets/images/villains/VEXIS.jpg",
    kron: "assets/images/villains/KRON.jpg",
    zero: "assets/images/villains/ZERO.jpg",
    ax10m: "assets/images/villains/AX10M.jpg",
    ax10m2: "assets/images/villains/AX10M2.jpg",
    aurora6: "assets/images/villains/AURORA-6.jpg",
    rusty: "assets/images/villains/Rusty.png",
    tee: "assets/images/villains/Tee_v1.png",
    tish: "assets/images/villains/Tish3.jpg",
    helix: "assets/images/villains/Helix.png"
  },
  heroes: {
    rusty: "assets/images/heroes/Rusty.png",
    tee: "assets/images/heroes/Tee_v1.png",
    tish: "assets/images/heroes/Tish3.jpg",
    helix: "assets/images/heroes/Helix.png"
  },
  appIcon: "assets/images/app/AppIcon_1024.png"
};

const imageCopies = [
  ["Assets.xcassets/Tiles/tile_packet.imageset/tile_packet.png", images.tiles.packet],
  ["Assets.xcassets/Tiles/tile_firewall.imageset/tile_firewall.png", images.tiles.firewall],
  ["Assets.xcassets/Tiles/tile_key.imageset/tile_key.png", images.tiles.key],
  ["Assets.xcassets/Tiles/tile_threat.imageset/tile_threat.png", images.tiles.threat],
  ["Assets.xcassets/Tiles/tile_zeroday.imageset/tile_zeroday.png", images.tiles.zeroDay],

  ["Assets.xcassets/PowerUps/powerup_rocket_h.imageset/powerup_rocket_h.png", images.powerUps.rocketH],
  ["Assets.xcassets/PowerUps/powerup_rocket_v.imageset/powerup_rocket_v.png", images.powerUps.rocketV],
  ["Assets.xcassets/PowerUps/powerup_propeller.imageset/powerup_propeller.png", images.powerUps.propeller],
  ["Assets.xcassets/PowerUps/powerup_tnt.imageset/powerup_tnt.png", images.powerUps.tnt],
  ["Assets.xcassets/PowerUps/powerup_lightball.imageset/powerup_lightball.png", images.powerUps.lightBall],

  ["Assets.xcassets/PowerUps/booster_rocket_h.imageset/booster_rocket_h@3x.png", images.boosters.rocketH],
  ["Assets.xcassets/PowerUps/booster_rocket_v.imageset/booster_rocket_v@3x.png", images.boosters.rocketV],
  ["Assets.xcassets/PowerUps/booster_propeller.imageset/booster_propeller@3x.png", images.boosters.propeller],
  ["Assets.xcassets/PowerUps/booster_tnt.imageset/booster_tnt@3x.png", images.boosters.tnt],
  ["Assets.xcassets/PowerUps/booster_lightball.imageset/booster_lightball@3x.png", images.boosters.lightBall],

  ["Assets.xcassets/Backgrounds/home_background.imageset/home_background.png", images.backgrounds.home],
  ["Assets.xcassets/Backgrounds/game_panel.imageset/game_panel.png", images.backgrounds.gamePanel],
  ["Assets.xcassets/AppIcon.appiconset/AppIcon_1024.png", images.appIcon],

  ["Assets.xcassets/Vexis.imageset/VEXIS.jpg", images.villains.vexis],
  ["Assets.xcassets/Kron.imageset/KRON.jpg", images.villains.kron],
  ["Assets.xcassets/Zero.imageset/ZERO.jpg", images.villains.zero],
  ["Assets.xcassets/Ax10m.imageset/AX10M.jpg", images.villains.ax10m],
  ["Assets.xcassets/Ax10m2.imageset/AX10M2.jpg", images.villains.ax10m2],
  ["Assets.xcassets/area6_villain.imageset/AURORA-6.jpg", images.villains.aurora6],
  ["Assets.xcassets/Rusty.imageset/Rusty.png", images.villains.rusty],
  ["Assets.xcassets/Tee.imageset/Tee_v1.png", images.villains.tee],
  ["Assets.xcassets/Tish.imageset/Tish3.jpg", images.villains.tish],
  ["Assets.xcassets/Helix.imageset/Helix.png", images.villains.helix],

  ["Assets.xcassets/Rusty.imageset/Rusty.png", images.heroes.rusty],
  ["Assets.xcassets/Tee.imageset/Tee_v1.png", images.heroes.tee],
  ["Assets.xcassets/Tish.imageset/Tish3.jpg", images.heroes.tish],
  ["Assets.xcassets/Helix.imageset/Helix.png", images.heroes.helix]
];

const audioFiles = [
  "bgm_boss.mp3",
  "bgm_gameplay.mp3",
  "bgm_menu.mp3",
  "sfx_breach_alert.mp3",
  "sfx_chain_cascade.mp3",
  "sfx_level_complete.mp3",
  "sfx_level_fail.mp3",
  "sfx_power_up.mp3",
  "sfx_tile_clear.mp3",
  "sfx_ui_tap.mp3",
  "vo_area_cleared.mp3",
  "vo_breach_alert.mp3",
  "vo_connection_secure.mp3",
  "vo_grid_compromised.mp3",
  "vo_initiating_countermeasures.mp3"
];

const lottieFiles = ["chest_reveal.json", "streak_tierup.json", "win_fanfare.json"];

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function sha256(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

function normalizeManifestPath(assetPath) {
  return assetPath.replace(/^\/+/, "");
}

function webOverridePath(assetPath) {
  const normalized = normalizeManifestPath(assetPath);
  if (!normalized.startsWith(imageAssetPrefix) || normalized.startsWith(webImageOverridePrefix)) {
    return null;
  }

  const imageRelativePath = normalized.slice(imageAssetPrefix.length);
  return imageRelativePath ? `${webImageOverridePrefix}${imageRelativePath}` : null;
}

async function resolveImageAssetPath(assetPath) {
  const normalized = normalizeManifestPath(assetPath);
  const overridePath = webOverridePath(normalized);
  return overridePath && (await exists(path.join(publicRoot, overridePath))) ? overridePath : normalized;
}

async function resolveImageManifest(value) {
  if (typeof value === "string") {
    return resolveImageAssetPath(value);
  }

  const resolved = Array.isArray(value) ? [] : {};
  for (const [key, child] of Object.entries(value)) {
    resolved[key] = await resolveImageManifest(child);
  }
  return resolved;
}

function flattenImageManifest(value, prefix = [], output = new Map()) {
  if (typeof value === "string") {
    output.set(prefix.join("."), normalizeManifestPath(value));
    return output;
  }

  for (const [key, child] of Object.entries(value)) {
    flattenImageManifest(child, [...prefix, key], output);
  }
  return output;
}

function syncedPathForResolvedPath(assetPath) {
  const normalized = normalizeManifestPath(assetPath);
  return normalized.startsWith(webImageOverridePrefix)
    ? `${imageAssetPrefix}${normalized.slice(webImageOverridePrefix.length)}`
    : normalized;
}

function compareSets(expected, actual) {
  return {
    missing: [...expected].filter((value) => !actual.has(value)).sort(),
    orphaned: [...actual].filter((value) => !expected.has(value)).sort()
  };
}

function validateImageManifestMapping(resolvedImages) {
  const expectedDestinations = new Set(imageCopies.map(([, destRelative]) => normalizeManifestPath(destRelative)));
  const sourceManifestDestinations = new Set([...flattenImageManifest(images).values()]);
  const resolvedDestinations = new Set(
    [...flattenImageManifest(resolvedImages).values()].map((resolvedPath) => syncedPathForResolvedPath(resolvedPath))
  );

  const sourceMismatch = compareSets(expectedDestinations, sourceManifestDestinations);
  const resolvedMismatch = compareSets(expectedDestinations, resolvedDestinations);
  const problems = [];
  if (sourceMismatch.missing.length || sourceMismatch.orphaned.length) {
    problems.push(
      `images/imageCopies mismatch: missing=${sourceMismatch.missing.join(", ") || "none"} orphaned=${sourceMismatch.orphaned.join(", ") || "none"}`
    );
  }
  if (resolvedMismatch.missing.length || resolvedMismatch.orphaned.length) {
    problems.push(
      `resolvedImages/imageCopies mismatch: missing=${resolvedMismatch.missing.join(", ") || "none"} orphaned=${resolvedMismatch.orphaned.join(", ") || "none"}`
    );
  }

  if (problems.length) {
    throw new Error(`Asset manifest mismatch:\n${problems.join("\n")}`);
  }
}

async function readAssetSyncState() {
  try {
    return JSON.parse(await readFile(assetSyncStatePath, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
}

async function buildImageChecksumState() {
  const checksums = {};
  for (const [sourceRelative, destRelative] of imageCopies) {
    const source = path.join(sourceRoot, sourceRelative);
    checksums[normalizeManifestPath(destRelative)] = {
      source: sourceRelative,
      sha256: await sha256(source)
    };
  }
  return checksums;
}

function diffAssetSyncState(previousState, resolvedImages, checksums) {
  const previousManifest = previousState?.images ? flattenImageManifest(previousState.images) : new Map();
  const currentManifest = flattenImageManifest(resolvedImages);
  const previousKeys = new Set(previousManifest.keys());
  const currentKeys = new Set(currentManifest.keys());
  const added = [...currentKeys].filter((key) => !previousKeys.has(key)).sort();
  const removed = [...previousKeys].filter((key) => !currentKeys.has(key)).sort();
  const changed = [];
  const checksumDrift = [];

  for (const key of [...currentKeys].sort()) {
    if (!previousKeys.has(key)) continue;
    const currentPath = currentManifest.get(key);
    const previousPath = previousManifest.get(key);
    const syncedPath = syncedPathForResolvedPath(currentPath);
    const previousChecksum = previousState?.checksums?.[syncedPath]?.sha256;
    const currentChecksum = checksums[syncedPath]?.sha256;
    if (previousPath !== currentPath || (previousChecksum && currentChecksum && previousChecksum !== currentChecksum)) {
      changed.push(key);
    }
    if (previousChecksum && currentChecksum && previousChecksum !== currentChecksum) {
      checksumDrift.push(syncedPath);
    }
  }

  return { added, removed, changed, checksumDrift };
}

function formatAssetList(values) {
  return values.length ? values.join(", ") : "none";
}

function printAssetDiffSummary(diff) {
  console.log(
    `[sync-assets] Asset diff: added=${formatAssetList(diff.added)} removed=${formatAssetList(diff.removed)} changed=${formatAssetList(diff.changed)}`
  );
  console.log(`[sync-assets] Checksum drift: ${formatAssetList(diff.checksumDrift)}`);
}

async function writeAssetSyncState(resolvedImages, checksums) {
  const state = {
    generatedBy: "scripts/sync-ios-assets.mjs",
    images: resolvedImages,
    checksums
  };
  await writeFile(assetSyncStatePath, `${JSON.stringify(state, null, 2)}\n`);
}

async function cleanSyncedImages() {
  await mkdir(imageOverrideOut, { recursive: true });
  await Promise.all(
    syncedImageDirectories.map((directoryName) =>
      rm(path.join(imageOut, directoryName), { recursive: true, force: true })
    )
  );
}

async function copyRelative(sourceRelative, destRelative) {
  const source = path.join(sourceRoot, sourceRelative);
  const dest = path.join(publicRoot, destRelative);
  if (!(await exists(source))) {
    throw new Error(`Missing source asset: ${source}`);
  }
  await mkdir(path.dirname(dest), { recursive: true });
  await copyFile(source, dest);
}

async function copyDirectoryFiles(sourceDir, destDir, predicate) {
  await mkdir(destDir, { recursive: true });
  const entries = await readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const source = path.join(sourceDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      await copyDirectoryFiles(source, dest, predicate);
    } else if (!predicate || predicate(entry.name)) {
      await copyFile(source, dest);
    }
  }
}

async function main() {
  if (!(await exists(sourceRoot))) {
    throw new Error(
      `iOS source root not found: ${sourceRoot}\nExpected sibling candidates:\n${defaultSourceRoots.map((candidate) => `- ${candidate}`).join("\n")}`
    );
  }

  const previousAssetSyncState = await readAssetSyncState();

  await Promise.all([
    cleanSyncedImages(),
    rm(audioOut, { recursive: true, force: true }),
    rm(lottieOut, { recursive: true, force: true }),
    rm(videoOut, { recursive: true, force: true }),
    rm(levelsOut, { recursive: true, force: true })
  ]);

  for (const [sourceRelative, destRelative] of imageCopies) {
    await copyRelative(sourceRelative, destRelative);
  }

  for (const file of audioFiles) {
    await copyRelative(`Resources/Audio/${file}`, `assets/audio/${file}`);
  }

  for (const file of lottieFiles) {
    await copyRelative(`Resources/Lottie/${file}`, `assets/lottie/${file}`);
  }

  await copyRelative("Resources/WarSignalLabsIPhone.mp4", "assets/video/WarSignalLabsIPhone.mp4");

  await copyDirectoryFiles(
    path.join(sourceRoot, "Levels"),
    levelsOut,
    (name) => /^level_\d{3}\.json$/.test(name)
  );

  const resolvedImages = await resolveImageManifest(images);
  validateImageManifestMapping(resolvedImages);
  const imageChecksums = await buildImageChecksumState();
  const assetDiff = diffAssetSyncState(previousAssetSyncState, resolvedImages, imageChecksums);
  const generated = `// Generated by scripts/sync-ios-assets.mjs. Do not edit by hand.\n\nexport const assetManifest = ${JSON.stringify({ images: resolvedImages }, null, 2)} as const;\n\nexport const audioManifest = ${JSON.stringify(audioFiles, null, 2)} as const;\n\nexport const lottieManifest = ${JSON.stringify(lottieFiles, null, 2)} as const;\n`;
  await writeFile(generatedAssetManifestPath, generated);
  await writeAssetSyncState(resolvedImages, imageChecksums);
  printAssetDiffSummary(assetDiff);

  console.log(`Synced assets and levels from ${sourceRoot}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
