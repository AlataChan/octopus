import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@octopus/work-contracts": resolve("packages/work-contracts/src/index.ts"),
      "@octopus/observability": resolve("packages/observability/src/index.ts"),
      "@octopus/agent-runtime": resolve("packages/agent-runtime/src/index.ts"),
      "@octopus/exec-substrate": resolve("packages/exec-substrate/src/index.ts"),
      "@octopus/state-store": resolve("packages/state-store/src/index.ts"),
      "@octopus/security": resolve("packages/security/src/index.ts"),
      "@octopus/work-core": resolve("packages/work-core/src/index.ts"),
      "@octopus/automation": resolve("packages/automation/src/index.ts"),
      "@octopus/runtime-embedded": resolve("packages/runtime-embedded/src/index.ts"),
      "@octopus/surfaces-cli": resolve("packages/surfaces-cli/src/index.ts")
    }
  },
  test: {
    projects: [
      {
        test: {
          name: "work-contracts",
          include: ["packages/work-contracts/src/**/*.test.ts"]
        }
      },
      {
        test: {
          name: "observability",
          include: ["packages/observability/src/**/*.test.ts"]
        }
      },
      {
        test: {
          name: "agent-runtime",
          include: ["packages/agent-runtime/src/**/*.test.ts"]
        }
      },
      {
        test: {
          name: "exec-substrate",
          include: ["packages/exec-substrate/src/**/*.test.ts"]
        }
      },
      {
        test: {
          name: "state-store",
          include: ["packages/state-store/src/**/*.test.ts"]
        }
      },
      {
        test: {
          name: "security",
          include: ["packages/security/src/**/*.test.ts"]
        }
      },
      {
        test: {
          name: "work-core",
          include: ["packages/work-core/src/**/*.test.ts"]
        }
      },
      {
        test: {
          name: "runtime-embedded",
          include: ["packages/runtime-embedded/src/**/*.test.ts"]
        }
      },
      {
        test: {
          name: "automation",
          include: ["packages/automation/src/**/*.test.ts"]
        }
      },
      {
        test: {
          name: "surfaces-cli",
          include: ["packages/surfaces-cli/src/**/*.test.ts"]
        }
      }
    ]
  }
});
