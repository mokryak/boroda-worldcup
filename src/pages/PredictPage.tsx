import { Save } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { FormEvent, useMemo, useState } from "react";
import { apiClient, messageForApiError } from "../api/client";
import { StageTabs } from "../components/StageTabs";
import { formatDateTime, formatLocalTimeZoneLabel } from "../components/format";
import {
  getMatchesForStage,
  getOpenStage,
  getPredictionMap,
  isKnockoutMatch,
  sortStages
} from "../domain/selectors";
import type { Match, MatchSide, Prediction, PublicState, SavePredictionInput, StageId } from "../domain/types";
import { canEditMatch, predictionRevealAt } from "../domain/visibility";

type PredictPageProps = {
  state: PublicState;
  onSaved(): Promise<void>;
  editToken?: string;
};

export function PredictPage({ state, onSaved, editToken }: PredictPageProps) {
  const stages = sortStages(state.stages);
  const firstOpenStage = getOpenStage(state);
  const [activeStageId, setActiveStageId] = useState<StageId>(firstOpenStage?.id ?? stages[0].id);
  const [token, setToken] = useState(editToken ?? "");
  const [scores, setScores] = useState<Record<string, PredictionDraft>>({});
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setSaving] = useState(false);
  const activeStage = stages.find((stage) => stage.id === activeStageId)!;
  const matches = getMatchesForStage(state, activeStageId);
  const predictionMap = useMemo(() => getPredictionMap(state.predictions), [state.predictions]);
  const viewerParticipantId = state.viewerParticipantId;
  const viewer = state.participants.find((participant) => participant.id === viewerParticipantId);
  const now = new Date();
  const hasEditableMatches = matches.some((match) => canEditMatch(match, now, matches));
  const timeZoneLabel = formatLocalTimeZoneLabel();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setStatus(null);

    const predictions = collectPredictions(matches, scores, predictionMap, viewerParticipantId);
    if (!predictions) {
      setError("Заполните обе цифры счета или оставьте матч пустым. Для ничьей в плей-офф выберите, кто проходит.");
      return;
    }
    if (!predictions.length) {
      setError("Заполните хотя бы один открытый матч.");
      return;
    }

    setSaving(true);
    try {
      await apiClient.savePredictions(token, activeStageId, predictions);
      await onSaved();
      setStatus("Прогноз сохранен.");
    } catch (caught) {
      setError(messageForApiError(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="stack" onSubmit={handleSubmit}>
      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Форма прогноза</p>
            <h2>Редактирование по секретной ссылке</h2>
            <p>Можно заполнить любые открытые матчи. Пустые строки не сохраняются.</p>
          </div>
        </div>

        {viewer && (
          <div className="notice success">
            <strong>Мы вас узнали: {viewer.displayName}</strong>
          </div>
        )}

        <label className="field">
          <span>Секретный токен</span>
          <input value={token} onChange={(event) => setToken(event.target.value)} required />
        </label>
      </section>

      <section className="panel">
        <StageTabs stages={stages} activeStageId={activeStageId} onChange={setActiveStageId} />
        <div className="stage-summary">
          <strong>{activeStage.title}</strong>
          <span>Время матчей: локальное ({timeZoneLabel})</span>
        </div>

        <div className="notice">
          В начале тура прогнозы можно подать до старта первого матча тура. После этого прогнозы
          открываются для всех; для более поздних матчей действует блокировка за 24 часа до начала.
        </div>

        {!hasEditableMatches && (
          <div className="notice">Все матчи этого этапа уже открыты для участников. Сохранение закрыто.</div>
        )}

        <div className="match-form-list">
          {matches.map((match) => {
            const prediction = getViewerPrediction(predictionMap, match.id, viewerParticipantId);
            const matchEditable = canEditMatch(match, now, matches);
            const homeValue = getScoreValue(scores, prediction, match.id, "home");
            const awayValue = getScoreValue(scores, prediction, match.id, "away");
            const predictedWinner = getPredictedWinnerValue(scores, prediction, match.id);
            const showsAdvancePicker =
              isKnockoutMatch(match) && homeValue !== "" && awayValue !== "" && homeValue === awayValue;
            return (
              <article className={matchEditable ? "match-form-row" : "match-form-row locked"} key={match.id}>
                <div>
                  <p className="match-meta">
                    {formatDateTime(match.kickoffUtc)} · {match.groupOrRound}
                  </p>
                  <h3>
                    {match.home} <span>vs</span> {match.away}
                  </h3>
                  {!matchEditable && (
                    <p className="lock-note">
                      Открыт для всех с {formatDateTime(predictionRevealAt(match, matches).toISOString())}
                    </p>
                  )}
                </div>
                <div className="score-inputs">
                  <input
                    aria-label={`${match.home} goals`}
                    inputMode="numeric"
                    min="0"
                    type="number"
                    value={homeValue}
                    disabled={!matchEditable}
                    onChange={(event) =>
                      setScores((current) => ({
                        ...current,
                        [match.id]: {
                          home: event.target.value,
                          away: getScoreValue(current, prediction, match.id, "away"),
                          predictedWinner: current[match.id]?.predictedWinner
                        }
                      }))
                    }
                  />
                  <span>:</span>
                  <input
                    aria-label={`${match.away} goals`}
                    inputMode="numeric"
                    min="0"
                    type="number"
                    value={awayValue}
                    disabled={!matchEditable}
                    onChange={(event) =>
                      setScores((current) => ({
                        ...current,
                        [match.id]: {
                          home: getScoreValue(current, prediction, match.id, "home"),
                          away: event.target.value,
                          predictedWinner: current[match.id]?.predictedWinner
                        }
                      }))
                    }
                  />
                </div>
                {showsAdvancePicker && (
                  <div className="advance-picker" role="group" aria-label={`Кто проходит: ${match.home} или ${match.away}`}>
                    <span>Проходит</span>
                    <button
                      className={predictedWinner === "home" ? "advance-option active" : "advance-option"}
                      type="button"
                      disabled={!matchEditable}
                      onClick={() => setPredictedWinner(setScores, match.id, homeValue, awayValue, "home")}
                    >
                      {match.home}
                    </button>
                    <button
                      className={predictedWinner === "away" ? "advance-option active" : "advance-option"}
                      type="button"
                      disabled={!matchEditable}
                      onClick={() => setPredictedWinner(setScores, match.id, homeValue, awayValue, "away")}
                    >
                      {match.away}
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>

      {error && <div className="notice error">{error}</div>}
      {status && <div className="notice success">{status}</div>}

      <div className="sticky-submit">
        <button className="primary-action" type="submit" disabled={!hasEditableMatches || isSaving}>
          <Save size={18} aria-hidden />
          {isSaving ? "Сохраняем" : "Сохранить прогноз"}
        </button>
      </div>
    </form>
  );
}

type PredictionDraft = {
  home: string;
  away: string;
  predictedWinner?: MatchSide | "";
};

function collectPredictions(
  matches: Match[],
  scores: Record<string, PredictionDraft>,
  predictionMap: Map<string, Prediction>,
  viewerParticipantId?: string
): SavePredictionInput[] | null {
  const predictions: SavePredictionInput[] = [];
  for (const match of matches) {
    if (!canEditMatch(match, new Date(), matches)) {
      continue;
    }

    const prediction = getViewerPrediction(predictionMap, match.id, viewerParticipantId);
    const home = getScoreValue(scores, prediction, match.id, "home");
    const away = getScoreValue(scores, prediction, match.id, "away");
    if (home === "" && away === "") {
      continue;
    }
    if (home === "" || away === "") {
      return null;
    }
    const predictedWinner = getPredictedWinnerValue(scores, prediction, match.id);
    if (isKnockoutMatch(match) && home === away && !predictedWinner) {
      return null;
    }
    predictions.push({
      matchId: match.id,
      predHome: Number(home),
      predAway: Number(away),
      predictedWinner: knockoutPredictionWinner(match, Number(home), Number(away), predictedWinner)
    });
  }
  return predictions;
}

function getViewerPrediction(
  predictionMap: Map<string, Prediction>,
  matchId: string,
  viewerParticipantId?: string
): Prediction | undefined {
  if (!viewerParticipantId) {
    return undefined;
  }
  return predictionMap.get(`${viewerParticipantId}:${matchId}`);
}

function getScoreValue(
  scores: Record<string, PredictionDraft>,
  prediction: Prediction | undefined,
  matchId: string,
  side: "home" | "away"
): string {
  const current = scores[matchId]?.[side];
  if (typeof current !== "undefined") {
    return current;
  }
  const predicted = side === "home" ? prediction?.predHome : prediction?.predAway;
  return typeof predicted === "number" ? String(predicted) : "";
}

function getPredictedWinnerValue(
  scores: Record<string, PredictionDraft>,
  prediction: Prediction | undefined,
  matchId: string
): MatchSide | "" {
  const current = scores[matchId]?.predictedWinner;
  if (typeof current !== "undefined") {
    return current;
  }
  return prediction?.predictedWinner ?? "";
}

function setPredictedWinner(
  setScores: Dispatch<SetStateAction<Record<string, PredictionDraft>>>,
  matchId: string,
  home: string,
  away: string,
  predictedWinner: MatchSide
) {
  setScores((current) => ({
    ...current,
    [matchId]: {
      home,
      away,
      predictedWinner
    }
  }));
}

function knockoutPredictionWinner(
  match: Match,
  home: number,
  away: number,
  predictedWinner: MatchSide | ""
): MatchSide | null {
  if (!isKnockoutMatch(match)) {
    return null;
  }
  if (home > away) {
    return "home";
  }
  if (away > home) {
    return "away";
  }
  return predictedWinner || null;
}
