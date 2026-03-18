import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadPlatformPolicy } from "../platform-loader.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("loadPlatformPolicy", () => {
  it("prefers an explicit absolute policy file path", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "octopus-workspace-"));
    const externalRoot = await mkdtemp(join(tmpdir(), "octopus-policy-"));
    tempDirs.push(workspaceRoot, externalRoot);

    const explicitPath = join(externalRoot, "policy.json");
    await writeFile(explicitPath, JSON.stringify({ schemaVersion: 1, allowedExecutables: ["git"] }), "utf8");
    const resolvedExplicitPath = await realpath(explicitPath);

    const resolution = loadPlatformPolicy({
      workspaceRoot,
      policyFilePath: explicitPath,
      homeDir: externalRoot
    });

    expect(resolution).toMatchObject({
      source: "flag",
      defaultDeny: false,
      policyFilePath: resolvedExplicitPath,
      policyFile: {
        allowedExecutables: ["git"]
      }
    });
  });

  it("falls back to the global policy file when no explicit path is provided", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "octopus-workspace-"));
    const homeDir = await mkdtemp(join(tmpdir(), "octopus-home-"));
    tempDirs.push(workspaceRoot, homeDir);

    await mkdir(join(homeDir, ".octopus"), { recursive: true });
    const globalPolicyPath = join(homeDir, ".octopus", "policy.json");
    await writeFile(globalPolicyPath, JSON.stringify({ schemaVersion: 1, allowNetwork: true }), "utf8");
    const resolvedGlobalPolicyPath = await realpath(globalPolicyPath);

    const resolution = loadPlatformPolicy({
      workspaceRoot,
      homeDir
    });

    expect(resolution).toMatchObject({
      source: "global",
      defaultDeny: false,
      policyFilePath: resolvedGlobalPolicyPath,
      policyFile: {
        allowNetwork: true
      }
    });
  });

  it("rejects policy files whose realpath resolves inside the workspace", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "octopus-workspace-"));
    const outsideRoot = await mkdtemp(join(tmpdir(), "octopus-outside-"));
    tempDirs.push(workspaceRoot, outsideRoot);

    await mkdir(join(workspaceRoot, ".octopus"), { recursive: true });
    const workspacePolicyPath = join(workspaceRoot, ".octopus", "policy.json");
    await writeFile(workspacePolicyPath, JSON.stringify({ schemaVersion: 1 }), "utf8");

    const symlinkPath = join(outsideRoot, "workspace-policy-link.json");
    await symlink(workspacePolicyPath, symlinkPath);

    expect(() =>
      loadPlatformPolicy({
        workspaceRoot: resolve(workspaceRoot),
        policyFilePath: resolve(symlinkPath),
        homeDir: outsideRoot
      })
    ).toThrow(/not trusted/i);
  });
});
