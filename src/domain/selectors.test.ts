import { describe, expect, it } from "vitest";
import {
  getLeaderboard,
  getMatchScoreForParticipant,
  getOpenStage,
  getStandingsAfterMatch
} from "./selectors";
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
      actualWinner: null,
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
  submittedStages: [{ stageId: "group-md1", participantIds: ["p1", "p2"] }],
  submittedMatches: [{ matchId: "m001", participantIds: ["p1", "p2"] }]
};

describe("getLeaderboard", () => {
  it("uses only matches visible after the stage-start adjusted reveal window", () => {
    expect(getLeaderboard(state, new Date("2026-06-11T18:59:59.000Z")).map((row) => row.total)).toEqual([
      0,
      0
    ]);
    expect(getLeaderboard(state, new Date("2026-06-11T19:00:00.000Z")).map((row) => row.total)).toEqual([
      5,
      4
    ]);
  });

  it("keeps a stage open while any match can still be edited", () => {
    const mixedState: PublicState = {
      ...state,
      matches: [
        state.matches[0],
        {
          ...state.matches[0],
          id: "m002",
          kickoffUtc: "2026-06-13T19:00:00.000Z",
          displayOrder: 2
        }
      ]
    };

    expect(getOpenStage(mixedState, new Date("2026-06-11T19:00:00.000Z"))?.id).toBe("group-md1");
    expect(getOpenStage(mixedState, new Date("2026-06-12T19:00:00.000Z"))).toBeNull();
  });

  it("can score a participant against a live score without waiting for the final result", () => {
    const liveState: PublicState = {
      ...state,
      matches: [{ ...state.matches[0], actualHome: null, actualAway: null, status: "scheduled" }]
    };

    expect(
      getMatchScoreForParticipant(liveState.matches[0], liveState.participants[0], liveState.predictions, {
        matchId: "m001",
        home: 2,
        away: 1,
        status: "live",
        minute: 63,
        updatedAt: "2026-06-11T20:03:00.000Z"
      })
    ).toBe(5);
  });

  it("computes total and rank after a selected match", () => {
    const standings = getStandingsAfterMatch(state, state.matches[0], new Map(), new Date("2026-06-11T19:00:00.000Z"));

    expect(standings.get("p1")).toEqual({ matchPoints: 5, total: 5, rank: 1 });
    expect(standings.get("p2")).toEqual({ matchPoints: 4, total: 4, rank: 2 });
  });

  it("includes advancement points for knockout matches", () => {
    const knockoutState: PublicState = {
      ...state,
      stages: [{ id: "r32", title: "1/16 финала", deadlineUtc: "2026-07-01T00:00:00.000Z", displayOrder: 4 }],
      matches: [{ ...state.matches[0], stageId: "r32", actualHome: 1, actualAway: 1, actualWinner: "away" }],
      predictions: [
        { ...state.predictions[0], predHome: 2, predAway: 2, predictedWinner: "away" },
        { ...state.predictions[1], predHome: 1, predAway: 2 }
      ],
      submittedStages: [{ stageId: "r32", participantIds: ["p1", "p2"] }]
    };

    expect(getLeaderboard(knockoutState, new Date("2026-06-11T19:00:00.000Z")).map((row) => row.total)).toEqual([
      7,
      3
    ]);
  });
});
