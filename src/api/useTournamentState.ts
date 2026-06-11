import { useCallback, useEffect, useState } from "react";
import { apiClient } from "./client";
import type { PublicState } from "../domain/types";

type RefreshOptions = {
  silent?: boolean;
};

export function useTournamentState(editToken?: string) {
  const [state, setState] = useState<PublicState | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (options: RefreshOptions = {}) => {
    if (!options.silent) {
      setLoading(true);
    }
    setError(null);
    try {
      setState(await apiClient.getState(editToken));
    } catch {
      setError("Не удалось загрузить турнир.");
    } finally {
      setLoading(false);
    }
  }, [editToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { state, isLoading, error, refresh };
}
