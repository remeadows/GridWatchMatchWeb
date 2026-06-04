import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const levelsDir = path.join(repoRoot, "public/levels");
const allowedObjectiveIds = new Set(["collect", "clear", "multi", "spread", "guide"]);
const tileTypes = new Set(["packet", "firewall", "key", "threat", "zeroDay"]);
const powerUps = new Set(["rocket_h", "rocket_v", "propeller", "tnt", "lightBall"]);
const overlays = new Set(["encryptedVolume_1", "encryptedVolume_2", "encryptedVolume_3"]);
const underlays = new Set(["malware_1", "malware_2"]);
const generators = new Set(["honeypot"]);

function fail(level, code, detail) {
  level.errors.push(detail ? `${code}: ${detail}` : code);
}

function validObjectiveId(id) {
  return allowedObjectiveIds.has(id) || id.startsWith("collect_");
}

async function main() {
  const files = (await readdir(levelsDir))
    .filter((name) => /^level_\d{3}\.json$/.test(name))
    .sort();

  if (files.length === 0) {
    throw new Error(`No level JSON files found in ${levelsDir}`);
  }

  let passed = 0;
  let failed = 0;
  let warnings = 0;
  const reports = [];

  for (const file of files) {
    const report = { file, errors: [], warnings: [] };
    const suffix = Number(file.match(/level_(\d{3})\.json/)?.[1] ?? -1);
    let level;
    try {
      level = JSON.parse(await readFile(path.join(levelsDir, file), "utf8"));
    } catch (error) {
      fail(report, "DECODING_FAILED", error.message);
      reports.push(report);
      failed += 1;
      continue;
    }

    if (level.id !== suffix) fail(report, "ID_FILENAME_MISMATCH");
    if (!Number.isInteger(level.gridRows) || level.gridRows < 5 || level.gridRows > 12) fail(report, "GRID_ROWS_OUT_OF_RANGE");
    if (!Number.isInteger(level.gridCols) || level.gridCols < 5 || level.gridCols > 9) fail(report, "GRID_COLS_OUT_OF_RANGE");
    if (!Number.isInteger(level.moveLimit) || level.moveLimit < 10) fail(report, "MOVE_LIMIT_TOO_LOW");
    if (level.bossLevel && level.bonusLevel) fail(report, "CONFLICTING_LEVEL_FLAGS");
    if (level.bossLevel && level.bossTimerSeconds != null && level.bossTimerSeconds < 30) fail(report, "BOSS_TIMER_INVALID");

    if (!Array.isArray(level.objectives) || level.objectives.length === 0) fail(report, "NO_OBJECTIVES");
    if (Array.isArray(level.objectives) && level.objectives.length > 3) report.warnings.push("More than 3 objectives; app supports it but current design expects compact HUD");
    const objectiveIds = new Set();
    for (const objective of level.objectives ?? []) {
      if (!validObjectiveId(objective.id)) fail(report, "INVALID_OBJECTIVE_ID", objective.id);
      if (objectiveIds.has(objective.id)) fail(report, "DUPLICATE_OBJECTIVE_ID", objective.id);
      objectiveIds.add(objective.id);
      if (!Number.isInteger(objective.target) || objective.target <= 0) fail(report, "OBJECTIVE_TARGET_INVALID", objective.id);
      if ((objective.id === "collect" || objective.id.startsWith("collect_")) && !tileTypes.has(objective.tileType)) {
        fail(report, "COLLECT_TILE_TYPE_INVALID", `${objective.id}:${objective.tileType}`);
      }
    }

    if (!Array.isArray(level.cellMap) || level.cellMap.length !== level.gridRows) {
      fail(report, "CELL_MAP_DIMENSION_ERROR");
    } else {
      for (let row = 0; row < level.cellMap.length; row += 1) {
        const cells = level.cellMap[row];
        if (!Array.isArray(cells) || cells.length !== level.gridCols) {
          fail(report, "CELL_MAP_DIMENSION_ERROR", `row ${row}`);
          continue;
        }
        for (let col = 0; col < cells.length; col += 1) {
          const cell = cells[col];
          const at = `r${row}c${col}`;
          if (cell.tile != null && !tileTypes.has(cell.tile)) fail(report, "UNKNOWN_TILE", `${at}:${cell.tile}`);
          if (cell.powerUp != null && !powerUps.has(cell.powerUp)) fail(report, "UNKNOWN_POWERUP", `${at}:${cell.powerUp}`);
          if (cell.overlay != null && !overlays.has(cell.overlay)) fail(report, "UNKNOWN_OVERLAY", `${at}:${cell.overlay}`);
          if (cell.underlay != null && !underlays.has(cell.underlay)) fail(report, "UNKNOWN_UNDERLAY", `${at}:${cell.underlay}`);
          if (cell.generator != null && !generators.has(cell.generator)) fail(report, "UNKNOWN_GENERATOR", `${at}:${cell.generator}`);
          if (cell.tile != null && cell.powerUp != null) fail(report, "CELL_TILE_POWERUP_CONFLICT", at);
          if (cell.generator != null && (cell.tile != null || cell.locked !== true)) fail(report, "GENERATOR_CELL_INVALID", at);
        }
      }
    }

    const weights = level.spawnWeights ?? {};
    const weightSum = Object.values(weights).reduce((sum, value) => sum + Number(value), 0);
    if (Math.abs(weightSum - 1) > 0.001) fail(report, "SPAWN_WEIGHT_SUM_ERROR", String(weightSum));
    for (const [tile, value] of Object.entries(weights)) {
      if (!tileTypes.has(tile)) fail(report, "UNKNOWN_SPAWN_TILE", tile);
      if (typeof value !== "number" || value < 0) fail(report, "SPAWN_WEIGHT_INVALID", `${tile}:${value}`);
    }
    if (level.id < 50 && (weights.zeroDay ?? 0) > 0) fail(report, "FORBIDDEN_TILE_FOR_LEVEL", "zeroDay");
    if (level.id >= 50 && (weights.zeroDay ?? 0) <= 0) report.warnings.push("zeroDay spawn weight is 0 for level >= 50");

    warnings += report.warnings.length;
    if (report.errors.length === 0) {
      passed += 1;
    } else {
      failed += 1;
    }
    reports.push(report);
  }

  for (const report of reports) {
    if (report.errors.length === 0) {
      console.log(`PASS ${report.file}`);
    } else {
      console.log(`FAIL ${report.file}: ${report.errors.join(", ")}`);
    }
    for (const warning of report.warnings) {
      console.log(`WARN ${report.file}: ${warning}`);
    }
  }

  console.log(`Summary: ${passed} passed, ${failed} failed, ${warnings} warning(s)`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

