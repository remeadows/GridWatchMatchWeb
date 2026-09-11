import { describe, expect, it } from "vitest";
import { accountKit, readPreviewOrigin } from "../services/accountKit";
describe("account kit wiring", () => {
  it("is configured for /play/match/ on the Nexus origin", () => {
    expect(accountKit.config).toEqual({ returnPath: "/play/match/", nexusOrigin: "https://nexus.warsignallabs.net" });
    expect(accountKit.signInUrl()).toBe("https://nexus.warsignallabs.net/account/sign-in?return=%2Fplay%2Fmatch%2F");
  });
  it("readPreviewOrigin accepts only absolute http(s) URLs", () => {
    expect(readPreviewOrigin(undefined)).toBeUndefined();
    expect(readPreviewOrigin("")).toBeUndefined();
    expect(readPreviewOrigin("not a url")).toBeUndefined();
    expect(readPreviewOrigin("ftp://x.example")).toBeUndefined();
    expect(readPreviewOrigin("https://preview.example.dev/path?x=1")).toBe("https://preview.example.dev");
    expect(readPreviewOrigin("http://localhost:5173/")).toBe("http://localhost:5173");
  });
});
