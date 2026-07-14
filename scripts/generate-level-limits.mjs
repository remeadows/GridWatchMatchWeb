// Regenerate worker/level-limits.json after any level rebalance:
//   npm run generate:level-limits
import { readFile, writeFile, readdir } from "node:fs/promises";

const dir = new URL("../public/levels/", import.meta.url);
const files = (await readdir(dir)).filter((f) => /^level_\d{3}\.json$/.test(f)).sort();
const limits = {};
for (const f of files) {
  const level = JSON.parse(await readFile(new URL(f, dir), "utf8"));
  limits[String(level.id)] = level.moveLimit;
}
await writeFile(new URL("../worker/level-limits.json", import.meta.url), JSON.stringify(limits, null, 2) + "\n");
console.log(`wrote worker/level-limits.json (${Object.keys(limits).length} levels)`);
