const SHEETS = {
  settings: "Settings",
  stages: "Stages",
  matches: "Matches",
  participants: "Participants",
  predictions: "Predictions",
  reviews: "Reviews"
};

const PREDICTION_LOCK_WINDOW_MS = 24 * 60 * 60 * 1000;
const LIVE_SCORE_WINDOW_BEFORE_MS = 15 * 60 * 1000;
const LIVE_SCORE_WINDOW_AFTER_MS = 4 * 60 * 60 * 1000;
const FINAL_SCORE_LOOKBACK_MS = 48 * 60 * 60 * 1000;
const GROUP_STAGE_FINALIZE_AFTER_MS = 130 * 60 * 1000;
const KNOCKOUT_STAGE_FINALIZE_AFTER_MS = 210 * 60 * 1000;
const LIVE_SCORE_CACHE_SECONDS = 5 * 60;
const LIVE_SCORE_CACHE_VERSION = "v2";
const ESPN_SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";
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
  "congo dr": "dr congo",
  "democratic republic of congo": "dr congo",
  "dr congo": "dr congo",
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

const THESPORTSDB_SEARCH_TEAM_NAMES = {
  "czechia": ["Czech Republic", "Czechia"],
  "united states": ["USA", "United States", "United States of America"]
};

function doGet(event) {
  try {
    const action = event.parameter.action || "state";
    if (action === "state") {
      return jsonOk(getPublicState_(event.parameter.editToken));
    }
    if (action === "reviews") {
      return jsonOk(getReviews_());
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
    if (payload.action === "addReview") {
      return jsonOk(addReview_(payload.adminToken, payload.title, payload.preview, payload.body, payload.author));
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
    "actual_winner",
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
    "predicted_winner",
    "updated_at"
  ]);
  ensureSheet_(spreadsheet, SHEETS.reviews, [
    "review_id",
    "title",
    "preview",
    "body",
    "published_at",
    "author"
  ]);
  ensureRuntimeColumns_();
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
    providerFixtures: [],
    theSportsDb: []
  };

  const providerFixtures = fetchProviderFixtures_(uniqueMatchesById_(candidates.concat(finalCandidates)));
  debug.providerFixtures = providerFixtures.map((fixture) => {
    const localMatch = candidates.concat(finalCandidates).find((candidate) =>
      findProviderFixture_(candidate, [fixture])
    );
    const score = extractProviderScore_(fixture);
    const providerStatus = providerStatus_(fixture);
    return {
      provider: providerName_(fixture),
      apiHome: fixtureHomeTeam_(fixture),
      apiAway: fixtureAwayTeam_(fixture),
      score,
      status: providerStatus,
      effectiveStatus: localMatch && score ? effectiveFixtureStatus_(localMatch, providerStatus, score, now) : null,
      matchedMatchId: localMatch ? localMatch.id : null
    };
  });
  debug.theSportsDb = debug.providerFixtures.filter((fixture) => fixture.provider === "thesportsdb");

  return debug;
}

function getPublicState_(editToken) {
  ensureRuntimeColumns_();
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
      predictedWinner: normalizeMatchSide_(row.predicted_winner),
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
    actualWinner: normalizeMatchSide_(row.actual_winner, row),
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
  ensureRuntimeColumns_();
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
    if (!isValidPredictionWinner_(match, prediction)) {
      throw appError_("unknown", "Advancing team is required for drawn knockout predictions");
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
      predicted_winner: normalizedPredictionWinner_(stageMatchMap[prediction.matchId], prediction),
      updated_at: now
    }))
  );

  rewriteSheet_(predictionSheet, ["participant_id", "match_id", "pred_home", "pred_away", "predicted_winner", "updated_at"], nextRows);
}

function refreshLiveScores_(matches, now) {
  const currentTime = now || new Date();
  const candidates = getLiveScoreCandidates_(matches, currentTime);
  const finalCandidates = getFinalScoreCandidates_(matches, currentTime);
  if (!candidates.length && !finalCandidates.length) {
    return { items: [], finalizedMatchIds: [] };
  }

  const providerFixtures = fetchProviderFixtures_(uniqueMatchesById_(candidates.concat(finalCandidates)));
  const liveItems = [];
  const finalized = [];
  candidates.forEach((match) => {
    const providerFixture = findProviderFixture_(match, providerFixtures);
    if (!providerFixture) {
      return;
    }

    const score = extractProviderScore_(providerFixture);
    if (!score) {
      return;
    }

    const providerStatus = providerStatus_(providerFixture);
    if (providerStatus.status === "scheduled") {
      return;
    }

    const status = effectiveFixtureStatus_(match, providerStatus, score, currentTime);
    liveItems.push({
      matchId: match.id,
      home: score.home,
      away: score.away,
      status: status.status,
      minute: status.minute,
      updatedAt: currentTime.toISOString(),
      provider: providerName_(providerFixture)
    });

    if (status.status === "complete") {
      finalized.push({ matchId: match.id, home: score.home, away: score.away });
    }
  });

  finalCandidates.forEach((match) => {
    const providerFixture = findProviderFixture_(match, providerFixtures);
    if (!providerFixture) {
      return;
    }
    const score = extractProviderScore_(providerFixture);
    const providerStatus = providerStatus_(providerFixture);
    const status = score && providerStatus.status !== "scheduled"
      ? effectiveFixtureStatus_(match, providerStatus, score, currentTime)
      : null;
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

function fetchProviderFixtures_(matches) {
  return fetchEspnFixtures_(matches).concat(fetchTheSportsDbFixtures_(matches));
}

function fetchEspnFixtures_(matches) {
  return uniqueEspnScoreboardDates_(matches)
    .map((date) =>
      readCachedProviderFixtures_(`${LIVE_SCORE_CACHE_VERSION}_espn_${date}`, LIVE_SCORE_CACHE_SECONDS, () =>
        fetchEspnScoreboard_(date)
      )
    )
    .reduce((allEvents, events) => allEvents.concat(events || []), []);
}

function uniqueEspnScoreboardDates_(matches) {
  const dates = {};
  matches.forEach((match) => {
    const kickoff = new Date(kickoffOf_(match));
    if (isFinite(kickoff.getTime())) {
      [-1, 0, 1].forEach((dayOffset) => {
        const date = new Date(kickoff.getTime() + dayOffset * 24 * 60 * 60 * 1000);
        dates[Utilities.formatDate(date, "UTC", "yyyyMMdd")] = true;
      });
    }
  });
  return Object.keys(dates);
}

function fetchEspnScoreboard_(date) {
  const response = UrlFetchApp.fetch(ESPN_SCOREBOARD_URL + "?dates=" + encodeURIComponent(date), {
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
  return Array.isArray(payload.events) ? payload.events : [];
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
  const queries = theSportsDbEventQueries_(match);
  for (let index = 0; index < queries.length; index += 1) {
    const response = UrlFetchApp.fetch(THESPORTSDB_EVENT_SEARCH_URL + "?e=" + encodeURIComponent(queries[index]), {
      muteHttpExceptions: true,
      headers: {
        Accept: "application/json"
      }
    });
    const statusCode = response.getResponseCode();
    if (statusCode < 200 || statusCode >= 300) {
      continue;
    }

    const payload = JSON.parse(response.getContentText());
    const events = Array.isArray(payload.event) ? payload.event : [];
    const fixture = events.find((event) => isTheSportsDbFixtureMatch_(match, event));
    if (fixture) {
      return fixture;
    }
  }
  return null;
}

function theSportsDbEventQueries_(match) {
  const homeNames = theSportsDbTeamSearchNames_(match.home);
  const awayNames = theSportsDbTeamSearchNames_(match.away);
  const queries = {};

  homeNames.forEach((home) => {
    awayNames.forEach((away) => {
      queries[`${home}_vs_${away}`.replace(/\s+/g, "_")] = true;
    });
  });

  return Object.keys(queries);
}

function theSportsDbTeamSearchNames_(teamName) {
  const names = {};
  const canonical = canonicalTeam_(teamName);
  (THESPORTSDB_SEARCH_TEAM_NAMES[canonical] || []).forEach((name) => {
    names[name] = true;
  });
  names[String(teamName || "").trim()] = true;
  return Object.keys(names).filter(Boolean);
}

function findProviderFixture_(match, fixtures) {
  return fixtures.find((fixture) => fixture && isProviderFixtureMatch_(match, fixture));
}

function isProviderFixtureMatch_(match, fixture) {
  if (isEspnFixture_(fixture)) {
    return isEspnFixtureMatch_(match, fixture);
  }
  return isTheSportsDbFixtureMatch_(match, fixture);
}

function extractProviderScore_(fixture) {
  if (isEspnFixture_(fixture)) {
    return extractEspnScore_(fixture);
  }
  return extractTheSportsDbScore_(fixture);
}

function providerStatus_(fixture) {
  if (isEspnFixture_(fixture)) {
    return espnStatus_(fixture);
  }
  return theSportsDbStatus_(fixture);
}

function providerName_(fixture) {
  return isEspnFixture_(fixture) ? "espn" : "thesportsdb";
}

function fixtureHomeTeam_(fixture) {
  if (isEspnFixture_(fixture)) {
    const competitor = espnCompetitor_(fixture, "home");
    return competitor && competitor.team ? competitor.team.displayName : "";
  }
  return fixture.strHomeTeam;
}

function fixtureAwayTeam_(fixture) {
  if (isEspnFixture_(fixture)) {
    const competitor = espnCompetitor_(fixture, "away");
    return competitor && competitor.team ? competitor.team.displayName : "";
  }
  return fixture.strAwayTeam;
}

function isEspnFixture_(fixture) {
  return fixture && Array.isArray(fixture.competitions);
}

function isEspnFixtureMatch_(match, fixture) {
  const home = canonicalTeam_(fixtureHomeTeam_(fixture));
  const away = canonicalTeam_(fixtureAwayTeam_(fixture));
  const expectedHome = canonicalTeam_(match.home);
  const expectedAway = canonicalTeam_(match.away);
  const kickoffDate = new Date(match.kickoffUtc).toISOString().slice(0, 10);
  const fixtureDate = String(fixture.date || "").slice(0, 10);
  return home === expectedHome && away === expectedAway && (!fixtureDate || fixtureDate === kickoffDate);
}

function extractEspnScore_(fixture) {
  const status = espnStatus_(fixture);
  if (status.status === "scheduled") {
    return null;
  }

  const home = espnCompetitor_(fixture, "home");
  const away = espnCompetitor_(fixture, "away");
  if (!home || !away) {
    return null;
  }

  const homeScore = toNullableNumber_(home.score);
  const awayScore = toNullableNumber_(away.score);
  if (homeScore === null || awayScore === null || Number.isNaN(homeScore) || Number.isNaN(awayScore)) {
    return null;
  }
  return { home: homeScore, away: awayScore };
}

function espnStatus_(fixture) {
  const competition = firstEspnCompetition_(fixture);
  const status = (competition && competition.status) || fixture.status || {};
  const type = status.type || {};
  if (type.completed || String(type.state || "").toLowerCase() === "post") {
    return { status: "complete", minute: null };
  }
  if (String(type.state || "").toLowerCase() === "in") {
    return { status: "live", minute: espnMinute_(status) };
  }
  return { status: "scheduled", minute: null };
}

function espnMinute_(status) {
  const displayClock = String(status.displayClock || (status.type && status.type.shortDetail) || "");
  const minuteMatch = displayClock.match(/\d+/);
  if (minuteMatch) {
    return Number(minuteMatch[0]);
  }
  const clock = Number(status.clock);
  if (isFinite(clock) && clock > 0) {
    return Math.ceil(clock / 60);
  }
  return null;
}

function firstEspnCompetition_(fixture) {
  return fixture.competitions && fixture.competitions.length ? fixture.competitions[0] : null;
}

function espnCompetitor_(fixture, homeAway) {
  const competition = firstEspnCompetition_(fixture);
  const competitors = competition && Array.isArray(competition.competitors) ? competition.competitors : [];
  return competitors.find((competitor) => competitor.homeAway === homeAway) || null;
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

function getReviews_() {
  ensureReviewsSheet_();
  const rows = rowsAsObjects_(SHEETS.reviews);
  const reviews = rows
    .map(function(row) {
      return {
        id: String(row.review_id || ""),
        title: String(row.title || ""),
        preview: String(row.preview || ""),
        body: String(row.body || ""),
        publishedAt: String(row.published_at || ""),
        author: row.author ? String(row.author) : undefined
      };
    })
    .filter(function(r) { return r.id && r.title; })
    .sort(function(a, b) {
      return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
    });
  return dedupeReviews_(reviews);
}

function dedupeReviews_(reviews) {
  const seen = {};
  return reviews.filter(function(review) {
    const key = normalizeReviewContent_(review.title) + "\n" + normalizeReviewContent_(review.body);
    if (seen[key]) {
      return false;
    }
    seen[key] = true;
    return true;
  });
}

function normalizeReviewContent_(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function addReview_(adminToken, title, preview, body, author) {
  const token = String(adminToken || "").trim();
  const expectedToken = getAdminToken_();

  if (!expectedToken) {
    throw appError_("unknown", "adminToken is not configured in Script Properties");
  }
  if (token !== expectedToken) {
    throw appError_("invalid_token", "Invalid admin token");
  }

  const cleanTitle = String(title || "").trim();
  const cleanPreview = String(preview || "").trim();
  const cleanBody = String(body || "").trim();

  if (!cleanTitle || !cleanBody) {
    throw appError_("unknown", "title and body are required");
  }

  const sheet = ensureReviewsSheet_();

  const reviewId = Utilities.getUuid();
  const now = new Date().toISOString();

  sheet.appendRow([reviewId, cleanTitle, cleanPreview, cleanBody, now, String(author || "").trim()]);

  return { saved: true, reviewId, publishedAt: now };
}

function getAdminToken_() {
  const scriptToken = PropertiesService.getScriptProperties().getProperty("adminToken");
  if (scriptToken) {
    return String(scriptToken).trim();
  }
  const settings = getSettings_();
  return String(settings.adminToken || "").trim();
}

function ensureReviewsSheet_() {
  return ensureSheet_(SpreadsheetApp.getActive(), SHEETS.reviews, [
    "review_id",
    "title",
    "preview",
    "body",
    "published_at",
    "author"
  ]);
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
  return sheet;
}

function ensureRuntimeColumns_() {
  ensureSheetColumns_(SHEETS.matches, ["actual_winner"]);
  ensureSheetColumns_(SHEETS.predictions, ["predicted_winner"]);
}

function ensureSheetColumns_(sheetName, headersToAdd) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() === 0) {
    return;
  }

  const lastColumn = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map((header) => String(header).trim());
  const missingHeaders = headersToAdd.filter((header) => headers.indexOf(header) === -1);
  if (!missingHeaders.length) {
    return;
  }

  sheet.getRange(1, lastColumn + 1, 1, missingHeaders.length).setValues([missingHeaders]);
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

function normalizeMatchSide_(value, match) {
  const cleanValue = normalizeTeam_(value);
  if (!cleanValue) {
    return null;
  }
  if (cleanValue === "home" || cleanValue === "h" || (match && cleanValue === normalizeTeam_(match.home))) {
    return "home";
  }
  if (cleanValue === "away" || cleanValue === "a" || (match && cleanValue === normalizeTeam_(match.away))) {
    return "away";
  }
  return null;
}

function isKnockoutMatch_(match) {
  return String(stageOf_(match) || "").indexOf("group-") !== 0;
}

function isValidPredictionWinner_(match, prediction) {
  if (!isKnockoutMatch_(match)) {
    return true;
  }
  if (Number(prediction.predHome) !== Number(prediction.predAway)) {
    return true;
  }
  return normalizeMatchSide_(prediction.predictedWinner) !== null;
}

function normalizedPredictionWinner_(match, prediction) {
  if (!isKnockoutMatch_(match)) {
    return "";
  }
  const predHome = Number(prediction.predHome);
  const predAway = Number(prediction.predAway);
  if (predHome > predAway) {
    return "home";
  }
  if (predAway > predHome) {
    return "away";
  }
  return normalizeMatchSide_(prediction.predictedWinner) || "";
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
