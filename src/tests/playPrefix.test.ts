import { describe, expect, it } from "vitest";

import { PLAY_PREFIX, redirectStatusFor, rewritePlayPath } from "../../worker/playPrefix";

describe("rewritePlayPath", () => {
  it("serves paths under the prefix with the prefix stripped", () => {
    expect(rewritePlayPath("/play/match/")).toEqual({ kind: "serve", pathname: "/" });
    expect(rewritePlayPath("/play/match/assets/app.js")).toEqual({ kind: "serve", pathname: "/assets/app.js" });
    expect(rewritePlayPath("/play/match/api/score")).toEqual({ kind: "serve", pathname: "/api/score" });
    expect(rewritePlayPath("/play/match/GridWatchMatchWeb/")).toEqual({ kind: "serve", pathname: "/GridWatchMatchWeb/" });
  });

  it("redirects the bare prefix to its trailing-slash form", () => {
    expect(rewritePlayPath("/play/match")).toEqual({ kind: "redirect", location: "/play/match/" });
  });

  it("redirects legacy root-served paths into the prefix so old links keep working", () => {
    expect(rewritePlayPath("/")).toEqual({ kind: "redirect", location: "/play/match/" });
    expect(rewritePlayPath("/GridWatchMatchWeb/")).toEqual({ kind: "redirect", location: "/play/match/GridWatchMatchWeb/" });
    expect(rewritePlayPath("/api/score")).toEqual({ kind: "redirect", location: "/play/match/api/score" });
  });

  it("does not treat a look-alike prefix as the game prefix", () => {
    expect(rewritePlayPath("/play/matchmaker/")).toEqual({ kind: "redirect", location: "/play/match/play/matchmaker/" });
  });

  it("exports the prefix Nexus proxies to", () => {
    expect(PLAY_PREFIX).toBe("/play/match");
  });

  it("chooses a method-preserving redirect status for non-GET legacy requests", () => {
    expect(redirectStatusFor("GET")).toBe(301);
    expect(redirectStatusFor("HEAD")).toBe(301);
    expect(redirectStatusFor("POST")).toBe(308);
    expect(redirectStatusFor("PUT")).toBe(308);
  });
});
