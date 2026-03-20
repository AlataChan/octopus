import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import type { EvalCase, EvalResult, EvalRunnerDeps, WorkspaceFixture } from "./types.js";
import { evaluateAssertions } from "./scorer.js";

export interface EvalRunOptions {
  /** Suite-level default profile; per-case profile overrides this. */
  defaultProfile?: string;
}

export class EvalRunner {
  constructor(private readonly deps: EvalRunnerDeps) {}

  async runCase(evalCase: EvalCase, options: EvalRunOptions = {}): Promise<EvalResult> {
    const start = Date.now();
    const tempDir = await mkdtemp(join(tmpdir(), "octopus-eval-"));
    let app: Awaited<ReturnType<EvalRunnerDeps["createApp"]>> | undefined;

    try {
      if (evalCase.fixture) {
        await writeFixtureFiles(tempDir, evalCase.fixture);
      }

      const profile = evalCase.profile ?? options.defaultProfile ?? "vibe";
      app = await this.deps.createApp({
        workspaceRoot: tempDir,
        profile,
      });

      const goal = {
        id: randomUUID(),
        description: evalCase.goal.description,
        constraints: evalCase.goal.constraints ?? [],
        successCriteria: evalCase.goal.successCriteria ?? [],
        createdAt: new Date(),
        namedGoalId: evalCase.goal.namedGoalId,
      };

      const session = await app.engine.executeGoal(goal, {
        workspaceRoot: tempDir,
        maxIterations: 20,
      });

      await app.flushTraces();

      const assertions = await evaluateAssertions(evalCase.assertions, {
        workspaceRoot: tempDir,
        session,
      });

      return {
        caseId: evalCase.id,
        description: evalCase.description,
        passed: assertions.every((a) => a.passed),
        assertions,
        sessionId: session.id,
        durationMs: Date.now() - start,
      };
    } catch (error) {
      // Flush traces even on failure (cleanup MCP/trace draining)
      await app?.flushTraces().catch(() => {});
      return {
        caseId: evalCase.id,
        description: evalCase.description,
        passed: false,
        assertions: [],
        sessionId: "",
        durationMs: Date.now() - start,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  async runSuite(cases: EvalCase[], options: EvalRunOptions = {}): Promise<EvalResult[]> {
    const results: EvalResult[] = [];
    for (const evalCase of cases) {
      results.push(await this.runCase(evalCase, options));
    }
    return results;
  }
}

async function writeFixtureFiles(dir: string, fixture: WorkspaceFixture): Promise<void> {
  for (const [relativePath, content] of Object.entries(fixture.files)) {
    const fullPath = join(dir, relativePath);
    await mkdir(join(fullPath, ".."), { recursive: true });
    await writeFile(fullPath, content, "utf8");
  }
}
