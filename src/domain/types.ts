export type StageId =
  | "group-md1"
  | "group-md2"
  | "group-md3"
  | "r32"
  | "r16"
  | "qf"
  | "sf"
  | "finals";

export type MatchStatus = "scheduled" | "complete";

export type Stage = {
  id: StageId;
  title: string;
  deadlineUtc: string;
  displayOrder: number;
};

export type Match = {
  id: string;
  stageId: StageId;
  kickoffUtc: string;
  groupOrRound: string;
  home: string;
  away: string;
  actualHome: number | null;
  actualAway: number | null;
  status: MatchStatus;
  displayOrder: number;
};

export type Participant = {
  id: string;
  displayName: string;
  createdAt: string;
};

export type Prediction = {
  participantId: string;
  matchId: string;
  predHome: number;
  predAway: number;
  updatedAt: string;
};

export type SubmittedStage = {
  stageId: StageId;
  participantIds: string[];
};

export type SubmittedMatch = {
  matchId: string;
  participantIds: string[];
};

export type LiveScore = {
  matchId: string;
  home: number;
  away: number;
  status: "live" | "complete";
  minute: number | null;
  updatedAt: string;
  provider?: string;
};

export type PublicState = {
  tournamentName: string;
  generatedAt: string;
  stages: Stage[];
  matches: Match[];
  participants: Participant[];
  predictions: Prediction[];
  submittedStages: SubmittedStage[];
  submittedMatches: SubmittedMatch[];
  liveScores?: LiveScore[];
  viewerParticipantId?: string;
};

export type SavePredictionInput = {
  matchId: string;
  predHome: number;
  predAway: number;
};

export type RegisterResponse = {
  participantId: string;
  displayName: string;
  editToken: string;
};

export type ApiErrorCode =
  | "duplicate_name"
  | "invalid_token"
  | "deadline_passed"
  | "incomplete_stage"
  | "not_found"
  | "unknown";

export class ApiError extends Error {
  code: ApiErrorCode;

  constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}
