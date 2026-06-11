import { Link2, Save } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import { apiClient, messageForApiError } from "../api/client";
import { StageTabs } from "../components/StageTabs";
import { formatDateTime, formatLocalTimeZoneLabel } from "../components/format";
import {
  getMatchesForStage,
  getOpenStage,
  getPredictionMap,
  sortStages
} from "../domain/selectors";
import type { Match, Prediction, PublicState, SavePredictionInput, StageId } from "../domain/types";
import { canEditMatch, predictionRevealAt } from "../domain/visibility";
import { appUrl } from "../routing";

type PredictPageProps = {
  state: PublicState;
  onSaved(): Promise<void>;
  mode: "new" | "edit";
  editToken?: string;
};

export function PredictPage({ state, onSaved, mode, editToken }: PredictPageProps) {
  const stages = sortStages(state.stages);
  const firstOpenStage = getOpenStage(state);
  const [activeStageId, setActiveStageId] = useState<StageId>(firstOpenStage?.id ?? stages[0].id);
  const [displayName, setDisplayName] = useState("");
  const [token, setToken] = useState(editToken ?? "");
  const [savedEditLink, setSavedEditLink] = useState<string | null>(null);
  const [scores, setScores] = useState<Record<string, { home: string; away: string }>>({});
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setSaving] = useState(false);
  const activeStage = stages.find((stage) => stage.id === activeStageId)!;
  const matches = getMatchesForStage(state, activeStageId);
  const predictionMap = useMemo(() => getPredictionMap(state.predictions), [state.predictions]);
  const viewerParticipantId = state.viewerParticipantId;
  const now = new Date();
  const hasEditableMatches = matches.some((match) => canEditMatch(match, now, matches));
  const timeZoneLabel = formatLocalTimeZoneLabel();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setStatus(null);

    const predictions = collectPredictions(matches, scores, predictionMap, viewerParticipantId);
    if (!predictions) {
      setError("Заполните обе цифры счета или оставьте матч пустым.");
      return;
    }
    if (!predictions.length) {
      setError("Заполните хотя бы один открытый матч.");
      return;
    }

    setSaving(true);
    try {
      let workingToken = token;
      if (mode === "new" && !workingToken) {
        const registered = await apiClient.register(displayName);
        workingToken = registered.editToken;
        setToken(workingToken);
        setSavedEditLink(appUrl(`/edit/${workingToken}`));
      }

      await apiClient.savePredictions(workingToken, activeStageId, predictions);
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
            <h2>{mode === "edit" ? "Редактирование по секретной ссылке" : "Новый участник"}</h2>
            <p>Можно заполнить любые открытые матчи. Пустые строки не сохраняются.</p>
          </div>
        </div>

        {mode === "new" && !token && (
          <label className="field">
            <span>Имя в таблице</span>
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Например, Саша"
              required
            />
          </label>
        )}

        {mode === "edit" && (
          <label className="field">
            <span>Секретный токен</span>
            <input value={token} onChange={(event) => setToken(event.target.value)} required />
          </label>
        )}

        {savedEditLink && (
          <div className="notice success">
            <Link2 aria-hidden />
            <div>
              <strong>Секретная ссылка</strong>
              <p>{savedEditLink}</p>
            </div>
          </div>
        )}
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
                          away: getScoreValue(current, prediction, match.id, "away")
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
                          away: event.target.value
                        }
                      }))
                    }
                  />
                </div>
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

function collectPredictions(
  matches: Match[],
  scores: Record<string, { home: string; away: string }>,
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
    predictions.push({
      matchId: match.id,
      predHome: Number(home),
      predAway: Number(away)
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
  scores: Record<string, { home: string; away: string }>,
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
