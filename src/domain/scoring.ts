export type Score = {
  home: number;
  away: number;
};

export function scorePrediction(actual: Score | null, prediction: Score | null): number {
  if (!actual || !prediction) {
    return 0;
  }

  if (actual.home === prediction.home && actual.away === prediction.away) {
    return 5;
  }

  const actualDiff = actual.home - actual.away;
  const predictedDiff = prediction.home - prediction.away;

  if (actualDiff === predictedDiff) {
    return 4;
  }

  if (outcome(actualDiff) === outcome(predictedDiff)) {
    return 3;
  }

  return 0;
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
