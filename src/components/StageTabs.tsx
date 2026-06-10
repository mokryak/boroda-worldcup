import type { Stage, StageId } from "../domain/types";

type StageTabsProps = {
  stages: Stage[];
  activeStageId: StageId;
  onChange(stageId: StageId): void;
};

export function StageTabs({ stages, activeStageId, onChange }: StageTabsProps) {
  return (
    <div className="stage-tabs" role="tablist" aria-label="Этапы турнира">
      {stages.map((stage) => (
        <button
          key={stage.id}
          className={stage.id === activeStageId ? "stage-tab active" : "stage-tab"}
          type="button"
          role="tab"
          aria-selected={stage.id === activeStageId}
          onClick={() => onChange(stage.id)}
        >
          {stage.title}
        </button>
      ))}
    </div>
  );
}
