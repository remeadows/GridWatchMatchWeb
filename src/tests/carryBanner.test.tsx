// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SendResult } from "@gridwatch/account-kit";
import { CarryBanner } from "../components/CarryBanner";
import { CARRY_MARKER_KEY, markerFor, slotsToCarry } from "../services/carryOver";
import { projection } from "../state/cloudSaves";
import { defaultSaveState, type SaveState } from "../state/save";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NEXUS_URL = "https://gridwatch.warsignallabs.net/play/match/";
const played = (coins: number): SaveState => ({ ...defaultSaveState(), coins });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function fakeCarry(result: Promise<SendResult> = new Promise<SendResult>(() => {})) {
  return { send: vi.fn((_slots: Record<string, Record<string, unknown>>) => result) };
}

function render(save: SaveState, carry = fakeCarry()) {
  act(() => root.render(<CarryBanner save={save} carry={carry} nexusUrl={NEXUS_URL} />));
  return carry;
}

function link(text: string): HTMLAnchorElement | undefined {
  return [...container.querySelectorAll("a")].find((a) => a.textContent === text);
}

function moveButton(): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find((b) => b.textContent === "Move my progress");
}

function seedMarkerFor(save: SaveState) {
  localStorage.setItem(CARRY_MARKER_KEY, JSON.stringify(markerFor(slotsToCarry(save), new Date("2026-09-22T00:00:00Z"))));
}

describe("CarryBanner", () => {
  it("nothing: a default save links to the new site and offers no move", () => {
    render(defaultSaveState());
    expect(container.textContent).toContain("GridWatch Match has moved.");
    expect(link("Play on the new site")?.getAttribute("href")).toBe(NEXUS_URL);
    expect(moveButton()).toBeUndefined();
  });

  it("move: progress offers the move, and the click calls send synchronously with the projection", () => {
    const save = played(40);
    const carry = render(save);
    expect(container.textContent).toContain("GridWatch Match has moved to the GridWatch site.");
    const button = moveButton();
    expect(button).toBeDefined();
    act(() => {
      button!.click();
      // Before any await: window.open has to happen inside the click.
      expect(carry.send).toHaveBeenCalledTimes(1);
    });
    expect(carry.send).toHaveBeenCalledWith({ campaign: projection(save, "campaign") });
  });

  it("accepted: shows the moved state and records a campaign fingerprint", async () => {
    const carry = render(played(40), fakeCarry(Promise.resolve("accepted")));
    await act(async () => { moveButton()!.click(); });
    expect(carry.send).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Your progress is on the new site.");
    expect(link("Continue there")?.getAttribute("href")).toBe(NEXUS_URL);
    expect(moveButton()).toBeUndefined();
    const stored = JSON.parse(localStorage.getItem("gridwatch-match-web.carry.v1") ?? "null") as { sent?: Record<string, unknown> } | null;
    expect(typeof stored?.sent?.campaign).toBe("string");
  });

  it("moved-again: new progress after a move offers the move again", () => {
    seedMarkerFor(played(40));
    render(played(55));
    expect(container.textContent).toContain("You have new progress since you moved.");
    expect(moveButton()).toBeDefined();
  });

  it.each<[SendResult, string]>([
    ["declined", "You kept the progress already on the new site. Nothing changed here."],
    ["rejected", "The new site couldn't read this progress. Nothing changed here."],
    ["blocked", "Your browser blocked the new tab. Allow pop-ups for this site and try again."],
    ["closed", "The new site closed before the move finished. Try again."],
    ["timeout", "The new site didn't answer. If you opened GridWatch from your Home Screen, open this page in Safari and try again."],
  ])("%s: shows its message and keeps the move available", async (result, message) => {
    render(played(40), fakeCarry(Promise.resolve(result)));
    await act(async () => { moveButton()!.click(); });
    expect(container.querySelector("[role=status]")?.textContent).toBe(message);
    expect(moveButton()?.disabled).toBe(false);
    expect(localStorage.getItem(CARRY_MARKER_KEY)).toBeNull();
  });

  it("uses no inline styles in any state", async () => {
    render(defaultSaveState());
    expect(container.querySelector("[style]")).toBeNull();
    render(played(40), fakeCarry(Promise.resolve("blocked")));
    await act(async () => { moveButton()!.click(); });
    expect(container.querySelector("[style]")).toBeNull();
    seedMarkerFor(played(40));
    act(() => root.unmount());
    root = createRoot(container);
    render(played(40));
    expect(container.textContent).toContain("Your progress is on the new site.");
    expect(container.querySelector("[style]")).toBeNull();
  });

  it("a save canonicalJson cannot encode falls back to the nothing banner with one warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    seedMarkerFor(played(40));
    render(played(Number.NaN));
    render(played(Number.NaN));
    expect(container.textContent).toContain("GridWatch Match has moved.");
    expect(link("Play on the new site")?.getAttribute("href")).toBe(NEXUS_URL);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
