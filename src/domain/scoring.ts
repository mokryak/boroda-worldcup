import type { MatchSide } from "./types";

export type Score = {
  home: number;
  away: number;
  winner?: MatchSide | null;
};

type ScorePredictionOptions = {
  includeAdvanceBonus?: boolean;
};

export function scorePrediction(
  actual: Score | null,
  prediction: Score | null,
  options: ScorePredictionOptions = {}
): number {
  if (!actual || !prediction) {
    return 0;
  }

  let points = 0;
  if (actual.home === prediction.home && actual.away === prediction.away) {
    points = 5;
  } else {
    const actualDiff = actual.home - actual.away;
    const predictedDiff = prediction.home - prediction.away;

    if (actualDiff === predictedDiff) {
      points = 4;
    } else if (outcome(actualDiff) === outcome(predictedDiff)) {
      points = 3;
    }
  }

  const actualAdvancedSide = advancedSide(actual);
  const predictedAdvancedSide = advancedSide(prediction);
  if (
    options.includeAdvanceBonus &&
    actualAdvancedSide !== null &&
    actualAdvancedSide === predictedAdvancedSide
  ) {
    points += 3;
  }

  return points;
}

export function advancedSide(score: Score | null): MatchSide | null {
  if (!score) {
    return null;
  }
  const diff = score.home - score.away;
  if (diff > 0) {
    return "home";
  }
  if (diff < 0) {
    return "away";
  }
  return score.winner ?? null;
}

function outcome(diff: number): "home" | "draw" | "away" {
  if (diff > 0) {
    return "home";
  }
  if (diff < 0) {
    return "away";
  }
  return "draw";
}
