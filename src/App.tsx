import { CalendarDays, ClipboardPenLine, Trophy } from "lucide-react";
import { useMemo } from "react";
import { useTournamentState } from "./api/useTournamentState";
import { Layout } from "./components/Layout";
import { LoadingState } from "./components/LoadingState";
import { HomePage } from "./pages/HomePage";
import { PredictPage } from "./pages/PredictPage";
import { ResultsPage } from "./pages/ResultsPage";
import { currentAppPath } from "./routing";

export type Route =
  | { name: "home" }
  | { name: "predict" }
  | { name: "results" }
  | { name: "edit"; token: string };

export function App() {
  const route = useMemo(() => parseRoute(currentAppPath(window.location.pathname)), []);
  const tournament = useTournamentState(route.name === "edit" ? route.token : undefined);

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
      {route.name === "home" && <HomePage state={tournament.state} />}
      {route.name === "predict" && (
        <PredictPage
          state={tournament.state}
          onSaved={() => tournament.refresh({ silent: true })}
          mode="new"
        />
      )}
      {route.name === "edit" && (
        <PredictPage
          state={tournament.state}
          onSaved={() => tournament.refresh({ silent: true })}
          mode="edit"
          editToken={route.token}
        />
      )}
      {route.name === "results" && <ResultsPage state={tournament.state} />}
    </Layout>
  );
}

export const navigation = [
  { href: "/", label: "Календарь", icon: CalendarDays },
  { href: "/predict", label: "Прогноз", icon: ClipboardPenLine },
  { href: "/results", label: "Таблица", icon: Trophy }
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
  if (normalized.startsWith("/edit/")) {
    return { name: "edit", token: decodeURIComponent(normalized.slice("/edit/".length)) };
  }
  return { name: "home" };
}
