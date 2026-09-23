import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSaveState, type SaveState } from "../state/save";
import { projection } from "../state/cloudSaves";
import {
  OLD_MATCH_ORIGIN, applyIncoming, showsCarryBanner, bannerState, carryFromOrigins, handleCarryOffer, markerFor,
  needsReplacePrompt, readCarryMarker, receiveCarryOnce, receiveCarrySafely, resetCarryReceiveForTests, slotsToCarry, writeCarryMarker,
} from "../services/carryOver";

const played = (coins: number): SaveState => ({ ...defaultSaveState(), coins });

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return { get length() { return m.size; }, clear: () => m.clear(), getItem: (k) => m.get(k) ?? null, key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => { m.delete(k); }, setItem: (k, v) => { m.set(k, String(v)); } };
}

describe("carryFromOrigins", () => {
  it("is exactly the old https origin in production", () => {
    expect(carryFromOrigins(undefined)).toEqual(["https://gridwatchmatchweb.warsignallabs.net"]);
    expect(OLD_MATCH_ORIGIN).toBe("https://gridwatchmatchweb.warsignallabs.net");
  });
  it("adds only a loopback test origin", () => {
    expect(carryFromOrigins("http://localhost:4173")).toEqual([OLD_MATCH_ORIGIN, "http://localhost:4173"]);
    expect(carryFromOrigins("https://evil.example")).toEqual([OLD_MATCH_ORIGIN]);
    expect(carryFromOrigins("http://evil.example:80")).toEqual([OLD_MATCH_ORIGIN]);
  });
});

describe("slotsToCarry / bannerState", () => {
  it("sends only non-pristine slots; nothing when everything is default", () => {
    expect(slotsToCarry(defaultSaveState())).toEqual({});
    expect(Object.keys(slotsToCarry(played(40)))).toEqual(["campaign"]);
    expect(bannerState(defaultSaveState(), null)).toBe("nothing");
    expect(bannerState(played(40), null)).toBe("move");
  });
  it("shows moved only while the old progress still equals what was sent", () => {
    const marker = markerFor(slotsToCarry(played(40)), new Date("2026-09-22T00:00:00Z"));
    expect(bannerState(played(40), marker)).toBe("moved");
    expect(bannerState(played(55), marker)).toBe("moved-again");
  });
  it("round-trips the marker and ignores a malformed one", () => {
    const storage = memoryStorage();
    const marker = markerFor(slotsToCarry(played(40)), new Date("2026-09-22T00:00:00Z"));
    writeCarryMarker(marker, storage);
    expect(readCarryMarker(storage)).toEqual(marker);
    storage.setItem("gridwatch-match-web.carry.v1", "{not json");
    expect(readCarryMarker(storage)).toBeNull();
    storage.setItem("gridwatch-match-web.carry.v1", JSON.stringify({ at: 5, sent: [] }));
    expect(readCarryMarker(storage)).toBeNull();
  });
});

describe("receiver helpers", () => {
  const incoming = { campaign: projection(played(40), "campaign") };
  it("prompts only when a slot being replaced has progress here", () => {
    expect(needsReplacePrompt(defaultSaveState(), incoming)).toBe(false);
    expect(needsReplacePrompt(played(7), incoming)).toBe(true);
    expect(needsReplacePrompt(played(7), { settings: projection(defaultSaveState(), "settings") })).toBe(false);
  });
  it("applies incoming slots through the cloud path", () => {
    expect(applyIncoming(defaultSaveState(), incoming).coins).toBe(40);
  });
  it("auto-accepts into a pristine save, asks otherwise, and declining changes nothing", async () => {
    const commit = vi.fn();
    const ask = vi.fn(async () => false);
    await expect(handleCarryOffer({ current: () => defaultSaveState(), slots: incoming, askReplace: ask, commit })).resolves.toBe("accepted");
    expect(ask).not.toHaveBeenCalled();
    expect(commit.mock.calls[0][0].coins).toBe(40);
    commit.mockClear();
    await expect(handleCarryOffer({ current: () => played(7), slots: incoming, askReplace: ask, commit })).resolves.toBe("declined");
    expect(ask).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
    await expect(handleCarryOffer({ current: () => played(7), slots: incoming, askReplace: async () => true, commit })).resolves.toBe("accepted");
    expect(commit.mock.calls[0][0].coins).toBe(40);
  });
  it("ignores slot names Match does not have", async () => {
    const commit = vi.fn();
    await expect(handleCarryOffer({ current: () => defaultSaveState(), slots: { bogus: {} }, askReplace: async () => true, commit })).resolves.toBe("declined");
    expect(commit).not.toHaveBeenCalled();
  });
});

describe("receiveCarryOnce", () => {
  beforeEach(() => resetCarryReceiveForTests());
  it("runs receive once however often it is called (React may run an effect twice)", async () => {
    const receive = vi.fn(async () => "accepted" as const);
    const [a, b] = [receiveCarryOnce(receive), receiveCarryOnce(receive)];
    expect(await a).toBe("accepted");
    expect(await b).toBe("accepted");
    expect(receive).toHaveBeenCalledTimes(1);
  });
  it("caches a synchronous throw as one rejection: receive runs once and both callers see it", async () => {
    const error = new TypeError("crypto.randomUUID is not a function");
    const receive = vi.fn((): Promise<"none"> => { throw error; });
    let a: Promise<unknown> | undefined;
    let b: Promise<unknown> | undefined;
    expect(() => { a = receiveCarryOnce(receive); b = receiveCarryOnce(receive); }).not.toThrow();
    await expect(a).rejects.toBe(error);
    await expect(b).rejects.toBe(error);
    expect(receive).toHaveBeenCalledTimes(1);
  });
});

describe("receiveCarrySafely", () => {
  beforeEach(() => resetCarryReceiveForTests());
  afterEach(() => vi.restoreAllMocks());

  it("turns a synchronous throw from receive into a settled \"failed\" with one warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let started: Promise<unknown> | undefined;
    expect(() => { started = receiveCarrySafely(() => { throw new TypeError("crypto.randomUUID is not a function"); }); }).not.toThrow();
    await expect(started).resolves.toBe("failed");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("turns a rejected receive into \"failed\" with one warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(receiveCarrySafely(() => Promise.reject(new Error("boom")))).resolves.toBe("failed");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("passes a normal result through, once per page load, without warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const receive = vi.fn(async () => "accepted" as const);
    expect(await receiveCarrySafely(receive)).toBe("accepted");
    expect(await receiveCarrySafely(receive)).toBe("accepted");
    expect(receive).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("showsCarryBanner", () => {
  const NEXUS = "https://nexus.warsignallabs.net";
  const CARRY_FROM = [OLD_MATCH_ORIGIN];
  it("shows on the old hostname, which Nexus accepts offers from", () => {
    expect(showsCarryBanner(OLD_MATCH_ORIGIN, CARRY_FROM, NEXUS)).toBe(true);
  });
  it("hides on an unlisted non-Nexus origin (e.g. the workers.dev fallback), where Nexus would reject the offer", () => {
    expect(showsCarryBanner("https://gridwatch-match-web.remeadows.workers.dev", CARRY_FROM, NEXUS)).toBe(false);
  });
  it("hides on Nexus itself, even if it were listed", () => {
    expect(showsCarryBanner(NEXUS, [...CARRY_FROM, NEXUS], NEXUS)).toBe(false);
  });
  it("shows on the loopback test origin only when it is in the list", () => {
    expect(showsCarryBanner("http://localhost:4173", carryFromOrigins("http://localhost:4173"), "http://127.0.0.1:4173")).toBe(true);
    expect(showsCarryBanner("http://localhost:4173", carryFromOrigins(undefined), "http://127.0.0.1:4173")).toBe(false);
  });
});
