import { Link2, Save } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import { apiClient, messageForApiError } from "../api/client";
import { StageTabs } from "../components/StageTabs";
import { formatDateTime } from "../components/format";
import {
  getMatchesForStage,
  getOpenStage,
  getPredictionMap,
  sortStages
} from "../domain/selectors";
import type { PublicState, SavePredictionInput, StageId } from "../domain/types";
import { canEditStage } from "../domain/visibility";
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
  const editable = canEditStage(activeStage);
  const predictionMap = useMemo(() => getPredictionMap(state.predictions), [state.predictions]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setStatus(null);

    const predictions = collectPredictions(matches.map((match) => match.id), scores);
    if (!predictions) {
      setError("Заполните все счета этапа.");
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
            <p>Все матчи выбранного этапа обязательны. После дедлайна этап блокируется.</p>
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
          <span>Дедлайн: {formatDateTime(activeStage.deadlineUtc)}</span>
        </div>

        {!editable && <div className="notice">Дедлайн этого этапа прошел. Сохранение закрыто.</div>}

        <div className="match-form-list">
          {matches.map((match) => {
            const prediction = predictionMap.get(`current:${match.id}`);
            return (
              <article className="match-form-row" key={match.id}>
                <div>
                  <p className="match-meta">
                    {formatDateTime(match.kickoffUtc)} · {match.groupOrRound}
                  </p>
                  <h3>
                    {match.home} <span>vs</span> {match.away}
                  </h3>
                </div>
                <div className="score-inputs">
                  <input
                    aria-label={`${match.home} goals`}
                    inputMode="numeric"
                    min="0"
                    type="number"
                    value={scores[match.id]?.home ?? prediction?.predHome ?? ""}
                    disabled={!editable}
                    onChange={(event) =>
                      setScores((current) => ({
                        ...current,
                        [match.id]: { home: event.target.value, away: current[match.id]?.away ?? "" }
                      }))
                    }
                  />
                  <span>:</span>
                  <input
                    aria-label={`${match.away} goals`}
                    inputMode="numeric"
                    min="0"
                    type="number"
                    value={scores[match.id]?.away ?? prediction?.predAway ?? ""}
                    disabled={!editable}
                    onChange={(event) =>
                      setScores((current) => ({
                        ...current,
                        [match.id]: { home: current[match.id]?.home ?? "", away: event.target.value }
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
        <button className="primary-action" type="submit" disabled={!editable || isSaving}>
          <Save size={18} aria-hidden />
          {isSaving ? "Сохраняем" : "Сохранить прогноз"}
        </button>
      </div>
    </form>
  );
}

function collectPredictions(
  matchIds: string[],
  scores: Record<string, { home: string; away: string }>
): SavePredictionInput[] | null {
  const predictions: SavePredictionInput[] = [];
  for (const matchId of matchIds) {
    const score = scores[matchId];
    if (!score || score.home === "" || score.away === "") {
      return null;
    }
    predictions.push({
      matchId,
      predHome: Number(score.home),
      predAway: Number(score.away)
    });
  }
  return predictions;
}
