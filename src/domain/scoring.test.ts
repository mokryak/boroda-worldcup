import { describe, expect, it } from "vitest";
import { scorePrediction } from "./scoring";

describe("scorePrediction", () => {
  it("gives 5 points for exact score", () => {
    expect(scorePrediction({ home: 2, away: 1 }, { home: 2, away: 1 })).toBe(5);
  });

  it("gives 4 points for same goal difference", () => {
    expect(scorePrediction({ home: 3, away: 1 }, { home: 2, away: 0 })).toBe(4);
  });

  it("gives 4 points for non-exact draw", () => {
    expect(scorePrediction({ home: 1, away: 1 }, { home: 0, away: 0 })).toBe(4);
  });

  it("gives 3 points for correct outcome only", () => {
    expect(scorePrediction({ home: 2, away: 0 }, { home: 1, away: 0 })).toBe(3);
  });

  it("gives 0 points for wrong outcome", () => {
    expect(scorePrediction({ home: 2, away: 0 }, { home: 0, away: 1 })).toBe(0);
  });

  it("adds 3 playoff points for the team that advances on a decisive score", () => {
    expect(
      scorePrediction({ home: 3, away: 1 }, { home: 3, away: 1 }, { includeAdvanceBonus: true })
    ).toBe(8);
    expect(
      scorePrediction({ home: 3, away: 1 }, { home: 2, away: 0 }, { includeAdvanceBonus: true })
    ).toBe(7);
    expect(
      scorePrediction({ home: 3, away: 1 }, { home: 1, away: 0 }, { includeAdvanceBonus: true })
    ).toBe(6);
    expect(
      scorePrediction(
        { home: 3, away: 1 },
        { home: 1, away: 1, winner: "home" },
        { includeAdvanceBonus: true }
      )
    ).toBe(3);
  });

  it("uses the selected advancing team when a playoff match is tied after extra time", () => {
    expect(
      scorePrediction(
        { home: 1, away: 1, winner: "away" },
        { home: 1, away: 1, winner: "home" },
        { includeAdvanceBonus: true }
      )
    ).toBe(5);
    expect(
      scorePrediction(
        { home: 1, away: 1, winner: "away" },
        { home: 2, away: 2, winner: "away" },
        { includeAdvanceBonus: true }
      )
    ).toBe(7);
    expect(
      scorePrediction(
        { home: 1, away: 1, winner: "away" },
        { home: 1, away: 2 },
        { includeAdvanceBonus: true }
      )
    ).toBe(3);
  });
});
