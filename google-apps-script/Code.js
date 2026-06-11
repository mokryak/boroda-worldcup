const SHEETS = {
  settings: "Settings",
  stages: "Stages",
  matches: "Matches",
  participants: "Participants",
  predictions: "Predictions"
};

const PREDICTION_LOCK_WINDOW_MS = 24 * 60 * 60 * 1000;

function doGet(event) {
  try {
    const action = event.parameter.action || "state";
    if (action === "state") {
      return jsonOk(getPublicState_(event.parameter.editToken));
    }
    return jsonError_("not_found", "Unknown action", 404);
  } catch (error) {
    return jsonError_(error.code || "unknown", error.message || "Unknown error", error.status || 400);
  }
}

function doPost(event) {
  const payload = parsePayload_(event);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    if (payload.action === "register") {
      return jsonOk(registerParticipant_(payload.displayName));
    }
    if (payload.action === "savePredictions") {
      savePredictions_(payload.editToken, payload.stageId, payload.predictions || []);
      return jsonOk({ saved: true });
    }
    return jsonError_("not_found", "Unknown action", 404);
  } catch (error) {
    return jsonError_(error.code || "unknown", error.message || "Unknown error", error.status || 400);
  } finally {
    lock.releaseLock();
  }
}

function setupWorldCupPredictor() {
  const spreadsheet = SpreadsheetApp.getActive();
  ensureSheet_(spreadsheet, SHEETS.settings, ["key", "value"]);
  ensureSheet_(spreadsheet, SHEETS.stages, ["id", "title", "deadline_utc", "display_order"]);
  ensureSheet_(spreadsheet, SHEETS.matches, [
    "id",
    "stage_id",
    "kickoff_at_utc",
    "group_round",
    "home",
    "away",
    "actual_home",
    "actual_away",
    "status",
    "display_order"
  ]);
  ensureSheet_(spreadsheet, SHEETS.participants, [
    "participant_id",
    "display_name",
    "edit_token",
    "created_at"
  ]);
  ensureSheet_(spreadsheet, SHEETS.predictions, [
    "participant_id",
    "match_id",
    "pred_home",
    "pred_away",
    "updated_at"
  ]);
}

function getPublicState_(editToken) {
  const settings = getSettings_();
  const stages = rowsAsObjects_(SHEETS.stages).map((row) => ({
    id: row.id,
    title: row.title,
    deadlineUtc: row.deadline_utc,
    displayOrder: Number(row.display_order)
  }));
  const matches = rowsAsObjects_(SHEETS.matches).map((row) => ({
    id: row.id,
    stageId: row.stage_id,
    kickoffUtc: row.kickoff_at_utc,
    groupOrRound: row.group_round,
    home: row.home,
    away: row.away,
    actualHome: toNullableNumber_(row.actual_home),
    actualAway: toNullableNumber_(row.actual_away),
    status: row.status || "scheduled",
    displayOrder: Number(row.display_order)
  }));
  const participants = rowsAsObjects_(SHEETS.participants).map((row) => ({
    id: row.participant_id,
    displayName: row.display_name,
    createdAt: row.created_at
  }));

  let viewerParticipantId = null;
  const cleanToken = String(editToken || "").trim();
  if (cleanToken) {
    const privateParticipant = rowsAsObjects_(SHEETS.participants).find((row) => row.edit_token === cleanToken);
    if (!privateParticipant) {
      throw appError_("invalid_token", "Invalid edit token");
    }
    viewerParticipantId = privateParticipant.participant_id;
  }

  const visibleMatchIds = new Set(
    matches.filter((match) => isPredictionVisible_(match, matches)).map((match) => match.id)
  );
  const allPredictions = rowsAsObjects_(SHEETS.predictions);
  const predictions = allPredictions
    .filter((row) => visibleMatchIds.has(row.match_id) || row.participant_id === viewerParticipantId)
    .map((row) => ({
      participantId: row.participant_id,
      matchId: row.match_id,
      predHome: Number(row.pred_home),
      predAway: Number(row.pred_away),
      updatedAt: row.updated_at
    }));
  const submittedByStage = {};
  const submittedByMatch = {};
  const matchStageMap = {};
  matches.forEach((match) => {
    matchStageMap[match.id] = match.stageId;
  });
  allPredictions.forEach((prediction) => {
    const stageId = matchStageMap[prediction.match_id];
    if (!stageId) {
      return;
    }
    submittedByStage[stageId] = submittedByStage[stageId] || new Set();
    submittedByStage[stageId].add(prediction.participant_id);
    submittedByMatch[prediction.match_id] = submittedByMatch[prediction.match_id] || new Set();
    submittedByMatch[prediction.match_id].add(prediction.participant_id);
  });
  const submittedStages = Object.keys(submittedByStage).map((stageId) => ({
    stageId,
    participantIds: Array.from(submittedByStage[stageId])
  }));
  const submittedMatches = Object.keys(submittedByMatch).map((matchId) => ({
    matchId,
    participantIds: Array.from(submittedByMatch[matchId])
  }));

  return {
    tournamentName: settings.tournamentName || "Чемпионат по прогнозам Борода",
    generatedAt: new Date().toISOString(),
    stages,
    matches,
    participants,
    predictions,
    submittedStages,
    submittedMatches,
    viewerParticipantId: viewerParticipantId || undefined
  };
}

function registerParticipant_(displayName) {
  const name = String(displayName || "").trim();
  if (!name) {
    throw appError_("unknown", "Display name is required");
  }

  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEETS.participants);
  const rows = rowsAsObjects_(SHEETS.participants);
  const duplicate = rows.some((row) => String(row.display_name).toLowerCase() === name.toLowerCase());
  if (duplicate) {
    throw appError_("duplicate_name", "Display name is already taken");
  }

  const participantId = Utilities.getUuid();
  const editToken = Utilities.getUuid().replace(/-/g, "");
  sheet.appendRow([participantId, name, editToken, new Date().toISOString()]);

  return {
    participantId,
    displayName: name,
    editToken
  };
}

function savePredictions_(editToken, stageId, predictions) {
  const token = String(editToken || "").trim();
  const participant = rowsAsObjects_(SHEETS.participants).find((row) => row.edit_token === token);
  if (!participant) {
    throw appError_("invalid_token", "Invalid edit token");
  }

  const stage = rowsAsObjects_(SHEETS.stages).find((row) => row.id === stageId);
  if (!stage) {
    throw appError_("not_found", "Stage not found");
  }

  const stageMatches = rowsAsObjects_(SHEETS.matches).filter((row) => row.stage_id === stageId);
  const stageMatchMap = {};
  stageMatches.forEach((match) => {
    stageMatchMap[match.id] = match;
  });

  if (!predictions.length) {
    throw appError_("incomplete_stage", "At least one open match is required");
  }

  predictions.forEach((prediction) => {
    const match = stageMatchMap[prediction.matchId];
    if (!match) {
      throw appError_("not_found", "Match not found");
    }
    if (!canEditMatch_(match, stageMatches)) {
      throw appError_("deadline_passed", "Prediction is already public and locked");
    }
  });

  const predictionSheet = SpreadsheetApp.getActive().getSheetByName(SHEETS.predictions);
  const existingRows = rowsAsObjects_(SHEETS.predictions);
  const submittedIds = new Set(predictions.map((prediction) => prediction.matchId));
  const keepRows = existingRows.filter(
    (row) => row.participant_id !== participant.participant_id || !submittedIds.has(row.match_id)
  );
  const now = new Date().toISOString();
  const nextRows = keepRows.concat(
    predictions.map((prediction) => ({
      participant_id: participant.participant_id,
      match_id: prediction.matchId,
      pred_home: Number(prediction.predHome),
      pred_away: Number(prediction.predAway),
      updated_at: now
    }))
  );

  rewriteSheet_(predictionSheet, ["participant_id", "match_id", "pred_home", "pred_away", "updated_at"], nextRows);
}

function rowsAsObjects_(sheetName) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(sheetName);
  if (!sheet) {
    throw appError_("not_found", `Sheet ${sheetName} not found`);
  }

  const values = sheet.getDataRange().getValues();
  if (values.length < 2) {
    return [];
  }

  const headers = values[0].map((header) => String(header).trim());
  return values.slice(1).filter((row) => row.some((value) => value !== "")).map((row) => {
    const object = {};
    headers.forEach((header, index) => {
      object[header] = row[index];
    });
    return object;
  });
}

function rewriteSheet_(sheet, headers, rows) {
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows.length) {
    const values = rows.map((row) => headers.map((header) => row[header]));
    sheet.getRange(2, 1, values.length, headers.length).setValues(values);
  }
}

function ensureSheet_(spreadsheet, name, headers) {
  const sheet = spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
}

function getSettings_() {
  const settings = {};
  rowsAsObjects_(SHEETS.settings).forEach((row) => {
    settings[row.key] = row.value;
  });
  return settings;
}

function parsePayload_(event) {
  if (!event.postData || !event.postData.contents) {
    return {};
  }
  return JSON.parse(event.postData.contents);
}

function toNullableNumber_(value) {
  if (value === "" || value === null || typeof value === "undefined") {
    return null;
  }
  return Number(value);
}

function predictionRevealAt_(match, stageMatches) {
  const matchRevealAt = new Date(kickoffOf_(match)).getTime() - PREDICTION_LOCK_WINDOW_MS;
  const stageId = stageOf_(match);
  const stageStartAt = Math.min.apply(
    null,
    (stageMatches || [match])
      .filter((stageMatch) => stageOf_(stageMatch) === stageId)
      .map((stageMatch) => new Date(kickoffOf_(stageMatch)).getTime())
  );

  return new Date(Math.max(matchRevealAt, isFinite(stageStartAt) ? stageStartAt : matchRevealAt));
}

function isPredictionVisible_(match, stageMatches) {
  return Date.now() >= predictionRevealAt_(match, stageMatches).getTime();
}

function canEditMatch_(match, stageMatches) {
  return !isPredictionVisible_(match, stageMatches);
}

function kickoffOf_(match) {
  return match.kickoffUtc || match.kickoff_at_utc;
}

function stageOf_(match) {
  return match.stageId || match.stage_id;
}

function jsonOk(data) {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, data })).setMimeType(
    ContentService.MimeType.JSON
  );
}

function jsonError_(code, message, status) {
  return ContentService.createTextOutput(JSON.stringify({ ok: false, code, message, status })).setMimeType(
    ContentService.MimeType.JSON
  );
}

function appError_(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
