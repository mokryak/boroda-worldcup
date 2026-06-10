import type { Stage } from "./types";

export function isStageClosed(stage: Pick<Stage, "deadlineUtc">, now = new Date()): boolean {
  return now.getTime() >= new Date(stage.deadlineUtc).getTime();
}

export function canEditStage(stage: Pick<Stage, "deadlineUtc">, now = new Date()): boolean {
  return !isStageClosed(stage, now);
}

export function visibleStageIds<T extends Stage>(stages: T[], now = new Date()): Set<T["id"]> {
  return new Set(stages.filter((stage) => isStageClosed(stage, now)).map((stage) => stage.id));
}
