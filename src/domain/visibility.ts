import type { Match, Stage } from "./types";

const PREDICTION_LOCK_WINDOW_MS = 24 * 60 * 60 * 1000;

type MatchTiming = Pick<Match, "kickoffUtc" | "stageId">;

export function predictionRevealAt(match: MatchTiming, stageMatches: MatchTiming[] = [match]): Date {
  const matchRevealAt = new Date(match.kickoffUtc).getTime() - PREDICTION_LOCK_WINDOW_MS;
  const stageStartAt = Math.min(
    ...stageMatches
      .filter((stageMatch) => stageMatch.stageId === match.stageId)
      .map((stageMatch) => new Date(stageMatch.kickoffUtc).getTime())
  );

  return new Date(Math.max(matchRevealAt, Number.isFinite(stageStartAt) ? stageStartAt : matchRevealAt));
}

export function isPredictionVisible(match: MatchTiming, now = new Date(), stageMatches?: MatchTiming[]): boolean {
  return now.getTime() >= predictionRevealAt(match, stageMatches).getTime();
}

export function canEditMatch(match: MatchTiming, now = new Date(), stageMatches?: MatchTiming[]): boolean {
  return !isPredictionVisible(match, now, stageMatches);
}

export function stageHasEditableMatches(
  stage: Pick<Stage, "id">,
  matches: Pick<Match, "stageId" | "kickoffUtc">[],
  now = new Date()
): boolean {
  return matches.some((match) => match.stageId === stage.id && canEditMatch(match, now, matches));
}

export function isStageClosed(
  stage: Pick<Stage, "id">,
  matches: Pick<Match, "stageId" | "kickoffUtc">[] = [],
  now = new Date()
): boolean {
  return !stageHasEditableMatches(stage, matches, now);
}

export function visibleMatchIds<T extends Pick<Match, "id" | "kickoffUtc" | "stageId">>(
  matches: T[],
  now = new Date()
): Set<T["id"]> {
  return new Set(matches.filter((match) => isPredictionVisible(match, now, matches)).map((match) => match.id));
}
