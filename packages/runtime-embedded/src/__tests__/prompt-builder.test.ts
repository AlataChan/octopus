import { describe, expect, it } from "vitest";

import { createWorkGoal, createWorkSession } from "@octopus/work-contracts";

import { buildTurnPrompt } from "../prompt-builder.js";

describe("buildTurnPrompt", () => {
  it("advertises mcp-call and lists MCP tools when context includes them", () => {
    const session = createWorkSession(createWorkGoal({ description: "Use MCP" }));

    const prompt = buildTurnPrompt({
      session,
      context: {
        workspaceSummary: "repo root",
        mcpTools: [
          {
            serverId: "filesystem",
            name: "read_file",
            description: "Read a file",
            inputSchema: { type: "object" }
          }
        ]
      },
      results: []
    });

    expect(prompt).toContain('type":"read|patch|shell|search|mcp-call"');
    expect(prompt).toContain("Available MCP tools");
    expect(prompt).toContain("filesystem/read_file: Read a file");
  });

  it("instructs the model to avoid premature completion and use clarification for human input", () => {
    const session = createWorkSession(createWorkGoal({ description: "Use MCP" }));

    const prompt = buildTurnPrompt({
      session,
      context: {
        workspaceSummary: "repo root"
      },
      results: []
    });

    expect(prompt).toContain("Use completion only when the goal is truly done");
    expect(prompt).toContain("take at least one tool action before considering completion");
    expect(prompt).toContain("Use clarification when you need a specific answer from the operator");
    expect(prompt).toContain("Use blocked only for unrecoverable failures");
  });

  it("documents the required params for each built-in action type", () => {
    const session = createWorkSession(createWorkGoal({ description: "Inspect repo" }));

    const prompt = buildTurnPrompt({
      session,
      context: {
        workspaceSummary: "repo root"
      },
      results: []
    });

    expect(prompt).toContain('read => {"path":"relative/path","encoding":"utf8?"}');
    expect(prompt).toContain('patch => {"path":"relative/path","content":"full file content"}');
    expect(prompt).toContain('search => {"query":"literal text"}');
    expect(prompt).toContain('shell => {"executable":"command","args":["..."],"timeoutMs":30000?}');
  });

  it("includes recent action history and warns against repeating successful identical actions", () => {
    const session = createWorkSession(createWorkGoal({ description: "Inspect repo" }));
    session.items.push({
      id: "item-1",
      sessionId: session.id,
      description: "Inspect repo",
      state: "active",
      observations: [],
      actions: [
        {
          id: "action-read-plan",
          type: "read",
          params: { path: "PLAN.md", encoding: "utf8" },
          createdAt: new Date("2026-04-04T09:00:00.000Z"),
          result: {
            success: true,
            output: "Plan contents",
            outcome: "completed"
          }
        }
      ],
      verifications: [],
      createdAt: new Date("2026-04-04T09:00:00.000Z")
    });

    const prompt = buildTurnPrompt({
      session,
      context: {
        workspaceSummary: "repo root"
      },
      results: [
        {
          success: true,
          output: "Plan contents",
          outcome: "completed"
        }
      ]
    });

    expect(prompt).toContain("Recent actions:");
    expect(prompt).toContain("read path=PLAN.md encoding=utf8 -> completed");
    expect(prompt).toContain("Do not repeat a successful action with identical params");
  });

  it("warns that existing workspace files may be stale for time-sensitive external data tasks", () => {
    const session = createWorkSession(
      createWorkGoal({
        description: "查找 GitHub 最近一周的热点项目，基于实时查询结果回答"
      }),
      {
        taskTitle: "查找github一周热点项目"
      }
    );
    session.goalSummary = "查找 GitHub 最近一周的热点项目，基于实时查询结果回答";

    const prompt = buildTurnPrompt({
      session,
      context: {
        workspaceSummary: "/workspace",
        visibleFiles: ["hot_repos_this_week.md", "PLAN.md"]
      },
      results: []
    });

    expect(prompt).toContain("Current time (UTC):");
    expect(prompt).toContain("Workspace files may come from prior sessions and can be stale.");
    expect(prompt).toContain(
      "For latest/current/recent/hot/trending or other time-sensitive external information, do not rely on existing workspace files alone."
    );
    expect(prompt).toContain("Verify freshness against the upstream source before completing.");
    expect(prompt).toContain(
      "Only treat external data as fresh if you fetched it or validated it against the upstream source during this session."
    );
    expect(prompt).toContain(
      "For scripted HTTP requests in shell actions, prefer node with fetch because node is available in the runtime container."
    );
    expect(prompt).toContain(
      "Do not wrap curl, wget, or python3 through node child_process when node can call fetch directly."
    );
    expect(prompt).toContain("Task title: 查找github一周热点项目");
    expect(prompt).toContain("Goal summary: 查找 GitHub 最近一周的热点项目，基于实时查询结果回答");
    expect(prompt).toContain(
      "Visible files: omitted for time-sensitive external-data tasks; consult upstream sources first"
    );
    expect(prompt).not.toContain("Visible files: hot_repos_this_week.md, PLAN.md");
  });

  it("truncates large tool outputs in prompt context to avoid oversized follow-up model calls", () => {
    const session = createWorkSession(createWorkGoal({ description: "Summarize live API output" }));
    const giantOutput = `${"A".repeat(5000)}${"B".repeat(5000)}`;
    session.items.push({
      id: "item-1",
      sessionId: session.id,
      description: "Summarize live API output",
      state: "active",
      observations: [],
      actions: [
        {
          id: "action-fetch-api",
          type: "shell",
          params: { executable: "node", args: ["-e", "fetch(...)"] },
          createdAt: new Date("2026-04-04T13:00:00.000Z"),
          result: {
            success: true,
            output: giantOutput,
            outcome: "completed"
          }
        }
      ],
      verifications: [],
      createdAt: new Date("2026-04-04T13:00:00.000Z")
    });

    const prompt = buildTurnPrompt({
      session,
      context: {
        workspaceSummary: "repo root"
      },
      results: [
        {
          success: true,
          output: giantOutput,
          outcome: "completed"
        }
      ]
    });

    expect(prompt).toContain("[truncated");
    expect(prompt).not.toContain(giantOutput);
    expect(prompt.length).toBeLessThan(4000);
  });
});
