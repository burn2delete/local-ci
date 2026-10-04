import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

// ── writeGitShim ──────────────────────────────────────────────────────────────

describe("writeGitShim", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shim-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates an executable git shim with the correct SHA", async () => {
    const { writeGitShim } = await import("./git-shim.ts");
    const sha = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    writeGitShim(tmpDir, sha);

    const shimPath = path.join(tmpDir, "git");
    expect(fs.existsSync(shimPath)).toBe(true);

    const content = fs.readFileSync(shimPath, "utf-8");
    expect(content).toContain("#!/bin/bash");
    expect(content).toContain(sha);
    expect(content).toContain("ls-remote");
    expect(content).toContain("git.real");

    // Check executable permission
    const stat = fs.statSync(shimPath);
    expect(stat.mode & 0o755).toBe(0o755);
  });

  it.each([
    [false, false],
    [true, false],
    [true, true],
  ])(
    "creates FETCH_HEAD after fetch (existing commit: %s, -C: %s)",
    async (hasExistingCommit, useC) => {
      const { writeGitShim } = await import("./git-shim.ts");
      const repository = path.join(tmpDir, "repository");
      const shims = path.join(tmpDir, "shims");
      fs.mkdirSync(repository);
      fs.mkdirSync(shims);
      fs.writeFileSync(path.join(repository, "example.txt"), "workspace\n");

      const realGit = fs.existsSync("/usr/bin/git.real")
        ? "/usr/bin/git.real"
        : spawnSync("which", ["git"], { encoding: "utf8" }).stdout.trim();
      const runGit = (args: string[]) =>
        spawnSync(realGit, args, { cwd: repository, encoding: "utf8" });
      expect(runGit(["init", "-q"]).status).toBe(0);
      if (hasExistingCommit) {
        expect(runGit(["add", "-A"]).status).toBe(0);
        expect(
          runGit([
            "-c",
            "user.name=local-ci",
            "-c",
            "user.email=local-ci@example.com",
            "commit",
            "-qm",
            "workspace",
          ]).status,
        ).toBe(0);
      }

      writeGitShim(shims, "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef");
      const shim = path.join(shims, "git");
      const log = path.join(tmpDir, "git.log");
      fs.writeFileSync(
        shim,
        fs
          .readFileSync(shim, "utf8")
          .replaceAll("/usr/bin/git.real", realGit)
          .replaceAll("/home/runner/_diag/local-ci-git-calls.log", log),
      );

      const fetch = spawnSync(
        "bash",
        [
          shim,
          ...(useC ? ["-C", repository, "-c", "protocol.version=2"] : []),
          "fetch",
          "--no-tags",
          "--depth",
          "1",
          "origin",
          "example-branch",
        ],
        {
          cwd: useC ? tmpDir : repository,
          env: { ...process.env, GITHUB_WORKSPACE: repository },
          encoding: "utf8",
        },
      );
      expect(fetch.stderr).toBe("");
      expect(fetch.status).toBe(0);

      const head = runGit(["rev-parse", "HEAD"]).stdout.trim();
      expect(fs.readFileSync(path.join(repository, ".git", "FETCH_HEAD"), "utf8").trim()).toBe(
        head,
      );
      expect(
        spawnSync("bash", [shim, "checkout", "-q", "--detach", "FETCH_HEAD"], {
          cwd: repository,
          env: { ...process.env, GITHUB_WORKSPACE: repository },
          encoding: "utf8",
        }).status,
      ).toBe(0);
    },
  );

  it.each([false, true])(
    "preserves Git behavior in fixture repositories (-C: %s)",
    async (useC) => {
      const { writeGitShim } = await import("./git-shim.ts");
      const workspace = path.join(tmpDir, "workspace");
      const fixture = path.join(workspace, "fixture");
      fs.mkdirSync(fixture, { recursive: true });
      const realGit = fs.existsSync("/usr/bin/git.real")
        ? "/usr/bin/git.real"
        : spawnSync("which", ["git"], { encoding: "utf8" }).stdout.trim();
      const git = (...args: string[]) =>
        spawnSync(realGit, args, { cwd: fixture, encoding: "utf8" });
      expect(git("init", "-q").status).toBe(0);
      fs.writeFileSync(path.join(fixture, "tracked.txt"), "fixture\n");
      expect(git("add", ".").status).toBe(0);
      expect(
        git(
          "-c",
          "user.name=fixture",
          "-c",
          "user.email=fixture@example.com",
          "commit",
          "-qm",
          "fixture",
        ).status,
      ).toBe(0);
      const head = git("rev-parse", "HEAD").stdout.trim();
      writeGitShim(tmpDir, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      const shim = path.join(tmpDir, "git");
      fs.writeFileSync(
        shim,
        fs
          .readFileSync(shim, "utf8")
          .replaceAll("/usr/bin/git.real", realGit)
          .replaceAll("/home/runner/_diag/local-ci-git-calls.log", path.join(tmpDir, "git.log")),
      );
      const run = (...args: string[]) =>
        spawnSync("bash", [shim, ...(useC ? ["-C", fixture] : []), ...args], {
          cwd: useC ? workspace : fixture,
          env: { ...process.env, GITHUB_WORKSPACE: workspace },
          encoding: "utf8",
        });
      expect(run("rev-parse", "HEAD").stdout.trim()).toBe(head);
      expect(run("rm", "tracked.txt").status).toBe(0);
      expect(fs.existsSync(path.join(fixture, "tracked.txt"))).toBe(false);
    },
  );
});
