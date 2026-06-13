import { CalendarDays, ClipboardPenLine, Newspaper, Trophy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTournamentState } from "./api/useTournamentState";
import { Layout } from "./components/Layout";
import { LoadingState } from "./components/LoadingState";
import { getRememberedEditIdentity, rememberEditIdentity } from "./editMemory";
import { PredictPage } from "./pages/PredictPage";
import { PredictInfoPage } from "./pages/PredictInfoPage";
import { ResultsPage } from "./pages/ResultsPage";
import { ReviewsPage } from "./pages/ReviewsPage";
import { currentAppPath } from "./routing";

export type Route =
  | { name: "predict" }
  | { name: "results" }
  | { name: "reviews" }
  | { name: "edit"; token: string };

export function App() {
  const route = useMemo(() => parseRoute(currentAppPath(window.location.pathname)), []);
  const tournament = useTournamentState(route.name === "edit" ? route.token : undefined);
  const [rememberedEditIdentity, setRememberedEditIdentity] = useState(() => getRememberedEditIdentity());

  useEffect(() => {
    if (route.name === "edit" && tournament.state && !tournament.error) {
      const viewer = tournament.state.participants.find(
        (participant) => participant.id === tournament.state?.viewerParticipantId
      );
      const identity = {
        editToken: route.token,
        displayName: viewer?.displayName ?? ""
      };
      rememberEditIdentity(identity);
      setRememberedEditIdentity(identity);
    }
  }, [route, tournament.error, tournament.state]);

  if (tournament.isLoading) {
    return (
      <Layout route={route}>
        <LoadingState label="Загружаем календарь и прогнозы" />
      </Layout>
    );
  }

  if (!tournament.state || tournament.error) {
    return (
      <Layout route={route}>
        <section className="panel empty-state">
          <CalendarDays aria-hidden />
          <h1>Турнир пока не загрузился</h1>
          <p>{tournament.error ?? "Попробуйте обновить страницу."}</p>
          <button type="button" onClick={() => tournament.refresh()}>
            Обновить
          </button>
        </section>
      </Layout>
    );
  }

  return (
    <Layout route={route}>
      {route.name === "predict" && <PredictInfoPage rememberedIdentity={rememberedEditIdentity} />}
      {route.name === "edit" && (
        <PredictPage
          state={tournament.state}
          onSaved={() => tournament.refresh({ silent: true })}
          editToken={route.token}
        />
      )}
      {route.name === "results" && <ResultsPage state={tournament.state} />}
      {route.name === "reviews" && <ReviewsPage />}
    </Layout>
  );
}

export const navigation = [
  { href: "/", label: "Таблица", icon: Trophy },
  { href: "/predict", label: "Подать прогноз", icon: ClipboardPenLine },
  { href: "/reviews", label: "Обзоры", icon: Newspaper },
];

function parseRoute(pathname: string): Route {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  if (normalized === "/") {
    return { name: "results" };
  }
  if (normalized === "/predict") {
    return { name: "predict" };
  }
  if (normalized === "/results") {
    return { name: "results" };
  }
  if (normalized === "/reviews") {
    return { name: "reviews" };
  }
  if (normalized.startsWith("/edit/")) {
    return { name: "edit", token: decodeURIComponent(normalized.slice("/edit/".length)) };
  }
  return { name: "results" };
}
