import { demoState } from "../data/seed";
import { canEditStage } from "../domain/visibility";
import type {
  ApiErrorCode,
  PublicState,
  RegisterResponse,
  SavePredictionInput,
  StageId
} from "../domain/types";
import { ApiError } from "../domain/types";

export type ApiClient = {
  getState(): Promise<PublicState>;
  register(displayName: string): Promise<RegisterResponse>;
  savePredictions(editToken: string, stageId: StageId, predictions: SavePredictionInput[]): Promise<void>;
};

const appsScriptUrl = import.meta.env.VITE_APPS_SCRIPT_URL?.trim();

export const apiClient: ApiClient = appsScriptUrl ? createAppsScriptClient(appsScriptUrl) : createMockClient();

function createAppsScriptClient(url: string): ApiClient {
  return {
    async getState() {
      const response = await fetch(`${url}?action=state`);
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
    async getState() {
      return publicState(db);
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
      if (!canEditStage(stage)) {
        throw new ApiError("deadline_passed", "Дедлайн этапа уже прошел.");
      }

      const matchIds = db.matches.filter((match) => match.stageId === stageId).map((match) => match.id);
      const predictionIds = new Set(predictions.map((prediction) => prediction.matchId));
      const complete = matchIds.every((matchId) => predictionIds.has(matchId));
      if (!complete) {
        throw new ApiError("incomplete_stage", "Нужно заполнить все матчи этапа.");
      }

      const now = new Date().toISOString();
      db.predictions = db.predictions.filter(
        (prediction) => prediction.participantId !== participantId || !matchIds.includes(prediction.matchId)
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
    return JSON.parse(raw);
  }

  return {
    ...structuredClone(demoState),
    tokens: {}
  };
}

function persistMockDb(db: MockDb) {
  localStorage.setItem("worldcup-predictor-db", JSON.stringify(db));
}

function publicState(db: MockDb): PublicState {
  return {
    tournamentName: db.tournamentName,
    generatedAt: new Date().toISOString(),
    stages: db.stages,
    matches: db.matches,
    participants: db.participants,
    predictions: db.predictions,
    submittedStages: db.submittedStages
  };
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
  deadline_passed: "Дедлайн этого этапа уже прошел.",
  incomplete_stage: "Нужно заполнить все матчи этапа.",
  not_found: "Данные не найдены.",
  unknown: "Что-то пошло не так."
};
