import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { prepareWorkspace } from "./workspace.ts";
import { computeDirtySha } from "./dirty-sha.ts";

describe("prepareWorkspace source history", () => {
  let dir: string;
  let source: string;
  let workspace: string;
  let workflow: string;
  let base: string;
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "source-history-"));
    source = path.join(dir, "source repo");
    workspace = path.join(dir, "workspace");
    fs.mkdirSync(source);
    fs.mkdirSync(workspace);
    git(source, "init", "-q");
    git(source, "config", "user.name", "local-ci");
    git(source, "config", "user.email", "local-ci@example.com");
    const workflows = path.join(source, ".github", "workflows");
    fs.mkdirSync(workflows, { recursive: true });
    workflow = path.join(workflows, "ci.yml");
    fs.writeFileSync(workflow, "name: Test\non: [push]\njobs: {}\n");
    fs.writeFileSync(path.join(source, "file.txt"), "base\n");
    git(source, "add", ".");
    git(source, "commit", "-qm", "base");
    base = git(source, "rev-parse", "HEAD");
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it.each([false, true])(
    "imports real history and SHA without changing the source (dirty: %s)",
    async (dirty) => {
      fs.writeFileSync(path.join(source, "file.txt"), "changed\n");
      if (!dirty) {
        git(source, "add", ".");
        git(source, "commit", "-qm", "changed");
      } else {
        fs.writeFileSync(path.join(source, "untracked.txt"), "new\n");
      }
      const sourceHead = git(source, "rev-parse", "HEAD");
      const sha = (await computeDirtySha(source)) ?? sourceHead;
      const indexPath = path.join(source, ".git", "index");
      const index = fs.readFileSync(indexPath);
      const status = git(source, "status", "--porcelain");
      await prepareWorkspace({
        workflowPath: workflow,
        githubRepo: "example/repo",
        realHeadSha: sha,
        workspaceDir: workspace,
      });
      expect(git(workspace, "rev-parse", "HEAD")).toBe(sha);
      expect(git(workspace, "diff", "--name-only", base, "HEAD").split("\n")).toEqual(
        dirty ? ["file.txt", "untracked.txt"] : ["file.txt"],
      );
      expect(git(workspace, "status", "--porcelain")).toBe("");
      expect(git(source, "rev-parse", "HEAD")).toBe(sourceHead);
      expect(git(source, "status", "--porcelain")).toBe(status);
      expect(fs.readFileSync(indexPath)).toEqual(index);
      // Imported objects must survive without alternates or the host repository.
      fs.renameSync(source, source + "-unavailable");
      expect(git(workspace, "show", `${base}:file.txt`)).toBe("base");
    },
  );

  it("archives a requested historical commit instead of the current worktree", async () => {
    fs.writeFileSync(path.join(source, "file.txt"), "later\n");
    git(source, "add", ".");
    git(source, "commit", "-qm", "later");
    await prepareWorkspace({
      workflowPath: workflow,
      headSha: base,
      realHeadSha: base,
      githubRepo: "example/repo",
      workspaceDir: workspace,
    });
    expect(git(workspace, "rev-parse", "HEAD")).toBe(base);
    expect(fs.readFileSync(path.join(workspace, "file.txt"), "utf8")).toBe("base\n");
  });

  it("rejects an unavailable snapshot rather than creating synthetic history", async () => {
    await expect(
      prepareWorkspace({
        workflowPath: workflow,
        realHeadSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        githubRepo: "example/repo",
        workspaceDir: workspace,
      }),
    ).rejects.toThrow();
  });

  it("preserves the available history boundary of a shallow source repository", async () => {
    fs.writeFileSync(path.join(source, "file.txt"), "later\n");
    git(source, "add", ".");
    git(source, "commit", "-qm", "later");
    const shallow = path.join(dir, "shallow");
    git(dir, "clone", "--quiet", "--depth", "1", pathToFileURL(source).href, shallow);
    await prepareWorkspace({
      workflowPath: path.join(shallow, ".github", "workflows", "ci.yml"),
      realHeadSha: git(shallow, "rev-parse", "HEAD"),
      githubRepo: "example/repo",
      workspaceDir: workspace,
    });
    expect(git(workspace, "rev-parse", "--is-shallow-repository")).toBe("true");
    expect(git(workspace, "log", "--format=%s")).toBe("later");
  });
});
