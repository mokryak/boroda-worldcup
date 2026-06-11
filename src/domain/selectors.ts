import { scorePrediction } from "./scoring";
import type { Match, Participant, Prediction, PublicState, Stage, StageId } from "./types";
import { canEditMatch, isPredictionVisible, stageHasEditableMatches } from "./visibility";

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
            prediction ? { home: prediction.predHome, away: prediction.predAway } : null
          )
        );
      }, 0);

      return { participant, total };
    })
    .sort((a, b) => b.total - a.total || a.participant.displayName.localeCompare(b.participant.displayName));
}

export function getEditableMatchesForStage(state: PublicState, stageId: StageId, now = new Date()): Match[] {
  const matches = getMatchesForStage(state, stageId);
  return matches.filter((match) => canEditMatch(match, now, matches));
}

export function getMatchScoreForParticipant(
  match: Match,
  participant: Participant,
  predictions: Prediction[]
): number {
  const prediction = predictions.find(
    (item) => item.matchId === match.id && item.participantId === participant.id
  );

  return scorePrediction(
    actualScore(match),
    prediction ? { home: prediction.predHome, away: prediction.predAway } : null
  );
}

export function actualScore(match: Match) {
  if (match.actualHome === null || match.actualAway === null) {
    return null;
  }
  return { home: match.actualHome, away: match.actualAway };
}
