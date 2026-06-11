import { ArrowRight, CheckCircle2, Clock3, Users } from "lucide-react";
import { StatusPill } from "../components/StatusPill";
import { formatDateTime, formatLocalTimeZoneLabel } from "../components/format";
import { getMatchesForStage, getOpenStage, sortStages } from "../domain/selectors";
import type { PublicState, Stage } from "../domain/types";
import { stageHasEditableMatches } from "../domain/visibility";
import { appHref } from "../routing";

export function HomePage({ state }: { state: PublicState }) {
  const stages = sortStages(state.stages);
  const openStage = getOpenStage(state);

  return (
    <div className="stack">
      <section className="panel intro-grid">
        <div>
          <p className="eyebrow">Без логинов и лишней возни</p>
          <h2>{state.tournamentName}</h2>
          <p>
            Заполняйте прогнозы этапами. В начале тура можно подать прогноз до первого матча,
            потом прогнозы открываются для всех; более поздние матчи закрываются за 24 часа.
          </p>
          <p className="timezone-note">Время матчей показано в вашем локальном часовом поясе: {formatLocalTimeZoneLabel()}.</p>
        </div>
        <div className="action-strip">
          <a className="primary-action" href={appHref("/predict")}>
            Заполнить прогноз
            <ArrowRight size={18} aria-hidden />
          </a>
          <a className="secondary-action" href={appHref("/results")}>
            Смотреть таблицу
          </a>
        </div>
      </section>

      {openStage ? <OpenStageCard state={state} stage={openStage} /> : <TournamentClosed />}

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Календарь</p>
            <h2>Этапы прогноза</h2>
          </div>
        </div>
        <div className="stage-list">
          {stages.map((stage) => {
            const matches = getMatchesForStage(state, stage.id);
            const open = stageHasEditableMatches(stage, state.matches);
            return (
              <article className="stage-row" key={stage.id}>
                <div>
                  <h3>{stage.title}</h3>
                  <p>
                    {matches.length} матчей, первый старт {formatDateTime(matches[0]?.kickoffUtc ?? stage.deadlineUtc)}
                  </p>
                </div>
                <StatusPill tone={open ? "open" : "closed"}>{open ? "Есть открытые" : "Закрыт"}</StatusPill>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function OpenStageCard({ state, stage }: { state: PublicState; stage: Stage }) {
  const submittedIds =
    state.submittedStages.find((item) => item.stageId === stage.id)?.participantIds ?? [];
  const submittedNames = state.participants
    .filter((participant) => submittedIds.includes(participant.id))
    .map((participant) => participant.displayName);
  const matches = getMatchesForStage(state, stage.id);

  return (
    <section className="panel current-stage">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Открытый этап</p>
          <h2>{stage.title}</h2>
          <p>{matches.length} матчей, время локальное ({formatLocalTimeZoneLabel()})</p>
        </div>
        <Clock3 size={28} aria-hidden />
      </div>
      <div className="stats-grid">
        <div>
          <Users aria-hidden />
          <strong>{state.participants.length}</strong>
          <span>участников</span>
        </div>
        <div>
          <CheckCircle2 aria-hidden />
          <strong>{submittedNames.length}</strong>
          <span>уже сдали</span>
        </div>
      </div>
      <div className="submitted-list">
        {submittedNames.length ? (
          submittedNames.map((name) => <span key={name}>{name}</span>)
        ) : (
          <p>Пока никто не сдал этот этап.</p>
        )}
      </div>
    </section>
  );
}

function TournamentClosed() {
  return (
    <section className="panel empty-state">
      <CheckCircle2 aria-hidden />
      <h2>Все этапы закрыты</h2>
      <p>Можно смотреть итоговую таблицу и сверять точные попадания.</p>
      <a className="primary-action" href={appHref("/results")}>
        Итоги турнира
      </a>
    </section>
  );
}
