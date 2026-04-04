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
    expect(prompt).toContain('Use blocked only for unrecoverable failures');
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
});
