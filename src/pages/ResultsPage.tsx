import { ArrowDown, ArrowUp, BookOpen, Medal, Minus, Trophy, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useReviews } from "../api/useReviews";
import { LatestReviewBanner } from "../components/LatestReviewBanner";
import { StageTabs } from "../components/StageTabs";
import { StatusPill } from "../components/StatusPill";
import { formatDateTime, formatLocalTimeZoneLabel } from "../components/format";
import {
  getLeaderboard,
  getLatestMatchdayLeaderboardSummary,
  getLiveScoreMap,
  getMatchScoreForParticipant,
  getMatchesForStage,
  getParticipantMatchSubmission,
  getPredictionMap,
  isKnockoutMatch,
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
  const [rulesOpen, setRulesOpen] = useState(false);
  const { reviews } = useReviews();
  const latestReview = reviews[0] ?? null;
  const activeStage = stages.find((stage) => stage.id === activeStageId)!;
  const matches = getMatchesForStage(state, activeStageId);
  const selectedMatch = selectedMatchId ? matches.find((match) => match.id === selectedMatchId) : undefined;
  const leaderboard = getLeaderboard(state);
  const predictionMap = getPredictionMap(state.predictions);
  const liveScoreMap = getLiveScoreMap(state.liveScores);
  const matchdaySummary = getLatestMatchdayLeaderboardSummary(state, liveScoreMap);
  const open = stageHasEditableMatches(activeStage, state.matches);
  const visibleCount = matches.filter((match) => isPredictionVisible(match, new Date(), matches)).length;
  const handleStageChange = (stageId: StageId) => {
    setActiveStageId(stageId);
    setSelectedMatchId(null);
  };
  useBodyScrollLock(Boolean(selectedMatch || rulesOpen));

  return (
    <div className="stack">
      {latestReview && <LatestReviewBanner review={latestReview} />}

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Рейтинг</p>
            <h2>Общая таблица</h2>
          </div>
          <div className="heading-actions">
            <button className="secondary-action" type="button" onClick={() => setRulesOpen(true)}>
              <BookOpen size={18} aria-hidden />
              Правила
            </button>
            <Trophy size={28} aria-hidden />
          </div>
        </div>
        <div className="leaderboard">
          {leaderboard.map((row, index) => (
            <article className={`leaderboard-row ${rankClass(index + 1)}`} key={row.participant.id}>
              <span className={`rank ${rankClass(index + 1)}`}>{index + 1}</span>
              <span className="leaderboard-name">
                <span>{row.participant.displayName}</span>
              </span>
              {matchdaySummary && (
                <span className="leaderboard-day" title="Очки и движение за последний игровой день">
                  <span>+{matchdaySummary.deltas.get(row.participant.id)?.points ?? 0}</span>
                  <RankMovementBadge value={matchdaySummary.deltas.get(row.participant.id)?.rankChange ?? 0} />
                </span>
              )}
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
        <div className="scoring-help">
          <Medal aria-hidden />
          <p>5 за точный счет, 4 за разницу, 3 за исход. В плей-офф еще +3 за угаданного прошедшего.</p>
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
                                {prediction.predictedWinner && matchScoreDraw(prediction) ? (
                                  <small>проходит {teamBySide(match, prediction.predictedWinner)}</small>
                                ) : null}
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

      {selectedMatch &&
        createPortal(
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
          />,
          document.body
        )}

      {rulesOpen && createPortal(<RulesDialog onClose={() => setRulesOpen(false)} />, document.body)}
    </div>
  );
}

function RankMovementBadge({ value }: { value: number }) {
  if (value > 0) {
    return (
      <span className="rank-movement up" title={`Поднялся на ${value} ${placeWord(value)}`}>
        <ArrowUp size={14} aria-hidden />
        {value}
      </span>
    );
  }

  if (value < 0) {
    return (
      <span className="rank-movement down" title={`Опустился на ${Math.abs(value)} ${placeWord(Math.abs(value))}`}>
        <ArrowDown size={14} aria-hidden />
        {Math.abs(value)}
      </span>
    );
  }

  return (
    <span className="rank-movement same" title="Место не изменилось">
      <Minus size={14} aria-hidden />
    </span>
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
      <section className="match-dialog match-details-dialog" role="dialog" aria-modal="true" aria-labelledby="match-dialog-title">
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
            <strong>{score ? formatMatchScore(match, score) : "—"}</strong>
          </span>
        </div>

        <div className="match-dialog-body">
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
                        <strong>
                          {prediction.predHome}:{prediction.predAway}
                          {prediction.predictedWinner && matchScoreDraw(prediction)
                            ? `, проходит ${teamBySide(match, prediction.predictedWinner)}`
                            : ""}
                        </strong>
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
        </div>
      </section>
    </div>
  );
}

function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) {
      return;
    }

    const scrollY = window.scrollY;
    const { body } = document;
    const previousPosition = body.style.position;
    const previousTop = body.style.top;
    const previousWidth = body.style.width;
    const previousOverflow = body.style.overflow;

    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    body.style.overflow = "hidden";

    return () => {
      body.style.position = previousPosition;
      body.style.top = previousTop;
      body.style.width = previousWidth;
      body.style.overflow = previousOverflow;
      window.scrollTo(0, scrollY);
    };
  }, [locked]);
}

function pointsClass(points: number) {
  if (points >= 8) {
    return "points-8";
  }
  if (points === 7) {
    return "points-7";
  }
  if (points === 6) {
    return "points-6";
  }
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

function placeWord(value: number): string {
  const lastTwo = value % 100;
  const last = value % 10;
  if (lastTwo >= 11 && lastTwo <= 14) {
    return "мест";
  }
  if (last === 1) {
    return "место";
  }
  if (last >= 2 && last <= 4) {
    return "места";
  }
  return "мест";
}

function RulesDialog({ onClose }: { onClose: () => void }) {
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
      <section className="match-dialog rules-dialog" role="dialog" aria-modal="true" aria-labelledby="rules-dialog-title">
        <div className="match-dialog-header">
          <div>
            <h2 id="rules-dialog-title">Правила турнира</h2>
            <p>Как начисляются очки за прогнозы</p>
          </div>
          <button className="icon-button close-dialog" type="button" onClick={onClose} title="Закрыть">
            <X size={20} aria-hidden />
          </button>
        </div>

        <div className="rules-content">
          <h3>1. Счета матчей</h3>
          <p>В турнире прогнозируются счета матчей и за правильно угаданый счет начисляются очки. Возможный 3 варианта получения очков:</p>
          <p><strong>а) 5 очков</strong> - Угадан точный счет матча. Пример: прогноз был 3-1, реальный счет матча 3-1.</p>
          <p><strong>б) 4 очка</strong> - Угадан исход матча. Пример 1: прогноз - 1-0, реальный счет - 2-1. Пример 2: прогноз - 1-1, реальный счет 0-0.</p>
          <p><strong>в) 3 очка</strong> - Угадан исход матча. Пример: прогноз был 3-1, реальный счет матча 2-1.</p>

          <h3>2. Итоговый счет</h3>
          <p>На групповом турнире фиксируется счет после окончания матча. На этапе плей-офф счет фиксируется после основного или дополнительного времени, если таковое было назначено.</p>
          <p>Пример 1: основное время матча закончилось со счетом 1-1, после дополнительного времени счет 2-1. Реальный итоговый счет, котроый идет в зачет 2-1.</p>
          <p>Пример 2: основное время закончилось 1-1, дополнительное закончилось 2-2. Итоговый счет 2-2.</p>

          <h3>3. Проход в плей-офф</h3>
          <p>Дополнительные очки на этапе плей-офф за проход. За угаданного участника прошедшего в следующий этап 3 очка. Нельзя поставить по счету одного победителя, а на проход поставить на другого. На проход ставится только если прогноз основного и дополнительного времени ничья.</p>
          <p>Пример: Аргентина - Англия 3-1. Прогноз 3-1 дает 8 очков, 2-0 дает 7 очков, 1-0 дает 6 очков, 1-1 и проходит Аргентина дает 3 очка.</p>
          <p>Пример: Бразилия - Италия 1-1, по пенальти выиграла Италия. Прогноз 1-1 и проходит Бразилия дает 5 очков, 2-2 и проходит Италия дает 7 очков, 1-2 дает 3 очка.</p>
        </div>
      </section>
    </div>
  );
}

function matchScoreDraw(score: Pick<Prediction, "predHome" | "predAway">): boolean {
  return score.predHome === score.predAway;
}

function teamBySide(match: Match, side: "home" | "away"): string {
  return side === "home" ? match.home : match.away;
}

function formatMatchScore(match: Match, score: { home: number; away: number }): string {
  if (isKnockoutMatch(match) && score.home === score.away && match.actualWinner) {
    return `${score.home}:${score.away}, проходит ${teamBySide(match, match.actualWinner)}`;
  }
  return `${score.home}:${score.away}`;
}
