import { readFile } from "node:fs/promises";

export async function loadLocalEnv(paths = [".env.local", ".env"]) {
  for (const path of paths) {
    let contents = "";
    try {
      contents = await readFile(path, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
      continue;
    }

    for (const line of contents.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) {
        continue;
      }
      const [, key, rawValue] = match;
      if (process.env[key] !== undefined) {
        continue;
      }
      process.env[key] = unquote(rawValue.trim());
    }
  }
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
