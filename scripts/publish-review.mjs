import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadLocalEnv } from "./lib/env.mjs";

await loadLocalEnv();

const args = parseArgs(process.argv.slice(2));
const webAppUrl = required(args.url ?? process.env.BORODA_WEB_APP_URL, "BORODA_WEB_APP_URL or --url");
const adminToken = required(args.token ?? process.env.BORODA_ADMIN_TOKEN, "BORODA_ADMIN_TOKEN or --token");
const bodyPath = required(args.body ?? process.env.REVIEW_BODY_FILE, "REVIEW_BODY_FILE or --body");
const draft = parseFrontmatter(await readFile(resolve(bodyPath), "utf8"));
const title = required(
  args.title ?? process.env.REVIEW_TITLE ?? draft.frontmatter.title,
  "REVIEW_TITLE, --title or frontmatter title"
);
const preview = args.preview ?? process.env.REVIEW_PREVIEW ?? draft.frontmatter.preview ?? "";
const author = args.author ?? process.env.REVIEW_AUTHOR ?? draft.frontmatter.author ?? "Агент Борода";

const body = draft.body;

const response = await fetch(webAppUrl, {
  method: "POST",
  headers: { "Content-Type": "text/plain;charset=utf-8" },
  body: JSON.stringify({
    action: "addReview",
    adminToken,
    title,
    preview,
    body,
    author
  })
});

const payload = await response.json().catch(() => null);
if (!response.ok || payload?.ok === false) {
  const message = payload?.message ?? `HTTP ${response.status}`;
  throw new Error(`Review publish failed: ${message}`);
}

const data = payload?.data ?? payload;
console.log(`Published review ${data.reviewId} at ${data.publishedAt}`);

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

function parseFrontmatter(contents) {
  if (!contents.startsWith("---\n")) {
    return { frontmatter: {}, body: contents };
  }
  const endIndex = contents.indexOf("\n---", 4);
  if (endIndex === -1) {
    return { frontmatter: {}, body: contents };
  }
  const rawFrontmatter = contents.slice(4, endIndex).trim();
  const body = contents.slice(endIndex + 4).replace(/^\r?\n/, "");
  const frontmatter = {};
  for (const line of rawFrontmatter.split(/\r?\n/)) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    frontmatter[key] = unquote(value);
  }
  return { frontmatter, body };
}

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
