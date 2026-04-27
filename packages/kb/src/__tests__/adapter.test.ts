import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

import { EventBus, type WorkEvent } from "@octopus/observability";
import { describe, expect, it } from "vitest";

import { createSubprocessKbPort } from "../adapter.js";

describe("createSubprocessKbPort", () => {
  it("spawns real subcommands and emits hashes from explicit command inputs", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const spawn = (command: string, args: readonly string[]) => {
      calls.push({ command, args: [...args] });
      return fakeChild(responseFor(command, [...args]));
    };
    const events: WorkEvent[] = [];
    const eventBus = new EventBus();
    eventBus.onAny((event) => events.push(event));
    const port = createSubprocessKbPort({
      spawn,
      eventBus,
      traceContext: { sessionId: "session-1", goalId: "goal-1" },
    });

    await port.lookup({ term: "RAG Ops", vaultPath: "/vault" });
    await port.retrieveBundle({ query: "RAG Ops", vaultPath: "/vault", maxTokens: 123 });
    await port.neighbors({ pagePath: "wiki/concepts/RAG.md", vaultPath: "/vault" });
    await port.impactedPages({ pagePath: "wiki/concepts/RAG.md", vaultPath: "/vault" });

    expect(calls.filter((call) => call.command === "octopus-kb").map((call) => call.args)).toEqual([
      ["lookup", "RAG Ops", "--vault", "/vault", "--json"],
      ["retrieve-bundle", "RAG Ops", "--vault", "/vault", "--json", "--max-tokens", "123"],
      ["neighbors", "wiki/concepts/RAG.md", "--vault", "/vault", "--json"],
      ["impacted-pages", "wiki/concepts/RAG.md", "--vault", "/vault", "--json"],
    ]);

    const started = events.filter((event) => event.type === "kb.adapter.call.started");
    expect(started.map((event) => event.payload)).toEqual([
      { command: "lookup", vaultPathHash: sha256("/vault"), queryHash: sha256("RAG Ops") },
      { command: "retrieve-bundle", vaultPathHash: sha256("/vault"), queryHash: sha256("RAG Ops") },
      { command: "neighbors", vaultPathHash: sha256("/vault"), queryHash: sha256("wiki/concepts/RAG.md") },
      { command: "impacted-pages", vaultPathHash: sha256("/vault"), queryHash: sha256("wiki/concepts/RAG.md") },
    ]);
  });

  it("coalesces concurrent version probes", async () => {
    let pythonProbeCount = 0;
    const spawn = (command: string, args: readonly string[]) => {
      if (command === "python3") {
        pythonProbeCount += 1;
        return fakeChild("Name: octopus-kb\nVersion: 0.6.0\n", 5);
      }
      return fakeChild(responseFor(command, [...args]));
    };
    const port = createSubprocessKbPort({ spawn });

    await Promise.all([
      port.lookup({ term: "RAG Ops", vaultPath: "/vault" }),
      port.retrieveBundle({ query: "RAG Ops", vaultPath: "/vault" }),
    ]);

    expect(pythonProbeCount).toBe(1);
  });
});

function responseFor(command: string, args: string[]): string {
  if (command === "python3") {
    return "Name: octopus-kb\nVersion: 0.6.0\n";
  }
  switch (args[0]) {
    case "lookup":
      return JSON.stringify({
        term: "RAG Ops",
        canonical: null,
        aliases: [],
        ambiguous: false,
        collisions: [],
        next: [],
      });
    case "retrieve-bundle":
      return JSON.stringify({
        query: "RAG Ops",
        bundle: {
          schema: [],
          index: [],
          concepts: [],
          entities: [],
          raw_sources: [],
        },
        warnings: [],
        token_estimate: 0,
        next: [],
      });
    case "neighbors":
      return JSON.stringify({
        page: "wiki/concepts/RAG.md",
        inbound: [],
        outbound: [],
        aliases: [],
        canonical_identity: null,
        next: [],
      });
    case "impacted-pages":
      return JSON.stringify({
        page: "wiki/concepts/RAG.md",
        impacted: [],
        next: [],
      });
    default:
      return "";
  }
}

function fakeChild(stdout: string, delayMs = 0): ChildProcessWithoutNullStreams {
  const child = new EventEmitter() as ChildProcessWithoutNullStreams;
  const stdoutStream = new PassThrough();
  const stderrStream = new PassThrough();
  child.stdout = stdoutStream;
  child.stderr = stderrStream;
  child.kill = () => true;
  const complete = () => {
    stdoutStream.write(stdout);
    stdoutStream.end();
    stderrStream.end();
    child.emit("close", 0);
  };
  if (delayMs > 0) {
    setTimeout(complete, delayMs);
  } else {
    queueMicrotask(complete);
  }
  return child;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
