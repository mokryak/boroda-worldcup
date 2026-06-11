import { demoState } from "../data/seed";
import { canEditMatch, isPredictionVisible } from "../domain/visibility";
import type {
  ApiErrorCode,
  PublicState,
  RegisterResponse,
  SavePredictionInput,
  StageId
} from "../domain/types";
import { ApiError } from "../domain/types";

export type ApiClient = {
  getState(editToken?: string): Promise<PublicState>;
  register(displayName: string): Promise<RegisterResponse>;
  savePredictions(editToken: string, stageId: StageId, predictions: SavePredictionInput[]): Promise<void>;
};

const appsScriptUrl = import.meta.env.VITE_APPS_SCRIPT_URL?.trim();

export const apiClient: ApiClient = appsScriptUrl ? createAppsScriptClient(appsScriptUrl) : createMockClient();

function createAppsScriptClient(url: string): ApiClient {
  return {
    async getState(editToken) {
      const params = new URLSearchParams({ action: "state" });
      if (editToken) {
        params.set("editToken", editToken);
      }
      const response = await fetch(`${url}?${params.toString()}`);
      return readJson(response);
    },
    async register(displayName) {
      const response = await fetch(url, {
        method: "POST",
        body: JSON.stringify({ action: "register", displayName })
      });
      return readJson(response);
    },
    async savePredictions(editToken, stageId, predictions) {
      const response = await fetch(url, {
        method: "POST",
        body: JSON.stringify({ action: "savePredictions", editToken, stageId, predictions })
      });
      await readJson(response);
    }
  };
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null);

  if (!response.ok || payload?.ok === false) {
    throw new ApiError(payload?.code ?? "unknown", payload?.message ?? "Что-то пошло не так.");
  }

  return payload?.data ?? payload;
}

type MockDb = PublicState & {
  tokens: Record<string, string>;
};

function createMockClient(): ApiClient {
  const db = loadMockDb();

  return {
    async getState(editToken) {
      return publicState(db, editToken);
    },
    async register(displayName) {
      const cleanName = displayName.trim();
      if (!cleanName) {
        throw new ApiError("unknown", "Введите имя.");
      }

      const duplicate = db.participants.some(
        (participant) => participant.displayName.toLowerCase() === cleanName.toLowerCase()
      );
      if (duplicate) {
        throw new ApiError("duplicate_name", "Такое имя уже занято.");
      }

      const participantId = `p-${crypto.randomUUID()}`;
      const editToken = crypto.randomUUID().replaceAll("-", "");
      db.participants.push({
        id: participantId,
        displayName: cleanName,
        createdAt: new Date().toISOString()
      });
      db.tokens[editToken] = participantId;
      persistMockDb(db);

      return { participantId, displayName: cleanName, editToken };
    },
    async savePredictions(editToken, stageId, predictions) {
      const participantId = db.tokens[editToken];
      if (!participantId) {
        throw new ApiError("invalid_token", "Секретная ссылка не найдена.");
      }

      const stage = db.stages.find((item) => item.id === stageId);
      if (!stage) {
        throw new ApiError("not_found", "Этап не найден.");
      }
      const stageMatches = db.matches.filter((match) => match.stageId === stageId);
      const stageMatchMap = new Map(stageMatches.map((match) => [match.id, match]));
      if (!predictions.length) {
        throw new ApiError("incomplete_stage", "Заполните хотя бы один открытый матч.");
      }
      predictions.forEach((prediction) => {
        const match = stageMatchMap.get(prediction.matchId);
        if (!match) {
          throw new ApiError("not_found", "Матч не найден.");
        }
        if (!canEditMatch(match, new Date(), stageMatches)) {
          throw new ApiError("deadline_passed", "Прогноз на этот матч уже закрыт.");
        }
      });

      const now = new Date().toISOString();
      const submittedMatchIds = new Set(predictions.map((prediction) => prediction.matchId));
      db.predictions = db.predictions.filter(
        (prediction) => prediction.participantId !== participantId || !submittedMatchIds.has(prediction.matchId)
      );
      db.predictions.push(
        ...predictions.map((prediction) => ({
          participantId,
          matchId: prediction.matchId,
          predHome: prediction.predHome,
          predAway: prediction.predAway,
          updatedAt: now
        }))
      );

      const submitted = db.submittedStages.find((item) => item.stageId === stageId);
      if (submitted) {
        if (!submitted.participantIds.includes(participantId)) {
          submitted.participantIds.push(participantId);
        }
      } else {
        db.submittedStages.push({ stageId, participantIds: [participantId] });
      }
      persistMockDb(db);
    }
  };
}

function loadMockDb(): MockDb {
  const raw = localStorage.getItem("worldcup-predictor-db");
  if (raw) {
    return migrateMockDb(JSON.parse(raw));
  }

  return migrateMockDb({
    ...structuredClone(demoState),
    tokens: {}
  });
}

function persistMockDb(db: MockDb) {
  localStorage.setItem("worldcup-predictor-db", JSON.stringify(db));
}

function publicState(db: MockDb, editToken?: string): PublicState {
  const viewerParticipantId = editToken ? db.tokens[editToken] : undefined;
  if (editToken && !viewerParticipantId) {
    throw new ApiError("invalid_token", "Секретная ссылка не найдена.");
  }

  const visibleMatchIdSet = new Set(
    db.matches.filter((match) => isPredictionVisible(match, new Date(), db.matches)).map((match) => match.id)
  );

  return {
    tournamentName: db.tournamentName,
    generatedAt: new Date().toISOString(),
    stages: db.stages,
    matches: db.matches,
    participants: db.participants,
    predictions: db.predictions.filter(
      (prediction) =>
        visibleMatchIdSet.has(prediction.matchId) || prediction.participantId === viewerParticipantId
    ),
    submittedStages: buildSubmittedStages(db),
    submittedMatches: buildSubmittedMatches(db),
    viewerParticipantId
  };
}

function migrateMockDb(db: MockDb): MockDb {
  return {
    ...db,
    submittedStages: db.submittedStages ?? [],
    submittedMatches: db.submittedMatches ?? [],
    tokens: db.tokens ?? {}
  };
}

function buildSubmittedStages(db: Pick<PublicState, "matches" | "predictions">) {
  const matchStageMap = new Map(db.matches.map((match) => [match.id, match.stageId]));
  const submitted = new Map<StageId, Set<string>>();

  db.predictions.forEach((prediction) => {
    const stageId = matchStageMap.get(prediction.matchId);
    if (!stageId) {
      return;
    }
    const participantIds = submitted.get(stageId) ?? new Set<string>();
    participantIds.add(prediction.participantId);
    submitted.set(stageId, participantIds);
  });

  return Array.from(submitted.entries()).map(([stageId, participantIds]) => ({
    stageId,
    participantIds: Array.from(participantIds)
  }));
}

function buildSubmittedMatches(db: Pick<PublicState, "predictions">) {
  const submitted = new Map<string, Set<string>>();

  db.predictions.forEach((prediction) => {
    const participantIds = submitted.get(prediction.matchId) ?? new Set<string>();
    participantIds.add(prediction.participantId);
    submitted.set(prediction.matchId, participantIds);
  });

  return Array.from(submitted.entries()).map(([matchId, participantIds]) => ({
    matchId,
    participantIds: Array.from(participantIds)
  }));
}

export function messageForApiError(error: unknown): string {
  if (error instanceof ApiError) {
    return apiErrorMessages[error.code] ?? error.message;
  }
  return "Не удалось выполнить запрос. Проверьте соединение и попробуйте еще раз.";
}

const apiErrorMessages: Record<ApiErrorCode, string> = {
  duplicate_name: "Такое имя уже занято. Попробуйте добавить фамилию или ник.",
  invalid_token: "Секретная ссылка не найдена.",
  deadline_passed: "Прогноз на этот матч уже открыт для всех и больше не меняется.",
  incomplete_stage: "Заполните хотя бы один открытый матч. Пустые строки можно оставить пустыми.",
  not_found: "Данные не найдены.",
  unknown: "Что-то пошло не так."
};
