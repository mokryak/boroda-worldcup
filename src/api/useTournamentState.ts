import { useCallback, useEffect, useState } from "react";
import { apiClient } from "./client";
import type { PublicState } from "../domain/types";

export function useTournamentState() {
  const [state, setState] = useState<PublicState | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setState(await apiClient.getState());
    } catch {
      setError("Не удалось загрузить турнир.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { state, isLoading, error, refresh };
}
