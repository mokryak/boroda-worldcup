import { Medal, Trophy } from "lucide-react";
import { useState } from "react";
import { StageTabs } from "../components/StageTabs";
import { StatusPill } from "../components/StatusPill";
import { formatDateTime } from "../components/format";
import {
  actualScore,
  getLeaderboard,
  getMatchScoreForParticipant,
  getMatchesForStage,
  getParticipantStageSubmission,
  getPredictionMap,
  sortStages
} from "../domain/selectors";
import type { PublicState, StageId } from "../domain/types";
import { isStageClosed } from "../domain/visibility";

export function ResultsPage({ state }: { state: PublicState }) {
  const stages = sortStages(state.stages);
  const [activeStageId, setActiveStageId] = useState<StageId>(stages[0].id);
  const activeStage = stages.find((stage) => stage.id === activeStageId)!;
  const matches = getMatchesForStage(state, activeStageId);
  const leaderboard = getLeaderboard(state);
  const predictionMap = getPredictionMap(state.predictions);
  const closed = isStageClosed(activeStage);

  return (
    <div className="stack">
      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Рейтинг</p>
            <h2>Общая таблица</h2>
          </div>
          <Trophy size={28} aria-hidden />
        </div>
        <div className="leaderboard">
          {leaderboard.map((row, index) => (
            <article className="leaderboard-row" key={row.participant.id}>
              <span className="rank">{index + 1}</span>
              <span>{row.participant.displayName}</span>
              <strong>{row.total}</strong>
            </article>
          ))}
          {!leaderboard.length && <p>Пока нет участников.</p>}
        </div>
      </section>

      <section className="panel">
        <StageTabs stages={stages} activeStageId={activeStageId} onChange={setActiveStageId} />
        <div className="stage-summary">
          <strong>{activeStage.title}</strong>
          <StatusPill tone={closed ? "closed" : "open"}>{closed ? "Прогнозы открыты" : "Прогнозы скрыты"}</StatusPill>
        </div>

        <div className="matrix-scroll" role="region" aria-label="Матрица прогнозов">
          <table className="results-matrix">
            <thead>
              <tr>
                <th>Матч</th>
                <th>Счет</th>
                {state.participants.map((participant) => (
                  <th key={participant.id}>{participant.displayName}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matches.map((match) => (
                <tr key={match.id}>
                  <th>
                    <span>{formatDateTime(match.kickoffUtc)}</span>
                    {match.home} - {match.away}
                  </th>
                  <td>{actualScore(match) ? `${match.actualHome}:${match.actualAway}` : "—"}</td>
                  {state.participants.map((participant) => {
                    const prediction = predictionMap.get(`${participant.id}:${match.id}`);
                    const submitted = getParticipantStageSubmission(state, activeStageId, participant.id);
                    const points = getMatchScoreForParticipant(match, participant, state.predictions);

                    return (
                      <td key={participant.id}>
                        {closed ? (
                          prediction ? (
                            <span className="prediction-cell">
                              {prediction.predHome}:{prediction.predAway}
                              <strong>{points}</strong>
                            </span>
                          ) : (
                            "—"
                          )
                        ) : (
                          <span className={submitted ? "submitted-mark yes" : "submitted-mark"}>
                            {submitted ? "сдал" : "нет"}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel scoring-help">
        <Medal aria-hidden />
        <p>5 за точный счет, 4 за разницу, 3 за исход, 0 за промах.</p>
      </section>
    </div>
  );
}
