import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const distDir = join(root, "dist");
const worktreeDir = "/private/tmp/worldcup-gh-pages";

runOptional("git", ["worktree", "remove", "--force", worktreeDir], root);
await rm(worktreeDir, { recursive: true, force: true });
run("git", ["worktree", "prune"], root);
run("git", ["worktree", "add", "-B", "gh-pages", worktreeDir, "gh-pages"], root);

for (const entry of await readdir(worktreeDir)) {
  if (entry === ".git") {
    continue;
  }
  await rm(join(worktreeDir, entry), { recursive: true, force: true });
}

await mkdir(worktreeDir, { recursive: true });
await cp(distDir, worktreeDir, { recursive: true });
await writeFile(join(worktreeDir, ".nojekyll"), "", "utf8");

run("git", ["add", "-A"], worktreeDir);
const hasChanges = spawnSync("git", ["diff", "--cached", "--quiet"], {
  cwd: worktreeDir,
  stdio: "inherit"
}).status !== 0;

if (!hasChanges) {
  console.log("No GitHub Pages changes to deploy.");
  process.exit(0);
}

run("git", ["commit", "-m", "Deploy GitHub Pages"], worktreeDir);
run("git", ["push", "origin", "gh-pages"], worktreeDir);

function runOptional(command, args, cwd) {
  spawnSync(command, args, {
    cwd,
    stdio: "ignore"
  });
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit"
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
}
