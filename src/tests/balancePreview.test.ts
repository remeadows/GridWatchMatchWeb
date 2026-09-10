import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { BoardEngine, type LevelDefinition } from "../engine";
import { defaultSaveState } from "../state/save";
import { levelSeed } from "../state/progress";
import { applyBalanceProfile, createPreviewSaveStore, maySubmitPreviewScore, selectBalanceProfile } from "../dev/balancePreview";

const candidateQuery = "?gwTestMode=1&gwBalanceProfile=pilot-moves-v1";
const select = (search = candidateQuery, isDevelopment = true) => selectBalanceProfile({ isDevelopment, search });
const level = (id: number) => JSON.parse(readFileSync(`public/levels/level_${String(id).padStart(3, "0")}.json`, "utf8")) as LevelDefinition;

describe("isolated development balance profiles", () => {
  it("requires development, one exact test-mode value and an explicitly known profile", () => {
    expect(select()?.id).toBe("pilot-moves-v1");
    for (const search of ["", "?gwTestMode=1", "?gwBalanceProfile=pilot-moves-v1", "?gwTestMode=0&gwBalanceProfile=pilot-moves-v1",
      "?gwTestMode=true&gwBalanceProfile=pilot-moves-v1", "?gwTestMode=1&gwBalanceProfile=unknown",
      "?gwTestMode=1&gwBalanceProfile=__proto__", `${candidateQuery}&gwTestMode=0`, `${candidateQuery}&gwBalanceProfile=canonical-control-v1`]) {
      expect(select(search)).toBeNull();
    }
    expect(select(candidateQuery, false)).toBeNull();
  });

  it("changes only eight explicit move budgets and leaves authored data immutable", () => {
    const profile = select()!;
    const expected = new Map([[19, 17], [35, 19], [49, 21], [50, 29], [51, 28], [60, 32], [61, 25], [70, 35]]);
    for (let id = 1; id <= 100; id++) {
      const authored = level(id), before = structuredClone(authored);
      const candidate = applyBalanceProfile(authored, profile);
      expect(candidate.moveLimit).toBe(expected.get(id) ?? authored.moveLimit);
      expect({ ...candidate, moveLimit: authored.moveLimit }).toEqual(authored);
      candidate.cellMap[0][0].locked = !candidate.cellMap[0][0].locked;
      expect(authored).toEqual(before);
    }
  });

  it("preserves actual initial board and RNG for every pilot", () => {
    for (const id of [19, 35, 49, 50, 51, 60, 61, 70]) {
      const authored = level(id), candidate = applyBalanceProfile(authored, select());
      const before = new BoardEngine(authored, levelSeed(id)).snapshot;
      const after = new BoardEngine(candidate, levelSeed(id)).snapshot;
      expect({ ...after, moveLimit: before.moveLimit }).toEqual(before);
    }
  });

  it("keeps the explicitly isolated control profile canonical", () => {
    const control = select("?gwTestMode=1&gwBalanceProfile=canonical-control-v1");
    expect(control?.id).toBe("canonical-control-v1");
    expect(applyBalanceProfile(level(51), control)).toEqual(level(51));
    expect(applyBalanceProfile(level(51), null)).toEqual(level(51));
  });

  it("fails closed when an authored budget no longer matches the reviewed patch", () => {
    const stale = level(51);
    stale.moveLimit = 43;
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(applyBalanceProfile(stale, select())).toEqual(stale);
      expect(warning).toHaveBeenCalledExactlyOnceWith(
        "[balance] Skipped stale change for level 51: expected moveLimit 44, found 43."
      );
      warning.mockClear();
      applyBalanceProfile(level(51), select());
      applyBalanceProfile(level(51), null);
      expect(warning).not.toHaveBeenCalled();
    } finally { warning.mockRestore(); }
  });

  it("isolates load, persistence and reset entirely in memory", async () => {
    const getItem = vi.fn(), setItem = vi.fn(), open = vi.fn();
    vi.stubGlobal("localStorage", { getItem, setItem });
    vi.stubGlobal("indexedDB", { open });
    try {
      const a = createPreviewSaveStore(defaultSaveState), b = createPreviewSaveStore(defaultSaveState);
      const save = await a.load();
      save.coins = 999;
      save.levels["51"] = { stars: 3, score: 100, completedAt: "local-preview" };
      expect((await a.load()).coins).toBe(0);
      await a.persist(save);
      save.coins = 1;
      expect((await a.load()).coins).toBe(999);
      expect((await b.load()).coins).toBe(0);
      expect((await a.reset()).levels).toEqual({});
      expect((await a.load()).coins).toBe(0);
      expect(getItem).not.toHaveBeenCalled();
      expect(setItem).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });

  it("blocks candidate and control scores even with a session and removed query parameters", () => {
    expect(maySubmitPreviewScore({ profile: select(), hasSession: true, isTestMode: false })).toBe(false);
    expect(maySubmitPreviewScore({ profile: select("?gwTestMode=1&gwBalanceProfile=canonical-control-v1"), hasSession: true, isTestMode: false })).toBe(false);
    expect(maySubmitPreviewScore({ profile: null, hasSession: true, isTestMode: true })).toBe(false);
    expect(maySubmitPreviewScore({ profile: null, hasSession: false, isTestMode: false })).toBe(false);
    expect(maySubmitPreviewScore({ profile: null, hasSession: true, isTestMode: false })).toBe(true);
  });
});
