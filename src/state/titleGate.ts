// The title screen (Russ, 2026-10-10: "Music guaranteed on the first screen using 'one tap' is
// fine. Sort of like we did for Drift."). A browser will not play a note until the page has been
// touched, so the game opens on its title with "tap to enter" where the menu's actions will be,
// and that first tap or key is what lets the music come up with the menu.

/** Whether a page load opens on the title: there has to be music to start, and test mode jumps past it. */
export function opensOnTitle(search: string, musicEnabled: boolean): boolean {
  return musicEnabled && !new URLSearchParams(search).has("gwTestMode");
}

const KEYS_THAT_DO_NOT_ENTER = new Set(["Tab", "Escape", "Shift", "Control", "Alt", "Meta"]);

/** The first key opens the menu, except the keys that walk focus to the button, dismiss, or only modify. */
export function keyEntersMenu(key: string): boolean {
  return !KEYS_THAT_DO_NOT_ENTER.has(key);
}
