import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { loadEvalSuite, validateEvalCase } from "../loader.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function createTempSuite(cases: Record<string, unknown>[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "octopus-eval-test-"));
  tempDirs.push(dir);
  for (let i = 0; i < cases.length; i++) {
    await writeFile(join(dir, `case-${i}.json`), JSON.stringify(cases[i]), "utf8");
  }
  return dir;
}

describe("loadEvalSuite", () => {
  it("loads all .json files from a directory", async () => {
    const dir = await createTempSuite([
      { id: "a", description: "Test A", goal: { description: "Do A" }, assertions: [{ type: "session-completed" }] },
      { id: "b", description: "Test B", goal: { description: "Do B" }, assertions: [{ type: "session-completed" }] },
    ]);
    const cases = await loadEvalSuite(dir);
    expect(cases).toHaveLength(2);
  });

  it("skips non-json files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "octopus-eval-test-"));
    tempDirs.push(dir);
    await writeFile(join(dir, "case.json"), JSON.stringify({ id: "a", description: "A", goal: { description: "Do" }, assertions: [{ type: "session-completed" }] }), "utf8");
    await writeFile(join(dir, "readme.md"), "# not a case", "utf8");
    const cases = await loadEvalSuite(dir);
    expect(cases).toHaveLength(1);
  });

  it("returns empty array for empty directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "octopus-eval-test-"));
    tempDirs.push(dir);
    expect(await loadEvalSuite(dir)).toEqual([]);
  });

  it("throws on malformed JSON (fail-closed)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "octopus-eval-test-"));
    tempDirs.push(dir);
    await writeFile(join(dir, "bad.json"), "not json", "utf8");
    await expect(loadEvalSuite(dir)).rejects.toThrow();
  });
});

describe("validateEvalCase", () => {
  it("rejects missing id", () => {
    expect(() => validateEvalCase({ description: "x", goal: { description: "y" }, assertions: [{ type: "session-completed" }] }, "test")).toThrow("id");
  });

  it("rejects missing goal", () => {
    expect(() => validateEvalCase({ id: "x", description: "x", assertions: [{ type: "session-completed" }] }, "test")).toThrow("goal");
  });

  it("rejects empty assertions", () => {
    expect(() => validateEvalCase({ id: "x", description: "x", goal: { description: "y" }, assertions: [] }, "test")).toThrow("assertions");
  });

  it("rejects invalid assertion type", () => {
    expect(() => validateEvalCase({ id: "x", description: "x", goal: { description: "y" }, assertions: [{ type: "bogus" }] }, "test")).toThrow("bogus");
  });

  it("rejects fixture path with ..", () => {
    expect(() => validateEvalCase({
      id: "x", description: "x", goal: { description: "y" },
      assertions: [{ type: "session-completed" }],
      fixture: { files: { "../etc/passwd": "evil" } }
    }, "test")).toThrow("not allowed");
  });

  it("rejects absolute fixture path", () => {
    expect(() => validateEvalCase({
      id: "x", description: "x", goal: { description: "y" },
      assertions: [{ type: "session-completed" }],
      fixture: { files: { "/etc/passwd": "evil" } }
    }, "test")).toThrow("not allowed");
  });

  it("passes valid case", () => {
    const result = validateEvalCase({
      id: "test-1", description: "Test case", goal: { description: "Do stuff" },
      assertions: [{ type: "file-exists", path: "output.txt" }],
      fixture: { files: { "input.txt": "hello" } }
    }, "test");
    expect(result.id).toBe("test-1");
  });
});
