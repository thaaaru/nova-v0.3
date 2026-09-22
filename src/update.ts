import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export function isGitHubRemote(remote: string): boolean {
  return /(?:github\.com[:/])[^\s/]+\/[^\s/]+(?:\.git)?\/?$/i.test(remote.trim());
}

async function git(args: string[], cwd: string): Promise<string> {
  const result = await run("git", args, { cwd, encoding: "utf8" });
  return result.stdout.trim();
}

/** Safely fast-forwards Nova from its configured GitHub upstream; never merges or overwrites local work. */
export async function updateNova(cwd = process.cwd()): Promise<{ before: string; after: string; updated: boolean }> {
  const root = await git(["rev-parse", "--show-toplevel"], cwd);
  if (await git(["status", "--porcelain"], root)) throw new Error("NOVA_UPDATE_WORKTREE_DIRTY: Commit, stash, or remove local changes before running nova update.");
  const remote = await git(["remote", "get-url", "origin"], root);
  if (!isGitHubRemote(remote)) throw new Error("NOVA_UPDATE_UNTRUSTED_REMOTE: nova update only fetches from a GitHub origin remote.");
  const before = await git(["rev-parse", "HEAD"], root);
  let upstream = "origin/main";
  try { upstream = await git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], root); } catch { /* a new branch may not have an upstream */ }
  await git(["fetch", "--prune", "origin"], root);
  await git(["merge", "--ff-only", upstream], root);
  const after = await git(["rev-parse", "HEAD"], root);
  return { before, after, updated: before !== after };
}
