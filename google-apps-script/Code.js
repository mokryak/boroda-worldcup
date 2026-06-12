const SHEETS = {
  settings: "Settings",
  stages: "Stages",
  matches: "Matches",
  participants: "Participants",
  predictions: "Predictions"
};

const PREDICTION_LOCK_WINDOW_MS = 24 * 60 * 60 * 1000;
const LIVE_SCORE_WINDOW_BEFORE_MS = 15 * 60 * 1000;
const LIVE_SCORE_WINDOW_AFTER_MS = 4 * 60 * 60 * 1000;
const FINAL_SCORE_LOOKBACK_MS = 48 * 60 * 60 * 1000;
const GROUP_STAGE_FINALIZE_AFTER_MS = 130 * 60 * 1000;
const KNOCKOUT_STAGE_FINALIZE_AFTER_MS = 210 * 60 * 1000;
const LIVE_SCORE_CACHE_SECONDS = 5 * 60;
const LIVE_SCORE_CACHE_VERSION = "v2";
const THESPORTSDB_EVENT_SEARCH_URL = "https://www.thesportsdb.com/api/v1/json/3/searchevents.php";

const TEAM_ALIASES = {
  "bosnia and herzegovina": "bosnia herzegovina",
  "bosnia herzegovina": "bosnia herzegovina",
  "cabo verde": "cape verde",
  "cape verde": "cape verde",
  "cote divoire": "ivory coast",
  "cote d ivoire": "ivory coast",
  "côte divoire": "ivory coast",
  "czech republic": "czechia",
  "czechia": "czechia",
  "ivory coast": "ivory coast",
  "korea republic": "south korea",
  "south korea": "south korea",
  "turkey": "turkiye",
  "turkiye": "turkiye",
  "türkiye": "turkiye",
  "usa": "united states",
  "united states": "united states",
  "united states of america": "united states"
};

function doGet(event) {
  try {
    const action = event.parameter.action || "state";
    if (action === "state") {
      return jsonOk(getPublicState_(event.parameter.editToken));
    }
    if (action === "liveDebug") {
      return jsonOk(getLiveScoreDebug_());
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

function installLiveScoreTrigger() {
  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === "refreshLiveScoresCron")
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger("refreshLiveScoresCron").timeBased().everyMinutes(5).create();
}

function refreshLiveScoresCron() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    refreshLiveScores_(readMatches_(), new Date());
  } finally {
    lock.releaseLock();
  }
}

function getLiveScoreDebug_() {
  const now = new Date();
  const matches = readMatches_();
  const candidates = getLiveScoreCandidates_(matches, now);
  const finalCandidates = getFinalScoreCandidates_(matches, now);
  const debug = {
    now: now.toISOString(),
    candidates: candidates.map((match) => ({
      id: match.id,
      kickoffUtc: match.kickoffUtc,
      home: match.home,
      away: match.away,
      status: match.status,
      actualHome: match.actualHome,
      actualAway: match.actualAway
    })),
    finalCandidates: finalCandidates.map((match) => ({
      id: match.id,
      kickoffUtc: match.kickoffUtc,
      home: match.home,
      away: match.away,
      status: match.status,
      actualHome: match.actualHome,
      actualAway: match.actualAway
    })),
    theSportsDb: []
  };

  const sportsDbFixtures = fetchTheSportsDbFixtures_(uniqueMatchesById_(candidates.concat(finalCandidates)));
  debug.theSportsDb = sportsDbFixtures.map((fixture) => {
    const localMatch = candidates.concat(finalCandidates).find((candidate) =>
      findTheSportsDbFixture_(candidate, [fixture])
    );
    const score = extractTheSportsDbScore_(fixture);
    const providerStatus = theSportsDbStatus_(fixture);
    return {
      apiHome: fixture.strHomeTeam,
      apiAway: fixture.strAwayTeam,
      score,
      status: providerStatus,
      effectiveStatus: localMatch && score ? effectiveFixtureStatus_(localMatch, providerStatus, score, now) : null,
      matchedMatchId: localMatch ? localMatch.id : null
    };
  });

  return debug;
}

function getPublicState_(editToken) {
  const settings = getSettings_();
  const stages = rowsAsObjects_(SHEETS.stages).map((row) => ({
    id: row.id,
    title: row.title,
    deadlineUtc: row.deadline_utc,
    displayOrder: Number(row.display_order)
  }));
  let matches = readMatches_();
  const liveScores = refreshLiveScores_(matches, new Date());
  if (liveScores.finalizedMatchIds.length) {
    matches = readMatches_();
  }
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
    liveScores: liveScores.items,
    viewerParticipantId: viewerParticipantId || undefined
  };
}

function readMatches_() {
  return rowsAsObjects_(SHEETS.matches).map((row) => ({
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

function refreshLiveScores_(matches, now) {
  const currentTime = now || new Date();
  const candidates = getLiveScoreCandidates_(matches, currentTime);
  const finalCandidates = getFinalScoreCandidates_(matches, currentTime);
  if (!candidates.length && !finalCandidates.length) {
    return { items: [], finalizedMatchIds: [] };
  }

  const sportsDbFixtures = fetchTheSportsDbFixtures_(uniqueMatchesById_(candidates.concat(finalCandidates)));
  const liveItems = [];
  const finalized = [];
  candidates.forEach((match) => {
    const sportsDbFixture = findTheSportsDbFixture_(match, sportsDbFixtures);
    if (!sportsDbFixture) {
      return;
    }

    const score = extractTheSportsDbScore_(sportsDbFixture);
    if (!score) {
      return;
    }

    const status = effectiveFixtureStatus_(match, theSportsDbStatus_(sportsDbFixture), score, currentTime);
    liveItems.push({
      matchId: match.id,
      home: score.home,
      away: score.away,
      status: status.status,
      minute: status.minute,
      updatedAt: currentTime.toISOString(),
      provider: "thesportsdb"
    });

    if (status.status === "complete") {
      finalized.push({ matchId: match.id, home: score.home, away: score.away });
    }
  });

  finalCandidates.forEach((match) => {
    const sportsDbFixture = findTheSportsDbFixture_(match, sportsDbFixtures);
    if (!sportsDbFixture) {
      return;
    }
    const score = extractTheSportsDbScore_(sportsDbFixture);
    const status = score ? effectiveFixtureStatus_(match, theSportsDbStatus_(sportsDbFixture), score, currentTime) : null;
    if (!score || status.status !== "complete") {
      return;
    }
    if (!finalized.some((item) => item.matchId === match.id)) {
      finalized.push({ matchId: match.id, home: score.home, away: score.away });
    }
  });

  if (finalized.length) {
    writeFinalScores_(finalized);
  }

  return {
    items: liveItems,
    finalizedMatchIds: finalized.map((item) => item.matchId)
  };
}

function readCachedProviderFixtures_(cacheKey, cacheSeconds, fetcher) {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  try {
    const fixtures = fetcher();
    if (fixtures) {
      cache.put(cacheKey, JSON.stringify(fixtures), cacheSeconds);
    }
    return fixtures;
  } catch (error) {
    return [];
  }
}

function getLiveScoreCandidates_(matches, now) {
  const nowMs = now.getTime();
  return matches.filter((match) => {
    if (match.status === "complete" && match.actualHome !== null && match.actualAway !== null) {
      return false;
    }

    const kickoffMs = new Date(match.kickoffUtc).getTime();
    return nowMs >= kickoffMs - LIVE_SCORE_WINDOW_BEFORE_MS && nowMs <= kickoffMs + LIVE_SCORE_WINDOW_AFTER_MS;
  });
}

function fetchTheSportsDbFixtures_(matches) {
  return matches
    .map((match) =>
      readCachedProviderFixtures_(`${LIVE_SCORE_CACHE_VERSION}_thesportsdb_${match.id}`, LIVE_SCORE_CACHE_SECONDS, () =>
        fetchTheSportsDbEvent_(match)
      )
    )
    .filter(Boolean);
}

function fetchTheSportsDbEvent_(match) {
  const query = `${match.home}_vs_${match.away}`.replace(/\s+/g, "_");
  const response = UrlFetchApp.fetch(THESPORTSDB_EVENT_SEARCH_URL + "?e=" + encodeURIComponent(query), {
    muteHttpExceptions: true,
    headers: {
      Accept: "application/json"
    }
  });
  const statusCode = response.getResponseCode();
  if (statusCode < 200 || statusCode >= 300) {
    return null;
  }

  const payload = JSON.parse(response.getContentText());
  const events = Array.isArray(payload.event) ? payload.event : [];
  return events.find((event) => isTheSportsDbFixtureMatch_(match, event)) || null;
}

function findTheSportsDbFixture_(match, fixtures) {
  return fixtures.find((fixture) => fixture && isTheSportsDbFixtureMatch_(match, fixture));
}

function isTheSportsDbFixtureMatch_(match, fixture) {
  const home = canonicalTeam_(fixture.strHomeTeam);
  const away = canonicalTeam_(fixture.strAwayTeam);
  const expectedHome = canonicalTeam_(match.home);
  const expectedAway = canonicalTeam_(match.away);
  const kickoffDate = new Date(match.kickoffUtc).toISOString().slice(0, 10);
  const fixtureDate = String(fixture.dateEvent || fixture.strTimestamp || "").slice(0, 10);
  return home === expectedHome && away === expectedAway && (!fixtureDate || fixtureDate === kickoffDate);
}

function extractTheSportsDbScore_(fixture) {
  const home = toNullableNumber_(fixture.intHomeScore);
  const away = toNullableNumber_(fixture.intAwayScore);
  if (home === null || away === null || Number.isNaN(home) || Number.isNaN(away)) {
    return null;
  }
  return { home, away };
}

function theSportsDbStatus_(fixture) {
  const status = String(fixture.strStatus || "").toUpperCase();
  return {
    status: status === "FT" || status === "AET" || status === "PEN" ? "complete" : "live",
    minute: null
  };
}

function effectiveFixtureStatus_(match, providerStatus, score, now) {
  if (providerStatus.status === "complete") {
    return providerStatus;
  }
  if (score && shouldFinalizeByElapsedTime_(match, now)) {
    return {
      status: "complete",
      minute: null,
      finalizedByElapsedTime: true
    };
  }
  return providerStatus;
}

function shouldFinalizeByElapsedTime_(match, now) {
  const kickoffMs = new Date(kickoffOf_(match)).getTime();
  if (!isFinite(kickoffMs)) {
    return false;
  }

  const stageId = String(stageOf_(match) || "");
  const finalizeAfterMs = stageId.indexOf("group-") === 0
    ? GROUP_STAGE_FINALIZE_AFTER_MS
    : KNOCKOUT_STAGE_FINALIZE_AFTER_MS;
  return now.getTime() >= kickoffMs + finalizeAfterMs;
}

function uniqueMatchesById_(matches) {
  const byId = {};
  matches.forEach((match) => {
    byId[match.id] = match;
  });
  return Object.keys(byId).map((id) => byId[id]);
}

function getFinalScoreCandidates_(matches, now) {
  const nowMs = now.getTime();
  return matches.filter((match) => {
    if (match.status === "complete" && match.actualHome !== null && match.actualAway !== null) {
      return false;
    }

    const kickoffMs = new Date(match.kickoffUtc).getTime();
    return nowMs >= kickoffMs + 90 * 60 * 1000 && nowMs <= kickoffMs + FINAL_SCORE_LOOKBACK_MS;
  });
}

function writeFinalScores_(scores) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEETS.matches);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) {
    return;
  }

  const headers = values[0].map((header) => String(header).trim());
  const idIndex = headers.indexOf("id");
  const homeIndex = headers.indexOf("actual_home");
  const awayIndex = headers.indexOf("actual_away");
  const statusIndex = headers.indexOf("status");
  const scoreByMatch = {};
  scores.forEach((score) => {
    scoreByMatch[score.matchId] = score;
  });

  let changed = false;
  for (let rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
    const score = scoreByMatch[values[rowIndex][idIndex]];
    if (!score) {
      continue;
    }
    values[rowIndex][homeIndex] = score.home;
    values[rowIndex][awayIndex] = score.away;
    values[rowIndex][statusIndex] = "complete";
    changed = true;
  }

  if (changed) {
    sheet.getRange(1, 1, values.length, headers.length).setValues(values);
  }
}

function canonicalTeam_(name) {
  const normalized = normalizeTeam_(name);
  return TEAM_ALIASES[normalized] || normalized;
}

function normalizeTeam_(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
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
