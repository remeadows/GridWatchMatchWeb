import { describe, expect, it } from "vitest";

import { keyEntersMenu, opensOnTitle } from "../state/titleGate";

describe("the title screen before the main menu", () => {
  it("opens on the title when there is music to start", () => {
    expect(opensOnTitle("", true)).toBe(true);
    expect(opensOnTitle("?theme=dark", true)).toBe(true);
  });

  it("goes straight to the menu when the music is switched off", () => {
    expect(opensOnTitle("", false)).toBe(false);
  });

  it("goes straight to the menu in test mode, which jumps past it", () => {
    expect(opensOnTitle("?gwTestMode=1", true)).toBe(false);
    expect(opensOnTitle("?gwTestMode=1&level=7", true)).toBe(false);
  });

  it("enters on any key but the ones that move focus, close things or only modify", () => {
    for (const key of ["Enter", " ", "a", "ArrowDown", "F"]) expect(keyEntersMenu(key)).toBe(true);
    for (const key of ["Tab", "Escape", "Shift", "Control", "Alt", "Meta"]) expect(keyEntersMenu(key)).toBe(false);
  });
});
