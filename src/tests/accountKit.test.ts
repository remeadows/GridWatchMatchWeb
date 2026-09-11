import { describe, expect, it } from "vitest";
import { accountKit } from "../services/accountKit";
describe("account kit wiring", () => {
  it("is configured for /play/match/ on the Nexus origin", () => {
    expect(accountKit.config).toEqual({ returnPath: "/play/match/", nexusOrigin: "https://nexus.warsignallabs.net" });
    expect(accountKit.signInUrl()).toBe("https://nexus.warsignallabs.net/account/sign-in?return=%2Fplay%2Fmatch%2F");
  });
});
