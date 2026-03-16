import { describe, expect, it } from "vitest";

import { classifyShellRisk, createShellApprovalKey } from "../classifier.js";

describe("classifyShellRisk", () => {
  it("marks destructive executables as dangerous", () => {
    expect(classifyShellRisk("rm", ["-rf", "/tmp/demo"])).toBe("dangerous");
  });

  it("marks known readonly commands as safe", () => {
    expect(classifyShellRisk("rg", ["TODO", "src"])).toBe("safe");
  });

  it("marks unknown executables as consequential", () => {
    expect(classifyShellRisk("python3", ["script.py"])).toBe("consequential");
  });

  it("treats absolute path args as consequential at minimum", () => {
    expect(classifyShellRisk("git", ["status", "/tmp/other-repo"])).toBe("consequential");
  });

  it("creates stable approval keys", () => {
    expect(createShellApprovalKey("git", ["status"])).toBe("shell:git status");
  });
});

