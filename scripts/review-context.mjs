import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadLocalEnv } from "./lib/env.mjs";

await loadLocalEnv();

const args = parseArgs(process.argv.slice(2));
const webAppUrl = required(
  args.url ?? process.env.BORODA_WEB_APP_URL ?? process.env.VITE_APPS_SCRIPT_URL,
  "BORODA_WEB_APP_URL, VITE_APPS_SCRIPT_URL or --url"
);
const now = args.now ? new Date(args.now) : new Date();
const lookbackHours = Number(args["lookback-hours"] ?? 36);
const upcomingHours = Number(args["upcoming-hours"] ?? 24);
const outPath = resolve(args.out ?? "tmp/daily-review-context.md");
const reviewArchiveDir = resolve(args["reviews-dir"] ?? "content/reviews/published");

const [state, reviews] = await Promise.all([
  fetchAction(webAppUrl, "state"),
  fetchAction(webAppUrl, "reviews").catch(() => [])
]);

const sortedReviews = dedupeReviews(reviews).sort((a, b) => dateMs(b.publishedAt) - dateMs(a.publishedAt));
await archivePublishedReviews(sortedReviews, reviewArchiveDir);
const latestReview = sortedReviews[0] ?? null;
const since = args.since
  ? new Date(args.since)
  : latestReview?.publishedAt
    ? new Date(latestReview.publishedAt)
    : new Date(now.getTime() - lookbackHours * 60 * 60 * 1000);

const completedMatches = sortMatches(state.matches).filter(isCompleted);
let reviewMatches = completedMatches.filter((match) => {
  const kickoff = new Date(match.kickoffUtc);
  return kickoff > since && kickoff <= now;
});

if (!reviewMatches.length) {
  const fallbackSince = new Date(now.getTime() - lookbackHours * 60 * 60 * 1000);
  reviewMatches = completedMatches.filter((match) => {
    const kickoff = new Date(match.kickoffUtc);
    return kickoff >= fallbackSince && kickoff <= now;
  });
}

if (!reviewMatches.length && completedMatches.length) {
  const latestCompleted = completedMatches[completedMatches.length - 1];
  const latestDay = latestCompleted.kickoffUtc.slice(0, 10);
  reviewMatches = completedMatches.filter((match) => match.kickoffUtc.slice(0, 10) === latestDay);
}

const reviewMatchIds = new Set(reviewMatches.map((match) => match.id));
const firstReviewKickoff = reviewMatches.length
  ? new Date(reviewMatches[0].kickoffUtc)
  : since;
const previousCompletedMatches = completedMatches.filter((match) => new Date(match.kickoffUtc) < firstReviewKickoff);
const completedThroughReview = completedMatches.filter((match) => {
  if (!reviewMatches.length) {
    return new Date(match.kickoffUtc) <= now;
  }
  return new Date(match.kickoffUtc) <= new Date(reviewMatches[reviewMatches.length - 1].kickoffUtc);
});

const beforeLeaderboard = leaderboard(state, previousCompletedMatches);
const afterLeaderboard = leaderboard(state, completedThroughReview);
const dayRows = participantDayRows(state, reviewMatches, beforeLeaderboard, afterLeaderboard);
const upcomingMatches = sortMatches(state.matches).filter((match) => {
  const kickoff = new Date(match.kickoffUtc);
  return (
    kickoff > now &&
    kickoff <= new Date(now.getTime() + upcomingHours * 60 * 60 * 1000) &&
    predictionsForMatch(state, match.id).length > 0
  );
});

const markdown = renderMarkdown({
  state,
  now,
  since,
  latestReview,
  sortedReviews,
  reviewMatches,
  reviewMatchIds,
  beforeLeaderboard,
  afterLeaderboard,
  dayRows,
  upcomingMatches,
  upcomingHours
});

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, markdown, "utf8");
console.log(`Wrote ${outPath}`);
console.log(`Review matches: ${reviewMatches.length}`);
console.log(`Upcoming matches: ${upcomingMatches.length}`);

function renderMarkdown(context) {
  const {
    state,
    now,
    since,
    latestReview,
    sortedReviews,
    reviewMatches,
    beforeLeaderboard,
    afterLeaderboard,
    dayRows,
    upcomingMatches,
    upcomingHours
  } = context;

  return [
    "# Boroda Daily Review Context",
    "",
    "Use this file as the local tournament briefing. Before writing the review, browse reliable football sources for the real match narrative: goals, cards, missed chances, injuries, VAR, momentum swings, and quotes if useful.",
    "",
    "## Run Metadata",
    "",
    `- Generated at: ${now.toISOString()}`,
    `- Window since: ${since.toISOString()}`,
    `- Tournament: ${state.tournamentName}`,
    `- Participants: ${state.participants.length}`,
    `- Latest published review: ${latestReview ? `${latestReview.title} (${latestReview.publishedAt})` : "none"}`,
    "",
    "## Matches To Review",
    "",
    reviewMatches.length
      ? reviewMatches.map((match) => renderMatchToReview(state, match)).join("\n\n")
      : "No completed matches found in the review window. If this is unexpected, inspect `action=state` and live-score finalization.",
    "",
    "## Leaderboard Before",
    "",
    renderLeaderboard(beforeLeaderboard),
    "",
    "## Leaderboard After",
    "",
    renderLeaderboard(afterLeaderboard),
    "",
    "## Participant Day Summary",
    "",
    dayRows.length
      ? dayRows.map((row) => {
          const movement = row.hasPreviousScores && row.beforeRank && row.afterRank
            ? rankMovement(row.beforeRank, row.afterRank)
            : !row.hasPreviousScores
              ? "first scoring day"
            : "new/no rank";
          return `- **${row.name}**: ${row.dayPoints} pts today, ${row.afterTotal} total, rank ${row.afterRank || "-"} (${movement}). ${row.matchNotes.join("; ") || "no visible predictions in reviewed matches"}.`;
        }).join("\n")
      : state.participants.map((participant) => `- **${participant.displayName}**: no completed matches in this run.`).join("\n"),
    "",
    "## Upcoming Watchlist",
    "",
    upcomingMatches.length
      ? upcomingMatches.map((match) => renderUpcomingMatch(state, match)).join("\n\n")
      : `No matches with visible predictions in the next ${upcomingHours} hours. Do not preview hidden-prediction matches.`,
    "",
    "## Previous Reviews For Story And Style",
    "",
    sortedReviews.slice(0, 5).length
      ? sortedReviews.slice(0, 5).map(renderPreviousReview).join("\n\n")
      : "- none",
    "",
    `Published review archive synced to: ${reviewArchiveDir}`,
    "",
    "## Suggested Codex Task",
    "",
    "Write today's Russian Markdown review for the Boroda prediction tournament.",
    "",
    "Requirements:",
    "- Browse current football sources for every match in `Matches To Review`.",
    "- Combine real match story with the prediction tournament story.",
    "- Mention every participant at least once.",
    "- Continue the story and authorial style from `Previous Reviews For Story And Style` when available.",
    "- Preview only matches listed in `Upcoming Watchlist`; do not mention hidden-prediction matches.",
    "- Produce `title`, `preview`, and `body`.",
    "- Save body as a local project draft under `content/reviews/drafts/`.",
    "- Do not publish until the user approves the draft.",
    ""
  ].join("\n");
}

function renderPreviousReview(review) {
  return [
    `### ${review.title}`,
    "",
    `- Published at: ${review.publishedAt}`,
    `- Preview: ${review.preview || "-"}`,
    "",
    excerpt(review.body, 1200)
  ].join("\n");
}

function dedupeReviews(reviews) {
  const byContent = new Map();
  for (const review of reviews) {
    const key = `${normalizeReviewContent(review.title)}\n${normalizeReviewContent(review.body)}`;
    const existing = byContent.get(key);
    if (!existing || dateMs(review.publishedAt) > dateMs(existing.publishedAt)) {
      byContent.set(key, review);
    }
  }
  return [...byContent.values()];
}

function normalizeReviewContent(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function renderMatchToReview(state, match) {
  const predictions = predictionsForMatch(state, match.id);
  const rows = state.participants.map((participant) => {
    const prediction = predictions.find((item) => item.participantId === participant.id);
    const points = scorePrediction(actualScore(match), predictionScore(prediction), {
      includeAdvanceBonus: isKnockout(match)
    });
    return {
      name: participant.displayName,
      prediction,
      points
    };
  });
  const exact = rows.filter((row) => row.points >= (isKnockout(match) ? 8 : 5)).map((row) => row.name);
  const positive = rows.filter((row) => row.points > 0 && !exact.includes(row.name)).map((row) => `${row.name} ${row.points}`);
  const misses = rows.filter((row) => row.prediction && row.points === 0).map((row) => row.name);
  const noPrediction = rows.filter((row) => !row.prediction).map((row) => row.name);

  return [
    `### ${match.home} ${match.actualHome}:${match.actualAway} ${match.away}`,
    "",
    `- Match ID: ${match.id}`,
    `- Kickoff UTC: ${match.kickoffUtc}`,
    `- Stage: ${stageTitle(state, match.stageId)}`,
    `- Research queries: "${match.home} vs ${match.away} ${match.kickoffUtc.slice(0, 10)} goals highlights", "${match.home} ${match.away} match report ${match.kickoffUtc.slice(0, 10)}"`,
    `- Exact/maximum hits: ${exact.length ? exact.join(", ") : "none"}`,
    `- Other points: ${positive.length ? positive.join(", ") : "none"}`,
    `- Misses: ${misses.length ? misses.join(", ") : "none"}`,
    `- No visible prediction: ${noPrediction.length ? noPrediction.join(", ") : "none"}`,
    "- Visible predictions:",
    rows.map((row) => `  - ${row.name}: ${formatPrediction(row.prediction, match)} -> ${row.points}`).join("\n")
  ].join("\n");
}

function renderUpcomingMatch(state, match) {
  const predictions = predictionsForMatch(state, match.id);
  const submittedIds = new Set(
    state.submittedMatches.find((item) => item.matchId === match.id)?.participantIds ?? []
  );
  const visibleRows = state.participants.map((participant) => {
    const prediction = predictions.find((item) => item.participantId === participant.id);
    if (prediction) {
      return `${participant.displayName}: ${formatPrediction(prediction, match)}`;
    }
    if (submittedIds.has(participant.id)) {
      return `${participant.displayName}: submitted, hidden`;
    }
    return `${participant.displayName}: no submission visible`;
  });
  const distribution = predictionDistribution(predictions);

  return [
    `### ${match.home} - ${match.away}`,
    "",
    `- Match ID: ${match.id}`,
    `- Kickoff UTC: ${match.kickoffUtc}`,
    `- Stage: ${stageTitle(state, match.stageId)}`,
    `- Visible prediction distribution: ${distribution}`,
    "- Participants:",
    visibleRows.map((row) => `  - ${row}`).join("\n")
  ].join("\n");
}

function renderLeaderboard(rows) {
  return rows.length
    ? rows.map((row) => `- #${row.rank} ${row.name}: ${row.total}`).join("\n")
    : "- no scored matches yet";
}

function participantDayRows(state, reviewMatches, beforeLeaderboard, afterLeaderboard) {
  const beforeById = new Map(beforeLeaderboard.map((row) => [row.participantId, row]));
  const afterById = new Map(afterLeaderboard.map((row) => [row.participantId, row]));
  const hasPreviousScores = beforeLeaderboard.some((row) => row.total > 0);
  return state.participants.map((participant) => {
    const matchNotes = reviewMatches.map((match) => {
      const prediction = state.predictions.find((item) =>
        item.participantId === participant.id && item.matchId === match.id
      );
      if (!prediction) {
        return `${match.home}-${match.away}: no visible prediction`;
      }
      const points = scorePrediction(actualScore(match), predictionScore(prediction), {
        includeAdvanceBonus: isKnockout(match)
      });
      return `${match.home}-${match.away}: ${formatPrediction(prediction, match)} for ${points}`;
    });
    const before = beforeById.get(participant.id);
    const after = afterById.get(participant.id);
    return {
      participantId: participant.id,
      name: participant.displayName,
      beforeRank: before?.rank ?? null,
      afterRank: after?.rank ?? null,
      beforeTotal: before?.total ?? 0,
      afterTotal: after?.total ?? 0,
      dayPoints: (after?.total ?? 0) - (before?.total ?? 0),
      hasPreviousScores,
      matchNotes
    };
  }).sort((a, b) => b.dayPoints - a.dayPoints || a.name.localeCompare(b.name));
}

function leaderboard(state, matches) {
  const rows = state.participants.map((participant) => {
    const total = matches.reduce((sum, match) => {
      const prediction = state.predictions.find((item) =>
        item.participantId === participant.id && item.matchId === match.id
      );
      return sum + scorePrediction(actualScore(match), predictionScore(prediction), {
        includeAdvanceBonus: isKnockout(match)
      });
    }, 0);
    return { participantId: participant.id, name: participant.displayName, total, rank: 0 };
  }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  let lastTotal = null;
  let lastRank = 0;
  rows.forEach((row, index) => {
    if (lastTotal === null || row.total !== lastTotal) {
      lastRank = index + 1;
      lastTotal = row.total;
    }
    row.rank = lastRank;
  });
  return rows;
}

function predictionDistribution(predictions) {
  if (!predictions.length) {
    return "no visible predictions";
  }
  const buckets = new Map();
  for (const prediction of predictions) {
    const key = `${prediction.predHome}:${prediction.predAway}`;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return [...buckets.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([score, count]) => `${score} x${count}`)
    .join(", ");
}

function scorePrediction(actual, prediction, options = {}) {
  if (!actual || !prediction) {
    return 0;
  }

  let points = 0;
  if (actual.home === prediction.home && actual.away === prediction.away) {
    points = 5;
  } else {
    const actualDiff = actual.home - actual.away;
    const predictedDiff = prediction.home - prediction.away;
    if (actualDiff === predictedDiff) {
      points = 4;
    } else if (outcome(actualDiff) === outcome(predictedDiff)) {
      points = 3;
    }
  }

  if (options.includeAdvanceBonus && advancedSide(actual) === advancedSide(prediction) && advancedSide(actual)) {
    points += 3;
  }
  return points;
}

function outcome(diff) {
  if (diff > 0) return "home";
  if (diff < 0) return "away";
  return "draw";
}

function advancedSide(score) {
  if (!score) return null;
  if (score.home > score.away) return "home";
  if (score.away > score.home) return "away";
  return score.winner ?? null;
}

function actualScore(match) {
  if (match.actualHome === null || match.actualAway === null) {
    return null;
  }
  return { home: match.actualHome, away: match.actualAway, winner: match.actualWinner ?? null };
}

function predictionScore(prediction) {
  if (!prediction) {
    return null;
  }
  return {
    home: prediction.predHome,
    away: prediction.predAway,
    winner: prediction.predictedWinner ?? null
  };
}

function formatPrediction(prediction, match) {
  if (!prediction) {
    return "-";
  }
  const score = `${prediction.predHome}:${prediction.predAway}`;
  if (isKnockout(match) && prediction.predHome === prediction.predAway && prediction.predictedWinner) {
    return `${score}, advances ${teamBySide(match, prediction.predictedWinner)}`;
  }
  return score;
}

function teamBySide(match, side) {
  if (side === "home") return match.home;
  if (side === "away") return match.away;
  return "";
}

function predictionsForMatch(state, matchId) {
  return state.predictions.filter((prediction) => prediction.matchId === matchId);
}

function isCompleted(match) {
  return match.status === "complete" && match.actualHome !== null && match.actualAway !== null;
}

function isKnockout(match) {
  return !String(match.stageId).startsWith("group-");
}

function sortMatches(matches) {
  return [...matches].sort((a, b) => {
    const byKickoff = dateMs(a.kickoffUtc) - dateMs(b.kickoffUtc);
    if (byKickoff !== 0) {
      return byKickoff;
    }
    return Number(a.displayOrder ?? 0) - Number(b.displayOrder ?? 0);
  });
}

function stageTitle(state, stageId) {
  return state.stages.find((stage) => stage.id === stageId)?.title ?? stageId;
}

function rankMovement(beforeRank, afterRank) {
  const diff = beforeRank - afterRank;
  if (diff > 0) return `up ${diff}`;
  if (diff < 0) return `down ${Math.abs(diff)}`;
  return "same rank";
}

async function fetchAction(webAppUrl, action) {
  const url = new URL(webAppUrl);
  url.searchParams.set("action", action);
  const response = await fetch(url);
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok === false) {
    throw new Error(`${action} failed: ${payload?.message ?? `HTTP ${response.status}`}`);
  }
  return payload?.data ?? payload;
}

async function archivePublishedReviews(reviews, archiveDir) {
  await mkdir(archiveDir, { recursive: true });
  await Promise.all(reviews.map((review) => {
    const date = dateSlug(review.publishedAt);
    const title = slugify(review.title || "review");
    const id = slugify(review.id || "no-id");
    const filePath = resolve(archiveDir, `${date}-${title}-${id}.md`);
    const contents = [
      "---",
      `id: ${review.id || ""}`,
      `title: ${JSON.stringify(review.title || "")}`,
      `preview: ${JSON.stringify(review.preview || "")}`,
      `publishedAt: ${review.publishedAt || ""}`,
      `author: ${JSON.stringify(review.author || "")}`,
      "---",
      "",
      review.body || "",
      ""
    ].join("\n");
    return writeFile(filePath, contents, "utf8");
  }));
}

function excerpt(value, maxLength) {
  const clean = String(value || "").replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) {
    return clean || "-";
  }
  return `${clean.slice(0, maxLength - 1).trim()}...`;
}

function dateSlug(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "undated";
  }
  return date.toISOString().slice(0, 10);
}

function slugify(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "review";
}

function dateMs(value) {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = "true";
      continue;
    }
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

function required(value, name) {
  const clean = String(value ?? "").trim();
  if (!clean) {
    throw new Error(`${name} is required`);
  }
  return clean;
}
