import { describe, expect, it } from "vitest";
import { canEditStage, isStageClosed, visibleStageIds } from "./visibility";
import type { Stage } from "./types";

const stage: Stage = {
  id: "group-md1",
  title: "Групповой этап: тур 1",
  deadlineUtc: "2026-06-11T18:00:00.000Z",
  displayOrder: 1
};

describe("stage visibility", () => {
  it("keeps predictions hidden before deadline", () => {
    expect(isStageClosed(stage, new Date("2026-06-11T17:59:59.000Z"))).toBe(false);
    expect(visibleStageIds([stage], new Date("2026-06-11T17:59:59.000Z")).has(stage.id)).toBe(false);
  });

  it("shows predictions after deadline", () => {
    expect(isStageClosed(stage, new Date("2026-06-11T18:00:00.000Z"))).toBe(true);
    expect(visibleStageIds([stage], new Date("2026-06-11T18:00:00.000Z")).has(stage.id)).toBe(true);
  });

  it("allows edits only before deadline", () => {
    expect(canEditStage(stage, new Date("2026-06-11T17:59:59.000Z"))).toBe(true);
    expect(canEditStage(stage, new Date("2026-06-11T18:00:00.000Z"))).toBe(false);
  });
});
