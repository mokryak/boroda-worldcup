const SHEETS = {
  settings: "Settings",
  stages: "Stages",
  matches: "Matches",
  participants: "Participants",
  predictions: "Predictions"
};

function doGet(event) {
  const action = event.parameter.action || "state";
  if (action === "state") {
    return jsonOk(getPublicState_());
  }
  return jsonError_("not_found", "Unknown action", 404);
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

function getPublicState_() {
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
  const visibleStageIds = new Set(
    stages.filter((stage) => new Date(stage.deadlineUtc).getTime() <= Date.now()).map((stage) => stage.id)
  );
  const visibleMatchIds = new Set(
    matches.filter((match) => visibleStageIds.has(match.stageId)).map((match) => match.id)
  );
  const allPredictions = rowsAsObjects_(SHEETS.predictions);
  const predictions = allPredictions
    .filter((row) => visibleMatchIds.has(row.match_id))
    .map((row) => ({
      participantId: row.participant_id,
      matchId: row.match_id,
      predHome: Number(row.pred_home),
      predAway: Number(row.pred_away),
      updatedAt: row.updated_at
    }));
  const submittedByStage = {};
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
  });
  const submittedStages = Object.keys(submittedByStage).map((stageId) => ({
    stageId,
    participantIds: Array.from(submittedByStage[stageId])
  }));

  return {
    tournamentName: settings.tournamentName || "Чемпионат по прогнозам Борода",
    generatedAt: new Date().toISOString(),
    stages,
    matches,
    participants,
    predictions,
    submittedStages
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
  if (new Date(stage.deadline_utc).getTime() <= Date.now()) {
    throw appError_("deadline_passed", "Stage deadline has passed");
  }

  const stageMatches = rowsAsObjects_(SHEETS.matches).filter((row) => row.stage_id === stageId);
  const stageMatchIds = stageMatches.map((row) => row.id);
  const submittedIds = new Set(predictions.map((prediction) => prediction.matchId));
  const complete = stageMatchIds.every((matchId) => submittedIds.has(matchId));
  if (!complete) {
    throw appError_("incomplete_stage", "All stage matches are required");
  }

  const predictionSheet = SpreadsheetApp.getActive().getSheetByName(SHEETS.predictions);
  const existingRows = rowsAsObjects_(SHEETS.predictions);
  const keepRows = existingRows.filter(
    (row) => row.participant_id !== participant.participant_id || stageMatchIds.indexOf(row.match_id) === -1
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
