import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { copyWorkspace } from "../output/cleanup.ts";
import { findRepoRoot } from "./metadata.ts";

const execFileAsync = promisify(execFile);

export interface PrepareWorkspaceOpts {
  workflowPath?: string;
  headSha?: string;
  realHeadSha?: string;
  githubRepo?: string;
  workspaceDir: string;
}

/** Copy the source snapshot and import its real Git objects into a private repo. */
export async function prepareWorkspace(opts: PrepareWorkspaceOpts): Promise<void> {
  const { workflowPath, headSha, realHeadSha, githubRepo, workspaceDir } = opts;
  const repoRoot =
    (workflowPath && findRepoRoot(workflowPath)) ||
    execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const { stdout } = await execFileAsync(
    "git",
    ["rev-parse", "--verify", `${realHeadSha ?? headSha ?? "HEAD"}^{commit}`],
    { cwd: repoRoot },
  );
  const snapshot = stdout.trim();

  if (headSha && headSha !== "HEAD") {
    // Arguments stay out of shell interpolation, including repo paths with spaces.
    const archiveDir = fs.mkdtempSync(path.join(os.tmpdir(), "local-ci-archive-"));
    try {
      const archive = path.join(archiveDir, "source.tar");
      await execFileAsync("git", ["archive", "--output", archive, snapshot], { cwd: repoRoot });
      await execFileAsync("tar", ["-xf", archive, "-C", workspaceDir]);
    } finally {
      fs.rmSync(archiveDir, { recursive: true, force: true });
    }
  } else {
    copyWorkspace(repoRoot, workspaceDir);
  }

  if (githubRepo) {
    const git = (...args: string[]) => execFileAsync("git", args, { cwd: workspaceDir });
    await git("init", "-q");
    await git("config", "user.name", "local-ci");
    await git("config", "user.email", "local-ci@example.com");
    await git("remote", "add", "origin", `http://127.0.0.1/${githubRepo}`);
    // Fetch from the host repo locally, including unreferenced dirty snapshot commits.
    // Unlike shared clones/alternates, these objects remain usable inside Docker.
    await git("fetch", "--quiet", "--no-tags", "--update-shallow", repoRoot, snapshot);
    await git("reset", "--hard", snapshot);
    await git("update-ref", "refs/remotes/origin/main", snapshot);
    await git("checkout", "--quiet", "--detach", snapshot);
  }
}
