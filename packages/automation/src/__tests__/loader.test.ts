import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadAutomationConfig } from "../loader.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("loadAutomationConfig", () => {
  it("loads named goals and typed source definitions", async () => {
    const root = await mkdtemp(join(tmpdir(), "octopus-automation-"));
    tempDirs.push(root);
    const configPath = join(root, "automation.json");
    await writeFile(
      configPath,
      JSON.stringify({
        goals: {
          "daily-report": {
            description: "Generate daily report",
            constraints: ["reports/"],
            successCriteria: ["Output exists"]
          }
        },
        sources: [
          { type: "cron", namedGoalId: "daily-report", schedule: "0 9 * * 1-5" },
          { type: "watcher", namedGoalId: "daily-report", watchPath: "./incoming", events: ["add"] }
        ]
      }),
      "utf8"
    );

    const config = loadAutomationConfig(configPath);

    expect(config.goals["daily-report"]?.description).toBe("Generate daily report");
    expect(config.sources).toEqual([
      { type: "cron", namedGoalId: "daily-report", schedule: "0 9 * * 1-5" },
      { type: "watcher", namedGoalId: "daily-report", watchPath: "./incoming", events: ["add"], debounceMs: undefined }
    ]);
  });

  it("fails fast when a source references an unknown named goal", async () => {
    const root = await mkdtemp(join(tmpdir(), "octopus-automation-"));
    tempDirs.push(root);
    const configPath = join(root, "automation.json");
    await writeFile(
      configPath,
      JSON.stringify({
        goals: {},
        sources: [{ type: "cron", namedGoalId: "daily-report", schedule: "0 9 * * 1-5" }]
      }),
      "utf8"
    );

    expect(() => loadAutomationConfig(configPath)).toThrow(/Unknown namedGoalId/i);
  });
});
