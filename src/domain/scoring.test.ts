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
});
