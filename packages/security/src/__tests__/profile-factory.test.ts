import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createPolicy } from "../index.js";
import { PlatformPolicy } from "../platform.js";
import { SafeLocalPolicy } from "../safe-local.js";
import { VibePolicy } from "../vibe.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("createPolicy", () => {
  it("creates safe-local and vibe policies directly", () => {
    const safeLocal = createPolicy("safe-local", { allowModelApiCall: true });
    const vibe = createPolicy("vibe", { allowModelApiCall: true });

    expect(safeLocal.policy).toBeInstanceOf(SafeLocalPolicy);
    expect(vibe.policy).toBeInstanceOf(VibePolicy);
    expect(safeLocal.resolution.source).toBe("builtin");
    expect(vibe.resolution.source).toBe("builtin");
  });

  it("creates a platform policy from the resolved policy file", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "octopus-workspace-"));
    const homeDir = await mkdtemp(join(tmpdir(), "octopus-home-"));
    tempDirs.push(workspaceRoot, homeDir);

    await mkdir(join(homeDir, ".octopus"), { recursive: true });
    await writeFile(
      join(homeDir, ".octopus", "policy.json"),
      JSON.stringify({ schemaVersion: 1, allowedExecutables: ["git"] }),
      "utf8"
    );

    const result = createPolicy("platform", {
      allowModelApiCall: true,
      workspaceRoot,
      homeDir
    });

    expect(result.policy).toBeInstanceOf(PlatformPolicy);
    expect(result.resolution).toMatchObject({
      source: "global",
      defaultDeny: false,
      allowedExecutables: ["git"]
    });
  });
});
