import { scorePrediction } from "./scoring";
import type { LiveScore, Match, Participant, Prediction, PublicState, Stage, StageId } from "./types";
import { canEditMatch, isPredictionVisible, stageHasEditableMatches } from "./visibility";

const MATCHDAY_BREAK_HOURS = 10;
const MATCHDAY_BREAK_MS = MATCHDAY_BREAK_HOURS * 60 * 60 * 1000;

export function sortStages(stages: Stage[]): Stage[] {
  return [...stages].sort((a, b) => a.displayOrder - b.displayOrder);
}

export function sortMatches(matches: Match[]): Match[] {
  return [...matches].sort((a, b) => {
    const byOrder = a.displayOrder - b.displayOrder;
    if (byOrder !== 0) {
      return byOrder;
    }
    return new Date(a.kickoffUtc).getTime() - new Date(b.kickoffUtc).getTime();
  });
}

export function getOpenStage(state: PublicState, now = new Date()): Stage | null {
  return (
    sortStages(state.stages).find((stage) => stageHasEditableMatches(stage, state.matches, now)) ?? null
  );
}

export function getMatchesForStage(state: PublicState, stageId: StageId): Match[] {
  return sortMatches(state.matches.filter((match) => match.stageId === stageId));
}

export function getPredictionMap(predictions: Prediction[]): Map<string, Prediction> {
  const map = new Map<string, Prediction>();
  for (const prediction of predictions) {
    map.set(`${prediction.participantId}:${prediction.matchId}`, prediction);
  }
  return map;
}

export function getParticipantStageSubmission(
  state: PublicState,
  stageId: StageId,
  participantId: string
): boolean {
  return (
    state.submittedStages
      .find((submittedStage) => submittedStage.stageId === stageId)
      ?.participantIds.includes(participantId) ?? false
  );
}

export function getParticipantMatchSubmission(
  state: PublicState,
  matchId: string,
  participantId: string
): boolean {
  return (
    state.submittedMatches
      .find((submittedMatch) => submittedMatch.matchId === matchId)
      ?.participantIds.includes(participantId) ?? false
  );
}

export function getLeaderboard(state: PublicState, now = new Date()) {
  const predictionMap = getPredictionMap(state.predictions);

  return [...state.participants]
    .map((participant) => {
      const total = state.matches.reduce((sum, match) => {
        if (!isPredictionVisible(match, now, state.matches)) {
          return sum;
        }

        const prediction = predictionMap.get(`${participant.id}:${match.id}`);
        return (
          sum +
          scorePrediction(
            actualScore(match),
            predictionScore(prediction),
            { includeAdvanceBonus: isKnockoutMatch(match) }
          )
        );
      }, 0);

      return { participant, total };
    })
    .sort((a, b) => b.total - a.total || a.participant.displayName.localeCompare(b.participant.displayName));
}

export type MatchdayLeaderboardDelta = {
  points: number;
  rankChange: number;
};

export type MatchdayLeaderboardSummary = {
  deltas: Map<string, MatchdayLeaderboardDelta>;
};

export function getLatestMatchdayLeaderboardSummary(
  state: PublicState,
  liveScoreMap = getLiveScoreMap(state.liveScores),
  now = new Date()
): MatchdayLeaderboardSummary | null {
  const predictionMap = getPredictionMap(state.predictions);
  const sortedMatches = sortMatchesChronologically(state.matches);
  const scoredMatches = sortedMatches.filter((match) => {
    if (!isPredictionVisible(match, now, state.matches)) {
      return false;
    }
    return Boolean(matchScore(match, liveScoreMap.get(match.id)));
  });

  const latestScoredMatch = scoredMatches[scoredMatches.length - 1];
  if (!latestScoredMatch) {
    return null;
  }

  const matchdayMatchIds = getScheduleMatchdayMatchIds(sortedMatches, latestScoredMatch);
  const matchdayMatches = scoredMatches.filter((match) => matchdayMatchIds.has(match.id));
  const previousMatches = scoredMatches.filter((match) => !matchdayMatchIds.has(match.id));
  const totalsBefore = scoreMatchesForParticipants(state, previousMatches, predictionMap, liveScoreMap);
  const matchdayPoints = scoreMatchesForParticipants(state, matchdayMatches, predictionMap, liveScoreMap);
  const totalsAfter = new Map<string, number>();

  state.participants.forEach((participant) => {
    totalsAfter.set(
      participant.id,
      (totalsBefore.get(participant.id) ?? 0) + (matchdayPoints.get(participant.id) ?? 0)
    );
  });

  const ranksBefore = previousMatches.length ? rankParticipants(state, totalsBefore) : new Map<string, number>();
  const ranksAfter = rankParticipants(state, totalsAfter);
  const deltas = new Map<string, MatchdayLeaderboardDelta>();

  state.participants.forEach((participant) => {
    const rankBefore = ranksBefore.get(participant.id);
    const rankAfter = ranksAfter.get(participant.id);
    deltas.set(participant.id, {
      points: matchdayPoints.get(participant.id) ?? 0,
      rankChange: rankBefore && rankAfter ? rankBefore - rankAfter : 0
    });
  });

  return {
    deltas
  };
}

export function getStandingsAfterMatch(
  state: PublicState,
  targetMatch: Match,
  liveScoreMap = getLiveScoreMap(state.liveScores),
  now = new Date()
): Map<string, { matchPoints: number; total: number; rank: number }> {
  const totals = new Map<string, { matchPoints: number; total: number; rank: number }>();
  const predictionMap = getPredictionMap(state.predictions);
  const sortedMatches = sortMatchesChronologically(state.matches);
  const targetIndex = sortedMatches.findIndex((match) => match.id === targetMatch.id);
  const matchesToScore = targetIndex >= 0 ? sortedMatches.slice(0, targetIndex + 1) : [targetMatch];

  state.participants.forEach((participant) => {
    let total = 0;
    let targetPoints = 0;

    matchesToScore.forEach((match) => {
      if (!isPredictionVisible(match, now, state.matches)) {
        return;
      }

      const prediction = predictionMap.get(`${participant.id}:${match.id}`);
      const points = scorePrediction(
        matchScore(match, liveScoreMap.get(match.id)),
        predictionScore(prediction),
        { includeAdvanceBonus: isKnockoutMatch(match) }
      );
      total += points;
      if (match.id === targetMatch.id) {
        targetPoints = points;
      }
    });

    totals.set(participant.id, { matchPoints: targetPoints, total, rank: 0 });
  });

  const sortedTotals = [...totals.entries()].sort(
    (left, right) =>
      right[1].total - left[1].total ||
      participantName(state, left[0]).localeCompare(participantName(state, right[0]))
  );
  let lastTotal: number | null = null;
  let lastRank = 0;
  sortedTotals.forEach(([participantId, row], index) => {
    if (lastTotal === null || row.total !== lastTotal) {
      lastRank = index + 1;
      lastTotal = row.total;
    }
    totals.set(participantId, { ...row, rank: lastRank });
  });

  return totals;
}

export function getEditableMatchesForStage(state: PublicState, stageId: StageId, now = new Date()): Match[] {
  const matches = getMatchesForStage(state, stageId);
  return matches.filter((match) => canEditMatch(match, now, matches));
}

export function getMatchScoreForParticipant(
  match: Match,
  participant: Participant,
  predictions: Prediction[],
  liveScore?: LiveScore
): number {
  const prediction = predictions.find(
    (item) => item.matchId === match.id && item.participantId === participant.id
  );

  return scorePrediction(
    matchScore(match, liveScore),
    predictionScore(prediction),
    { includeAdvanceBonus: isKnockoutMatch(match) }
  );
}

export function actualScore(match: Match) {
  if (match.actualHome === null || match.actualAway === null) {
    return null;
  }
  return { home: match.actualHome, away: match.actualAway, winner: match.actualWinner ?? null };
}

export function getLiveScoreMap(liveScores: LiveScore[] = []): Map<string, LiveScore> {
  return new Map(liveScores.map((liveScore) => [liveScore.matchId, liveScore]));
}

export function matchScore(match: Match, liveScore?: LiveScore) {
  if (liveScore) {
    return { home: liveScore.home, away: liveScore.away };
  }
  return actualScore(match);
}

function participantName(state: PublicState, participantId: string) {
  return state.participants.find((participant) => participant.id === participantId)?.displayName ?? "";
}

export function isKnockoutMatch(match: Pick<Match, "stageId">): boolean {
  return !match.stageId.startsWith("group-");
}

export function predictionScore(prediction: Prediction | undefined) {
  if (!prediction) {
    return null;
  }
  return {
    home: prediction.predHome,
    away: prediction.predAway,
    winner: prediction.predictedWinner ?? null
  };
}

function sortMatchesChronologically(matches: Match[]): Match[] {
  return [...matches].sort((a, b) => {
    const byKickoff = new Date(a.kickoffUtc).getTime() - new Date(b.kickoffUtc).getTime();
    if (byKickoff !== 0) {
      return byKickoff;
    }
    return a.displayOrder - b.displayOrder;
  });
}

function scoreMatchesForParticipants(
  state: PublicState,
  matches: Match[],
  predictionMap: Map<string, Prediction>,
  liveScoreMap: Map<string, LiveScore>
): Map<string, number> {
  const totals = new Map<string, number>();

  state.participants.forEach((participant) => {
    const total = matches.reduce((sum, match) => {
      const prediction = predictionMap.get(`${participant.id}:${match.id}`);
      return (
        sum +
        scorePrediction(
          matchScore(match, liveScoreMap.get(match.id)),
          predictionScore(prediction),
          { includeAdvanceBonus: isKnockoutMatch(match) }
        )
      );
    }, 0);
    totals.set(participant.id, total);
  });

  return totals;
}

function rankParticipants(state: PublicState, totals: Map<string, number>): Map<string, number> {
  return new Map(
    [...state.participants]
      .sort((left, right) => {
        const byTotal = (totals.get(right.id) ?? 0) - (totals.get(left.id) ?? 0);
        if (byTotal !== 0) {
          return byTotal;
        }
        return left.displayName.localeCompare(right.displayName);
      })
      .map((participant, index) => [participant.id, index + 1])
  );
}

function getScheduleMatchdayMatchIds(matches: Match[], targetMatch: Match): Set<string> {
  const targetIndex = matches.findIndex((match) => match.id === targetMatch.id);
  if (targetIndex < 0) {
    return new Set([targetMatch.id]);
  }

  let firstIndex = targetIndex;
  while (firstIndex > 0 && matchGapMs(matches[firstIndex - 1], matches[firstIndex]) <= MATCHDAY_BREAK_MS) {
    firstIndex -= 1;
  }

  let lastIndex = targetIndex;
  while (
    lastIndex < matches.length - 1 &&
    matchGapMs(matches[lastIndex], matches[lastIndex + 1]) <= MATCHDAY_BREAK_MS
  ) {
    lastIndex += 1;
  }

  return new Set(matches.slice(firstIndex, lastIndex + 1).map((match) => match.id));
}

function matchGapMs(previousMatch: Match, nextMatch: Match): number {
  return new Date(nextMatch.kickoffUtc).getTime() - new Date(previousMatch.kickoffUtc).getTime();
}
