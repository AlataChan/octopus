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
      "@octopus/runtime-remote": resolve("packages/runtime-remote/src/index.ts"),
      "@octopus/adapter-mcp": resolve("packages/adapter-mcp/src/index.ts"),
      "@octopus/surfaces-chat": resolve("packages/surfaces-chat/src/index.ts"),
      "@octopus/surfaces-cli": resolve("packages/surfaces-cli/src/index.ts"),
      "@octopus/gateway": resolve("packages/gateway/src/index.ts"),
      "@octopus/eval-runner": resolve("packages/eval-runner/src/index.ts"),
      "@octopus/work-packs/browser": resolve("packages/work-packs/src/packs.ts"),
      "@octopus/work-packs": resolve("packages/work-packs/src/index.ts")
    }
  },
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
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
          name: "runtime-remote",
          include: ["packages/runtime-remote/src/**/*.test.ts"]
        }
      },
      {
        test: {
          name: "adapter-mcp",
          include: ["packages/adapter-mcp/src/**/*.test.ts"]
        }
      },
      {
        test: {
          name: "surfaces-chat",
          include: ["packages/surfaces-chat/src/**/*.test.ts"]
        }
      },
      {
        test: {
          name: "surfaces-cli",
          include: ["packages/surfaces-cli/src/**/*.test.ts"]
        }
      },
      {
        test: {
          name: "surfaces-web",
          include: ["packages/surfaces-web/src/**/*.test.ts", "packages/surfaces-web/src/**/*.test.tsx"],
          environment: "jsdom",
          testTimeout: 20_000,
          setupFiles: ["packages/surfaces-web/src/test/setup.ts"]
        }
      },
      {
        test: {
          name: "gateway",
          include: ["packages/gateway/**/*.test.ts"]
        }
      },
      {
        test: {
          name: "eval-runner",
          include: ["packages/eval-runner/src/**/*.test.ts"]
        }
      },
      {
        test: {
          name: "work-packs",
          include: ["packages/work-packs/src/**/*.test.ts"]
        }
      }
    ]
  }
});
