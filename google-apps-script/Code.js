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
const LIVE_SCORE_CACHE_SECONDS = 45;
const FINAL_SCORE_CACHE_SECONDS = 10 * 60;
const API_FOOTBALL_LIVESCORES_URL = "https://v3.football.api-sports.io/fixtures?live=all";
const API_FOOTBALL_FIXTURES_URL = "https://v3.football.api-sports.io/fixtures";
const SPORTMONKS_LIVESCORES_URL = "https://api.sportmonks.com/v3/football/livescores";
const SPORTMONKS_FINAL_STATE_IDS = new Set([5, 8]);
const API_FOOTBALL_FINAL_STATUSES = new Set(["FT", "AET", "PEN"]);

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
  ScriptApp.newTrigger("refreshLiveScoresCron").timeBased().everyMinutes(1).create();
}

function refreshLiveScoresCron() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    refreshLiveScores_(readMatches_());
  } finally {
    lock.releaseLock();
  }
}

function authorizeApiFootball() {
  const token = PropertiesService.getScriptProperties().getProperty("API_FOOTBALL_KEY");
  if (!token) {
    throw appError_("unknown", "API_FOOTBALL_KEY is missing in Script Properties");
  }
  UrlFetchApp.fetch(API_FOOTBALL_LIVESCORES_URL, {
    muteHttpExceptions: true,
    headers: {
      Accept: "application/json",
      "x-apisports-key": token
    }
  });
}

function getLiveScoreDebug_() {
  const matches = readMatches_();
  const candidates = getLiveScoreCandidates_(matches, new Date());
  const finalCandidates = getFinalScoreCandidates_(matches, new Date());
  const properties = PropertiesService.getScriptProperties();
  const token = properties.getProperty("API_FOOTBALL_KEY");
  const debug = {
    now: new Date().toISOString(),
    tokenPresent: Boolean(token),
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
    apiFootball: null,
    finalFixtures: [],
    matches: []
  };

  if (!token || (!candidates.length && !finalCandidates.length)) {
    return debug;
  }

  let result = { statusCode: null, results: null, errors: null, message: null, fixtures: [] };
  try {
    if (candidates.length) {
      result = fetchApiFootballLivescoresWithMeta_(token);
    }
  } catch (error) {
    debug.apiFootball = {
      statusCode: null,
      results: null,
      errors: null,
      message: error.message || String(error)
    };
    return debug;
  }

  debug.apiFootball = {
    statusCode: result.statusCode,
    results: result.results,
    errors: result.errors,
    message: result.message
  };
  debug.matches = result.fixtures.slice(0, 20).map((fixture) => {
    const home = fixture.teams && fixture.teams.home && fixture.teams.home.name;
    const away = fixture.teams && fixture.teams.away && fixture.teams.away.name;
    const score = extractApiFootballScore_(fixture);
    const status = apiFootballStatus_(fixture);
    const localMatch = candidates.find((candidate) => findApiFootballFixture_(candidate, [fixture]));
    return {
      apiHome: home,
      apiAway: away,
      score,
      status,
      matchedMatchId: localMatch ? localMatch.id : null
    };
  });
  if (finalCandidates.length) {
    debug.finalFixtures = fetchApiFootballFinalFixtures_(token, finalCandidates).slice(0, 20).map((fixture) => {
      const home = fixture.teams && fixture.teams.home && fixture.teams.home.name;
      const away = fixture.teams && fixture.teams.away && fixture.teams.away.name;
      const score = extractApiFootballScore_(fixture);
      const status = apiFootballStatus_(fixture);
      const localMatch = finalCandidates.find((candidate) => findApiFootballFixture_(candidate, [fixture]));
      return {
        apiHome: home,
        apiAway: away,
        score,
        status,
        matchedMatchId: localMatch ? localMatch.id : null
      };
    });
  }

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
  const liveScores = refreshLiveScores_(matches);
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

function refreshLiveScores_(matches) {
  const candidates = getLiveScoreCandidates_(matches, new Date());
  const finalCandidates = getFinalScoreCandidates_(matches, new Date());
  if (!candidates.length && !finalCandidates.length) {
    return { items: [], finalizedMatchIds: [] };
  }

  const properties = PropertiesService.getScriptProperties();
  const apiFootballToken = properties.getProperty("API_FOOTBALL_KEY");
  const sportmonksToken = properties.getProperty("SPORTMONKS_API_TOKEN");
  if (!apiFootballToken && !sportmonksToken) {
    return { items: [], finalizedMatchIds: [] };
  }

  const provider = apiFootballToken ? "api-football" : "sportmonks";
  const providerFixtures = candidates.length
    ? readCachedProviderFixtures_(
        `${provider}_live_scores`,
        LIVE_SCORE_CACHE_SECONDS,
        () => (apiFootballToken ? fetchApiFootballLivescores_(apiFootballToken) : fetchSportmonksLivescores_(sportmonksToken))
      )
    : [];
  const finalFixtures =
    apiFootballToken && finalCandidates.length
      ? fetchApiFootballFinalFixtures_(apiFootballToken, finalCandidates)
      : [];

  const liveItems = [];
  const finalized = [];
  candidates.forEach((match) => {
    const fixture =
      provider === "api-football"
        ? findApiFootballFixture_(match, providerFixtures)
        : findSportmonksFixture_(match, providerFixtures);
    if (!fixture) {
      return;
    }

    const score =
      provider === "api-football"
        ? extractApiFootballScore_(fixture)
        : extractSportmonksScore_(fixture, match);
    if (!score) {
      return;
    }

    const status = provider === "api-football" ? apiFootballStatus_(fixture) : sportmonksStatus_(fixture);
    liveItems.push({
      matchId: match.id,
      home: score.home,
      away: score.away,
      status: status.status,
      minute: status.minute,
      updatedAt: new Date().toISOString(),
      provider
    });

    if (status.status === "complete") {
      finalized.push({ matchId: match.id, home: score.home, away: score.away });
    }
  });

  finalCandidates.forEach((match) => {
    const fixture = findApiFootballFixture_(match, finalFixtures);
    if (!fixture) {
      return;
    }
    const score = extractApiFootballScore_(fixture);
    const status = apiFootballStatus_(fixture);
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
    cache.put(cacheKey, JSON.stringify(fixtures), cacheSeconds);
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

function fetchApiFootballLivescores_(token) {
  return fetchApiFootballLivescoresWithMeta_(token).fixtures;
}

function fetchApiFootballLivescoresWithMeta_(token) {
  const response = UrlFetchApp.fetch(API_FOOTBALL_LIVESCORES_URL, {
    muteHttpExceptions: true,
    headers: {
      Accept: "application/json",
      "x-apisports-key": token
    }
  });

  const statusCode = response.getResponseCode();
  const payload = JSON.parse(response.getContentText());
  return {
    statusCode,
    results: payload.results,
    errors: payload.errors,
    message: payload.message,
    fixtures: statusCode >= 200 && statusCode < 300 && Array.isArray(payload.response) ? payload.response : []
  };
}

function fetchApiFootballFinalFixtures_(token, candidates) {
  const dates = Array.from(
    new Set(candidates.map((match) => new Date(match.kickoffUtc).toISOString().slice(0, 10)))
  );
  return dates.flatMap((date) =>
    readCachedProviderFixtures_(`api-football_fixtures_${date}`, FINAL_SCORE_CACHE_SECONDS, () =>
      fetchApiFootballFixturesByDate_(token, date)
    )
  );
}

function fetchApiFootballFixturesByDate_(token, date) {
  const response = UrlFetchApp.fetch(API_FOOTBALL_FIXTURES_URL + "?date=" + encodeURIComponent(date), {
    muteHttpExceptions: true,
    headers: {
      Accept: "application/json",
      "x-apisports-key": token
    }
  });

  const statusCode = response.getResponseCode();
  const payload = JSON.parse(response.getContentText());
  return statusCode >= 200 && statusCode < 300 && Array.isArray(payload.response) ? payload.response : [];
}

function findApiFootballFixture_(match, fixtures) {
  const expectedHome = canonicalTeam_(match.home);
  const expectedAway = canonicalTeam_(match.away);

  return fixtures.find((fixture) => {
    const home = canonicalTeam_(fixture.teams && fixture.teams.home && fixture.teams.home.name);
    const away = canonicalTeam_(fixture.teams && fixture.teams.away && fixture.teams.away.name);
    return home === expectedHome && away === expectedAway;
  });
}

function extractApiFootballScore_(fixture) {
  const goals = fixture.goals || {};
  if (typeof goals.home === "number" && typeof goals.away === "number") {
    return { home: goals.home, away: goals.away };
  }

  const fulltime = fixture.score && fixture.score.fulltime;
  if (fulltime && typeof fulltime.home === "number" && typeof fulltime.away === "number") {
    return { home: fulltime.home, away: fulltime.away };
  }

  return null;
}

function apiFootballStatus_(fixture) {
  const status = (fixture.fixture && fixture.fixture.status) || {};
  const short = String(status.short || "").toUpperCase();
  return {
    status: API_FOOTBALL_FINAL_STATUSES.has(short) ? "complete" : "live",
    minute: typeof status.elapsed === "number" ? status.elapsed : null
  };
}

function fetchSportmonksLivescores_(token) {
  const url =
    SPORTMONKS_LIVESCORES_URL +
    "?api_token=" +
    encodeURIComponent(token) +
    "&include=" +
    encodeURIComponent("participants;scores;state;periods");
  const response = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    headers: {
      Accept: "application/json"
    }
  });

  const statusCode = response.getResponseCode();
  if (statusCode < 200 || statusCode >= 300) {
    return [];
  }

  const payload = JSON.parse(response.getContentText());
  if (Array.isArray(payload.data)) {
    return payload.data;
  }
  return payload.data ? [payload.data] : [];
}

function findSportmonksFixture_(match, fixtures) {
  const expectedHome = canonicalTeam_(match.home);
  const expectedAway = canonicalTeam_(match.away);

  return fixtures.find((fixture) => {
    const teams = extractSportmonksTeams_(fixture);
    if (!teams.home || !teams.away) {
      return false;
    }
    return canonicalTeam_(teams.home) === expectedHome && canonicalTeam_(teams.away) === expectedAway;
  });
}

function extractSportmonksTeams_(fixture) {
  const teams = { home: "", away: "" };
  const participants = fixture.participants || [];
  participants.forEach((participant) => {
    const location = String((participant.meta && participant.meta.location) || participant.location || "").toLowerCase();
    if (location === "home") {
      teams.home = participant.name || participant.short_code || "";
    }
    if (location === "away") {
      teams.away = participant.name || participant.short_code || "";
    }
  });

  if ((!teams.home || !teams.away) && fixture.name) {
    const parts = String(fixture.name).split(/\s+(?:vs|v)\s+/i);
    if (parts.length === 2) {
      teams.home = teams.home || parts[0];
      teams.away = teams.away || parts[1];
    }
  }

  return teams;
}

function extractSportmonksScore_(fixture, match) {
  if (typeof fixture.home_score === "number" && typeof fixture.away_score === "number") {
    return { home: fixture.home_score, away: fixture.away_score };
  }
  if (fixture.goals && typeof fixture.goals.home === "number" && typeof fixture.goals.away === "number") {
    return { home: fixture.goals.home, away: fixture.goals.away };
  }

  const participants = fixture.participants || [];
  const participantLocations = {};
  participants.forEach((participant) => {
    const location = String((participant.meta && participant.meta.location) || participant.location || "").toLowerCase();
    if (location === "home" || location === "away") {
      participantLocations[participant.id] = location;
    }
  });

  const scores = fixture.scores || [];
  const preferred = ["current", "2nd-half", "1st-half", "fulltime", "full-time", "ft"];
  const best = {};
  scores.forEach((item) => {
    const description = String(item.description || (item.type && item.type.name) || item.type || "").toLowerCase();
    const scoreObject = item.score || {};
    const participantId = item.participant_id || scoreObject.participant_id || scoreObject.participant;
    const location = participantLocations[participantId];
    const goals = toNullableNumber_(scoreObject.goals ?? item.goals ?? scoreObject.score ?? item.score);
    if (!location || goals === null || Number.isNaN(goals)) {
      return;
    }
    const priority = Math.max(0, preferred.findIndex((label) => description.indexOf(label) !== -1) + 1);
    const current = best[location];
    if (!current || priority >= current.priority) {
      best[location] = { goals, priority };
    }
  });

  if (best.home && best.away) {
    return { home: Number(best.home.goals), away: Number(best.away.goals) };
  }

  const resultInfoScore = String(fixture.result_info || "").match(/(\d+)\s*-\s*(\d+)/);
  if (resultInfoScore) {
    return { home: Number(resultInfoScore[1]), away: Number(resultInfoScore[2]) };
  }

  return null;
}

function sportmonksStatus_(fixture) {
  const stateId = Number(fixture.state_id);
  const stateName = String(
    (fixture.state && (fixture.state.short_name || fixture.state.name || fixture.state.developer_name)) || ""
  ).toLowerCase();
  const complete =
    SPORTMONKS_FINAL_STATE_IDS.has(stateId) ||
    stateName.indexOf("finished") !== -1 ||
    stateName.indexOf("full") !== -1 ||
    stateName === "ft";
  const minute = extractSportmonksMinute_(fixture);

  return {
    status: complete ? "complete" : "live",
    minute
  };
}

function extractSportmonksMinute_(fixture) {
  if (typeof fixture.minute === "number") {
    return fixture.minute;
  }
  const periods = fixture.periods || [];
  const ticking = periods.find((period) => period.ticking);
  const latest = ticking || periods[periods.length - 1];
  if (latest && typeof latest.minutes === "number") {
    return latest.minutes;
  }
  return null;
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
