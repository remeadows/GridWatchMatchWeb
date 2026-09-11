import { afterEach, describe, expect, it, vi } from "vitest";

import { apiUrl, appReturnUrl } from "../services/appUrls";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("appUrls", () => {
  it("builds API paths under the Vite base", () => {
    vi.stubEnv("BASE_URL", "/play/match/");
    expect(apiUrl("score")).toBe("/play/match/api/score");
    expect(apiUrl("/score")).toBe("/play/match/api/score");
  });

  it("tolerates a base without a trailing slash", () => {
    vi.stubEnv("BASE_URL", "/play/match");
    expect(apiUrl("score")).toBe("/play/match/api/score");
  });

  it("still works at the host root", () => {
    vi.stubEnv("BASE_URL", "/");
    expect(apiUrl("score")).toBe("/api/score");
  });

  it("returns the absolute app root for auth redirects", () => {
    vi.stubEnv("BASE_URL", "/play/match/");
    vi.stubGlobal("window", { location: { origin: "https://nexus.warsignallabs.net" } });
    expect(appReturnUrl()).toBe("https://nexus.warsignallabs.net/play/match/");
  });
});
