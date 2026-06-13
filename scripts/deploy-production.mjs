import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

const branch = capture("git", ["branch", "--show-current"], root).trim();
if (branch !== "main") {
  throw new Error(`Deploy production from main. Current branch: ${branch || "(detached)"}`);
}

const status = capture("git", ["status", "--porcelain"], root).trim();
if (status) {
  console.error(status);
  throw new Error("Commit or stash local changes before production deploy.");
}

run("npm", ["test"], root);
run("npm", ["run", "build"], root);
run("git", ["push", "origin", "main"], root);
run("npm", ["run", "deploy:pages"], root);

function capture(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
  return result.stdout;
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
