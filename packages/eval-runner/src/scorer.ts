import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { WorkSession } from "@octopus/work-contracts";

import type { AssertionResult, EvalAssertion } from "./types.js";

function resolveAssertionPath(workspaceRoot: string, relativePath: string): string {
  const resolved = resolve(workspaceRoot, relativePath);
  if (!resolved.startsWith(resolve(workspaceRoot))) {
    throw new Error(`Assertion path "${relativePath}" escapes workspace root`);
  }
  return resolved;
}

export async function evaluateAssertions(
  assertions: EvalAssertion[],
  context: { workspaceRoot: string; session: WorkSession }
): Promise<AssertionResult[]> {
  const results: AssertionResult[] = [];
  for (const assertion of assertions) {
    results.push(await evaluateOne(assertion, context));
  }
  return results;
}

async function evaluateOne(
  assertion: EvalAssertion,
  context: { workspaceRoot: string; session: WorkSession }
): Promise<AssertionResult> {
  switch (assertion.type) {
    case "file-exists":
      return evaluateFileExists(assertion, context.workspaceRoot);
    case "file-contains":
      return evaluateFileContains(assertion, context.workspaceRoot);
    case "file-matches":
      return evaluateFileMatches(assertion, context.workspaceRoot);
    case "shell-passes":
      return evaluateShellPasses(assertion, context.workspaceRoot);
    case "session-completed":
      return evaluateSessionCompleted(context.session);
    case "no-blocked":
      return evaluateNoBlocked(context.session);
    case "artifact-count":
      return evaluateArtifactCount(assertion, context.session);
  }
}

function evaluateFileExists(
  assertion: Extract<EvalAssertion, { type: "file-exists" }>,
  workspaceRoot: string
): AssertionResult {
  const fullPath = resolveAssertionPath(workspaceRoot, assertion.path);
  const exists = existsSync(fullPath);
  return {
    assertion,
    passed: exists,
    detail: exists ? `File exists: ${assertion.path}` : `File not found: ${assertion.path}`,
  };
}

async function evaluateFileContains(
  assertion: Extract<EvalAssertion, { type: "file-contains" }>,
  workspaceRoot: string
): Promise<AssertionResult> {
  const fullPath = resolveAssertionPath(workspaceRoot, assertion.path);
  try {
    const content = await readFile(fullPath, "utf8");
    const found = content.includes(assertion.pattern);
    return {
      assertion,
      passed: found,
      detail: found
        ? `File "${assertion.path}" contains pattern`
        : `File "${assertion.path}" does not contain "${assertion.pattern}"`,
    };
  } catch {
    return { assertion, passed: false, detail: `File not readable: ${assertion.path}` };
  }
}

async function evaluateFileMatches(
  assertion: Extract<EvalAssertion, { type: "file-matches" }>,
  workspaceRoot: string
): Promise<AssertionResult> {
  const fullPath = resolveAssertionPath(workspaceRoot, assertion.path);
  try {
    const content = await readFile(fullPath, "utf8");
    const matches = content === assertion.expected;
    return {
      assertion,
      passed: matches,
      detail: matches ? `File "${assertion.path}" matches expected` : `File "${assertion.path}" does not match expected`,
    };
  } catch {
    return { assertion, passed: false, detail: `File not readable: ${assertion.path}` };
  }
}

async function evaluateShellPasses(
  assertion: Extract<EvalAssertion, { type: "shell-passes" }>,
  workspaceRoot: string
): Promise<AssertionResult> {
  return new Promise<AssertionResult>((resolve) => {
    // Security: direct exec (no shell interpolation), cwd locked to workspace
    execFile(
      assertion.command,
      assertion.args ?? [],
      { cwd: workspaceRoot, timeout: 30_000 },
      (error) => {
        if (error) {
          resolve({
            assertion,
            passed: false,
            detail: `Command failed: ${assertion.command} (${error.message})`,
          });
        } else {
          resolve({
            assertion,
            passed: true,
            detail: `Command passed: ${assertion.command}`,
          });
        }
      }
    );
  });
}

function evaluateSessionCompleted(session: WorkSession): AssertionResult {
  const passed = session.state === "completed";
  return {
    assertion: { type: "session-completed" },
    passed,
    detail: passed ? "Session completed" : `Session state: ${session.state}`,
  };
}

function evaluateNoBlocked(session: WorkSession): AssertionResult {
  const wasBlocked = session.transitions.some((t) => t.to === "blocked");
  return {
    assertion: { type: "no-blocked" },
    passed: !wasBlocked,
    detail: wasBlocked ? "Session was blocked during execution" : "No blocked state encountered",
  };
}

function evaluateArtifactCount(
  assertion: Extract<EvalAssertion, { type: "artifact-count" }>,
  session: WorkSession
): AssertionResult {
  const count = session.artifacts.length;
  const passed = count >= assertion.min;
  return {
    assertion,
    passed,
    detail: passed
      ? `Artifact count ${count} >= ${assertion.min}`
      : `Artifact count ${count} < ${assertion.min}`,
  };
}
