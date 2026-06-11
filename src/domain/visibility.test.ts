import { describe, expect, it } from "vitest";
import {
  canEditMatch,
  isPredictionVisible,
  isStageClosed,
  predictionRevealAt,
  stageHasEditableMatches,
  visibleMatchIds
} from "./visibility";
import type { Match, Stage } from "./types";

const stage: Stage = {
  id: "group-md1",
  title: "Групповой этап: тур 1",
  deadlineUtc: "2026-06-11T18:00:00.000Z",
  displayOrder: 1
};

const match: Match = {
  id: "m001",
  stageId: "group-md1",
  kickoffUtc: "2026-06-11T19:00:00.000Z",
  groupOrRound: "Group A",
  home: "Mexico",
  away: "South Africa",
  actualHome: null,
  actualAway: null,
  status: "scheduled",
  displayOrder: 1
};

const laterMatch: Match = {
  ...match,
  id: "m002",
  kickoffUtc: "2026-06-13T19:00:00.000Z",
  displayOrder: 2
};

const stageMatches = [match, laterMatch];

describe("match visibility", () => {
  it("keeps first stage match editable and hidden until the stage starts", () => {
    const now = new Date("2026-06-11T18:59:59.000Z");

    expect(predictionRevealAt(match, stageMatches).toISOString()).toBe("2026-06-11T19:00:00.000Z");
    expect(canEditMatch(match, now, stageMatches)).toBe(true);
    expect(isPredictionVisible(match, now, stageMatches)).toBe(false);
    expect(visibleMatchIds(stageMatches, now).has(match.id)).toBe(false);
  });

  it("locks and shows first stage match exactly when the stage starts", () => {
    const now = new Date("2026-06-11T19:00:00.000Z");

    expect(canEditMatch(match, now, stageMatches)).toBe(false);
    expect(isPredictionVisible(match, now, stageMatches)).toBe(true);
    expect(visibleMatchIds(stageMatches, now).has(match.id)).toBe(true);
  });

  it("uses the 24 hour reveal window for later stage matches", () => {
    expect(predictionRevealAt(laterMatch, stageMatches).toISOString()).toBe("2026-06-12T19:00:00.000Z");
    expect(canEditMatch(laterMatch, new Date("2026-06-12T18:59:59.000Z"), stageMatches)).toBe(true);
    expect(canEditMatch(laterMatch, new Date("2026-06-12T19:00:00.000Z"), stageMatches)).toBe(false);
  });

  it("keeps predictions locked and visible after kickoff", () => {
    const now = new Date("2026-06-11T19:00:01.000Z");

    expect(canEditMatch(match, now, stageMatches)).toBe(false);
    expect(isPredictionVisible(match, now, stageMatches)).toBe(true);
  });

  it("derives stage status from its matches", () => {
    expect(stageHasEditableMatches(stage, [match], new Date("2026-06-11T18:59:59.000Z"))).toBe(true);
    expect(isStageClosed(stage, [match], new Date("2026-06-11T19:00:00.000Z"))).toBe(true);
    expect(stageHasEditableMatches(stage, stageMatches, new Date("2026-06-11T19:00:00.000Z"))).toBe(true);
  });
});
