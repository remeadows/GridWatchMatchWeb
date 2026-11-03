import { describe, expect, it } from "vitest";
import { areas, campaignLevelCount } from "../data/areas";
import { validateSubmission } from "../../worker/validation";

describe("campaign length", () => {
  it("takes campaign length from the last sector", () => {
    expect(campaignLevelCount).toBe(areas[areas.length - 1].lastLevel);
  });

  it("rejects a level past the end of the campaign", () => {
    const result = validateSubmission({ levelId: campaignLevelCount + 1 });
    expect(result).toEqual({ ok: false, error: "Unknown level." });
  });
});
