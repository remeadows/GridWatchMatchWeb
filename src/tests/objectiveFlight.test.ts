import { describe, expect, it } from "vitest";

import {
  OBJECTIVE_FLIGHT_CAP,
  flightKeyframes,
  landPiece,
  launchPiece,
  malwareCountShown,
  objectiveCountShown,
  skipPiece,
  type ObjectiveFlightCounts
} from "../game/objectiveFlight";

describe("the objective count while pieces are in the air", () => {
  it("shows the real count when nothing is flying", () => {
    expect(objectiveCountShown({}, "packets", 7)).toBe(7);
  });

  it("holds the count at takeoff, even though the real count moves on before the pieces land", () => {
    let counts: ObjectiveFlightCounts = {};
    counts = launchPiece(counts, "packets", 7);
    counts = launchPiece(counts, "packets", 7);
    counts = launchPiece(counts, "packets", 7);
    expect(objectiveCountShown(counts, "packets", 7)).toBe(7);
    expect(objectiveCountShown(counts, "packets", 10)).toBe(7);
  });

  it("adds one as each piece lands, and ends on the real count", () => {
    let counts: ObjectiveFlightCounts = {};
    counts = launchPiece(counts, "packets", 7);
    counts = launchPiece(counts, "packets", 7);
    counts = landPiece(counts, "packets");
    expect(objectiveCountShown(counts, "packets", 9)).toBe(8);
    counts = landPiece(counts, "packets");
    expect(objectiveCountShown(counts, "packets", 9)).toBe(9);
    expect(counts.packets).toBeUndefined();
  });

  it("never shows more than the real count when a piece lands before the board has caught up", () => {
    let counts: ObjectiveFlightCounts = {};
    counts = launchPiece(counts, "packets", 7);
    counts = launchPiece(counts, "packets", 7);
    counts = landPiece(counts, "packets");
    expect(objectiveCountShown(counts, "packets", 7)).toBe(7);
  });

  it("does not hold back a piece that never flew", () => {
    let counts: ObjectiveFlightCounts = {};
    counts = launchPiece(counts, "packets", 7);
    counts = skipPiece(counts, "packets");
    expect(objectiveCountShown(counts, "packets", 9)).toBe(8);
  });

  it("keeps each objective's count apart", () => {
    let counts: ObjectiveFlightCounts = {};
    counts = launchPiece(counts, "packets", 7);
    expect(objectiveCountShown(counts, "keys", 3)).toBe(3);
    counts = landPiece(counts, "keys");
    expect(objectiveCountShown(counts, "packets", 9)).toBe(7);
  });

  it("caps how many pieces fly at once", () => {
    expect(OBJECTIVE_FLIGHT_CAP).toBeLessThanOrEqual(20);
  });
});

describe("a piece's flight to the objective", () => {
  const from = { x: 100, y: 500 };
  const to = { x: 300, y: 80 };
  const frames = flightKeyframes(from, to, 60, 40);

  it("starts on the piece's own cell at its own size", () => {
    expect(frames[0].x).toBeCloseTo(0, 5);
    expect(frames[0].y).toBeCloseTo(0, 5);
    expect(frames[0].scale).toBeCloseTo(1, 5);
  });

  it("ends on the objective at the objective's size", () => {
    expect(frames.at(-1)).toMatchObject({ x: 200, y: -420, opacity: 1 });
    expect(frames.at(-1)?.scale).toBeCloseTo(40 / 60, 5);
  });

  it("swells as it leaves, so it reads as lifted off the board", () => {
    expect(Math.max(...frames.map((frame) => frame.scale))).toBeGreaterThan(1.1);
  });

  it("curves rather than flying a straight line", () => {
    const middle = frames[Math.floor(frames.length / 2)];
    const straightX = (middle.y / -420) * 200;
    expect(Math.abs(middle.x - straightX)).toBeGreaterThan(10);
  });

  it("is slow to leave and fastest as it arrives", () => {
    const step = (index: number) => Math.hypot(frames[index + 1].x - frames[index].x, frames[index + 1].y - frames[index].y);
    expect(step(frames.length - 2)).toBeGreaterThan(step(1));
  });

  it("offers evenly spaced keyframes in order", () => {
    frames.forEach((frame, index) => expect(frame.offset).toBeCloseTo(index / (frames.length - 1), 5));
  });
});

describe("the malware count while pieces are in the air", () => {
  it("never rises at takeoff, and drops by one on each landing", () => {
    let counts = launchPiece({}, "malware", 3);
    counts = launchPiece(counts, "malware", 3);
    // The true count has already fallen to 1 at the end of the step; the chip waits for the landings.
    expect(malwareCountShown(counts, 1)).toBe(3);
    counts = landPiece(counts, "malware");
    expect(malwareCountShown(counts, 1)).toBe(2);
    counts = landPiece(counts, "malware");
    expect(counts).toEqual({});
    expect(malwareCountShown(counts, 1)).toBe(1);
  });

  it("shows nothing different when nothing flies, and lets spread raise the count", () => {
    expect(malwareCountShown({}, 4)).toBe(4);
    expect(malwareCountShown(launchPiece({}, "malware", 2), 5)).toBe(5);
  });

  it("a malware piece over the cap counts at once", () => {
    const counts = skipPiece(launchPiece({}, "malware", 4), "malware");
    expect(malwareCountShown(counts, 2)).toBe(3);
  });
});
