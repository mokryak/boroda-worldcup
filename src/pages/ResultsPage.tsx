import { Medal, Trophy, X } from "lucide-react";
import { useState } from "react";
import { StageTabs } from "../components/StageTabs";
import { StatusPill } from "../components/StatusPill";
import { formatDateTime, formatLocalTimeZoneLabel } from "../components/format";
import {
  actualScore,
  getLeaderboard,
  getLiveScoreMap,
  getMatchScoreForParticipant,
  getMatchesForStage,
  getParticipantMatchSubmission,
  getPredictionMap,
  getStandingsAfterMatch,
  matchScore,
  sortStages
} from "../domain/selectors";
import type { LiveScore, Match, Participant, Prediction, PublicState, StageId } from "../domain/types";
import { isPredictionVisible, stageHasEditableMatches } from "../domain/visibility";

export function ResultsPage({ state }: { state: PublicState }) {
  const stages = sortStages(state.stages);
  const [activeStageId, setActiveStageId] = useState<StageId>(stages[0].id);
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const activeStage = stages.find((stage) => stage.id === activeStageId)!;
  const matches = getMatchesForStage(state, activeStageId);
  const selectedMatch = selectedMatchId ? matches.find((match) => match.id === selectedMatchId) : undefined;
  const leaderboard = getLeaderboard(state);
  const predictionMap = getPredictionMap(state.predictions);
  const liveScoreMap = getLiveScoreMap(state.liveScores);
  const open = stageHasEditableMatches(activeStage, state.matches);
  const visibleCount = matches.filter((match) => isPredictionVisible(match, new Date(), matches)).length;
  const handleStageChange = (stageId: StageId) => {
    setActiveStageId(stageId);
    setSelectedMatchId(null);
  };

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
            <article className={`leaderboard-row ${rankClass(index + 1)}`} key={row.participant.id}>
              <span className={`rank ${rankClass(index + 1)}`}>{index + 1}</span>
              <span>{row.participant.displayName}</span>
              <strong>{row.total}</strong>
            </article>
          ))}
          {!leaderboard.length && <p>Пока нет участников.</p>}
        </div>
      </section>

      <section className="panel">
        <StageTabs stages={stages} activeStageId={activeStageId} onChange={handleStageChange} />
        <div className="stage-summary">
          <strong>{activeStage.title}</strong>
          <StatusPill tone={open ? "open" : "closed"}>
            {visibleCount ? `Открыто ${visibleCount}/${matches.length}` : "Прогнозы скрыты"}
          </StatusPill>
        </div>
        <p className="timezone-note">
          Время матчей локальное ({formatLocalTimeZoneLabel()}). В начале тура прогнозы открываются со стартом первого матча, дальше - за 24 часа до матча.
        </p>

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
              {matches.map((match) => {
                const visible = isPredictionVisible(match, new Date(), matches);
                const liveScore = liveScoreMap.get(match.id);
                const score = matchScore(match, liveScore);
                const standings = getStandingsAfterMatch(state, match, liveScoreMap);
                return (
                  <tr
                    className="results-match-row"
                    key={match.id}
                    onClick={() => setSelectedMatchId(match.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedMatchId(match.id);
                      }
                    }}
                    tabIndex={0}
                    title="Открыть прогнозы по матчу"
                  >
                    <th>
                      <button
                        className="match-row-button"
                        type="button"
                        onClick={() => setSelectedMatchId(match.id)}
                      >
                        <span>{formatDateTime(match.kickoffUtc)}</span>
                        {match.home} - {match.away}
                      </button>
                    </th>
                    <td>
                      {liveScore?.status === "live" ? (
                        <span className="live-score">LIVE {liveScore.minute ? `${liveScore.minute}' ` : ""}{liveScore.home}:{liveScore.away}</span>
                      ) : score ? (
                        `${score.home}:${score.away}`
                      ) : (
                        "—"
                      )}
                    </td>
                    {state.participants.map((participant) => {
                      const prediction = predictionMap.get(`${participant.id}:${match.id}`);
                      const submitted = getParticipantMatchSubmission(state, match.id, participant.id);
                      const standing = standings.get(participant.id);

                      return (
                        <td key={participant.id}>
                          {visible ? (
                            prediction ? (
                              <span className="prediction-cell">
                                <span>{prediction.predHome}:{prediction.predAway}</span>
                                {score && standing ? (
                                  <span className="cell-stats">
                                    <strong className={`points-badge ${pointsClass(standing.matchPoints)}`}>
                                      {standing.matchPoints}
                                    </strong>
                                    <span>{standing.total}</span>
                                    <span className={`mini-rank ${rankClass(standing.rank)}`}>#{standing.rank}</span>
                                  </span>
                                ) : null}
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
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {selectedMatch && (
        <MatchPredictionsDialog
          match={selectedMatch}
          matches={matches}
          participants={state.participants}
          predictionMap={predictionMap}
          predictions={state.predictions}
          state={state}
          liveScore={liveScoreMap.get(selectedMatch.id)}
          liveScoreMap={liveScoreMap}
          onClose={() => setSelectedMatchId(null)}
        />
      )}

      <section className="panel scoring-help">
        <Medal aria-hidden />
        <p>5 за точный счет, 4 за разницу, 3 за исход, 0 за промах.</p>
      </section>
    </div>
  );
}

type MatchPredictionsDialogProps = {
  match: Match;
  matches: Match[];
  participants: Participant[];
  predictionMap: Map<string, Prediction>;
  predictions: Prediction[];
  state: PublicState;
  liveScore?: LiveScore;
  liveScoreMap: Map<string, LiveScore>;
  onClose: () => void;
};

function MatchPredictionsDialog({
  match,
  matches,
  participants,
  predictionMap,
  predictions,
  state,
  liveScore,
  liveScoreMap,
  onClose
}: MatchPredictionsDialogProps) {
  const visible = isPredictionVisible(match, new Date(), matches);
  const score = matchScore(match, liveScore);
  const standings = getStandingsAfterMatch(state, match, liveScoreMap);

  return (
    <div
      className="match-dialog-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section className="match-dialog" role="dialog" aria-modal="true" aria-labelledby="match-dialog-title">
        <div className="match-dialog-header">
          <div>
            <h2 id="match-dialog-title">
              {match.home} - {match.away}
            </h2>
            <p>{formatDateTime(match.kickoffUtc)}</p>
          </div>
          <button className="icon-button close-dialog" type="button" onClick={onClose} title="Закрыть">
            <X size={20} aria-hidden />
          </button>
        </div>

        <div className="match-dialog-meta">
          <span>{match.groupOrRound}</span>
          <span>
            {liveScore?.status === "live" ? `LIVE${liveScore.minute ? ` ${liveScore.minute}'` : ""}` : "Счет"}:{" "}
            <strong>{score ? `${score.home}:${score.away}` : "—"}</strong>
          </span>
        </div>

        {!visible && (
          <p className="dialog-note">
            Прогнозы пока скрыты. Сейчас видно только, кто уже отправил прогноз на этот матч.
          </p>
        )}

        <div className="dialog-predictions">
          <div className="dialog-prediction-head" aria-hidden>
            <span>Участник</span>
            <span>{visible ? "Прогноз" : "Статус"}</span>
            {visible && <span>Матч</span>}
            {visible && <span>Всего</span>}
            {visible && <span>Место</span>}
          </div>
          {participants.map((participant) => {
            const prediction = predictionMap.get(`${participant.id}:${match.id}`);
            const submitted = getParticipantMatchSubmission(state, match.id, participant.id);
            const points = getMatchScoreForParticipant(match, participant, predictions, liveScore);
            const standing = standings.get(participant.id);

            return (
              <div className="dialog-prediction-row" key={participant.id}>
                <span>{participant.displayName}</span>
                {visible ? (
                  prediction ? (
                    <>
                      <strong>{prediction.predHome}:{prediction.predAway}</strong>
                      {score && standing ? (
                        <>
                          <strong className={`points-badge dialog-points ${pointsClass(points)}`}>{points}</strong>
                          <strong>{standing.total}</strong>
                          <strong className={`mini-rank ${rankClass(standing.rank)}`}>#{standing.rank}</strong>
                        </>
                      ) : (
                        <>
                          <em>—</em>
                          <em>—</em>
                          <em>—</em>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      <em>—</em>
                      <em>—</em>
                      <em>—</em>
                      <em>—</em>
                    </>
                  )
                ) : (
                  <em className={submitted ? "submitted-mark yes" : "submitted-mark"}>
                    {submitted ? "сдал" : "нет"}
                  </em>
                )}
              </div>
            );
          })}
          {!participants.length && <p>Пока нет участников.</p>}
        </div>
      </section>
    </div>
  );
}

function pointsClass(points: number) {
  if (points === 5) {
    return "points-5";
  }
  if (points === 4) {
    return "points-4";
  }
  if (points === 3) {
    return "points-3";
  }
  return "points-0";
}

function rankClass(rank: number) {
  if (rank === 1) {
    return "rank-1";
  }
  if (rank === 2) {
    return "rank-2";
  }
  if (rank === 3) {
    return "rank-3";
  }
  return "";
}
