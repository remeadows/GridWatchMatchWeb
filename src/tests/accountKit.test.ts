import { describe, expect, it } from "vitest";
import { accountKit, carryFrom, readPreviewOrigin } from "../services/accountKit";
describe("account kit wiring", () => {
  it("is configured for /play/match/ on the Nexus origin", () => {
    expect(accountKit.config).toEqual({ returnPath: "/play/match/", nexusOrigin: "https://nexus.warsignallabs.net" });
    expect(accountKit.signInUrl()).toBe("https://nexus.warsignallabs.net/account/sign-in?return=%2Fplay%2Fmatch%2F");
  });
  it("exports the carryFrom list it hands the kit, so the banner gate and the kit cannot drift", () => {
    expect(carryFrom).toEqual(["https://gridwatchmatchweb.warsignallabs.net"]);
    expect(accountKit.saves?.game.carryFrom).toBe(carryFrom);
  });
  it("readPreviewOrigin accepts only absolute http(s) URLs", () => {
    expect(readPreviewOrigin(undefined)).toBeUndefined();
    expect(readPreviewOrigin("")).toBeUndefined();
    expect(readPreviewOrigin("not a url")).toBeUndefined();
    expect(readPreviewOrigin("ftp://x.example")).toBeUndefined();
    expect(readPreviewOrigin("https://preview.example.dev/path?x=1")).toBe("https://preview.example.dev");
    expect(readPreviewOrigin("http://localhost:5173/")).toBe("http://localhost:5173");
  });
  it("enables the kit saves client for the two Match slots", () => {
    expect(accountKit.saves?.game).toEqual({
      gameSlug: "gridwatch-match", routeAlias: "match", slots: ["campaign", "settings"], schemaVersion: 1,
      carryFrom: ["https://gridwatchmatchweb.warsignallabs.net"],
    });
  });
});
