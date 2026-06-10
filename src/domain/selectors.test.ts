import { describe, expect, it } from "vitest";
import { getLeaderboard } from "./selectors";
import type { PublicState } from "./types";

const state: PublicState = {
  tournamentName: "Test",
  generatedAt: "2026-06-12T00:00:00.000Z",
  stages: [
    {
      id: "group-md1",
      title: "Групповой этап: тур 1",
      deadlineUtc: "2026-06-11T18:00:00.000Z",
      displayOrder: 1
    }
  ],
  matches: [
    {
      id: "m001",
      stageId: "group-md1",
      kickoffUtc: "2026-06-11T19:00:00.000Z",
      groupOrRound: "Group A",
      home: "Mexico",
      away: "South Africa",
      actualHome: 2,
      actualAway: 1,
      status: "complete",
      displayOrder: 1
    }
  ],
  participants: [
    { id: "p1", displayName: "A", createdAt: "2026-06-10T00:00:00.000Z" },
    { id: "p2", displayName: "B", createdAt: "2026-06-10T00:00:00.000Z" }
  ],
  predictions: [
    {
      participantId: "p1",
      matchId: "m001",
      predHome: 2,
      predAway: 1,
      updatedAt: "2026-06-10T00:00:00.000Z"
    },
    {
      participantId: "p2",
      matchId: "m001",
      predHome: 1,
      predAway: 0,
      updatedAt: "2026-06-10T00:00:00.000Z"
    }
  ],
  submittedStages: [{ stageId: "group-md1", participantIds: ["p1", "p2"] }]
};

describe("getLeaderboard", () => {
  it("uses only stages visible after deadline", () => {
    expect(getLeaderboard(state, new Date("2026-06-11T17:59:59.000Z")).map((row) => row.total)).toEqual([
      0,
      0
    ]);
    expect(getLeaderboard(state, new Date("2026-06-11T18:00:00.000Z")).map((row) => row.total)).toEqual([
      5,
      4
    ]);
  });
});
