import { fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeSessionSummary, makeStatus, makeWorkSession } from "./fixtures.js";

const { listSessions, getSession, getStatus, submitGoal, getArtifactContent, connectEventStream } = vi.hoisted(() => ({
  listSessions: vi.fn(),
  getSession: vi.fn(),
  getStatus: vi.fn(),
  submitGoal: vi.fn(),
  getArtifactContent: vi.fn(),
  connectEventStream: vi.fn(() => ({ detach: vi.fn() }))
}));

vi.mock("@octopus/work-packs/browser", () => ({
  loadBuiltinPacks: () => [],
  validateParams: () => {},
}));

vi.mock("../api/client.js", () => {
  class FakeGatewayClient {
    isAuthenticated() {
      return true;
    }

    async login() {}

    logout() {}

    listSessions = listSessions;
    getSession = getSession;
    getStatus = getStatus;
    submitGoal = submitGoal;
    getArtifactContent = getArtifactContent;
    connectEventStream = connectEventStream;

    async controlSession() {}

    async approvePrompt() {}
  }

  return { GatewayClient: FakeGatewayClient };
});

import { App } from "../App.js";

describe("App dashboard shell", () => {
  beforeEach(() => {
    window.localStorage.clear();
    listSessions.mockReset();
    getSession.mockReset();
    getStatus.mockReset();
    submitGoal.mockReset();
    getArtifactContent.mockReset();

    listSessions.mockResolvedValue([
      makeSessionSummary({ id: "session-1", state: "active", namedGoalId: "README 摘要", goalSummary: "读取 README.md 并整理要点" }),
      makeSessionSummary({ id: "session-2", state: "blocked" }),
      makeSessionSummary({ id: "session-3", state: "completed" })
    ]);
    getSession.mockResolvedValue(makeWorkSession({
      id: "session-1",
      state: "blocked",
      namedGoalId: "README 摘要",
      goalSummary: "读取 README.md 并整理要点",
      artifacts: [
        {
          id: "artifact-1",
          type: "document",
          path: "PLAN.md",
          description: "Current plan",
          createdAt: new Date("2026-03-19T15:42:36.000Z")
        }
      ]
    }));
    getStatus.mockResolvedValue(makeStatus());
    submitGoal.mockResolvedValue({
      sessionId: "session-new",
      goalId: "goal-new",
      state: "active"
    });
    getArtifactContent.mockResolvedValue({
      path: "PLAN.md",
      type: "document",
      contentType: "text/markdown; charset=utf-8",
      content: "# PLAN"
    });
  });

  it("defaults to Chinese and allows switching to English", async () => {
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Octopus八爪鱼" })).toBeInTheDocument();
    expect(await screen.findByText("全部会话")).toBeInTheDocument();
    const totalCard = screen.getByText("全部会话").closest("article");
    expect(totalCard).not.toBeNull();
    expect(within(totalCard as HTMLElement).getByText("3")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "状态" }));

    expect(await screen.findByText("网关状态")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "EN" }));

    expect(await screen.findByText("Total Sessions")).toBeInTheDocument();
    expect(window.localStorage.getItem("octopus.locale")).toBe("en-US");
  });

  it("shows task guidance and submits a new task from the browser", async () => {
    listSessions
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        makeSessionSummary({
          id: "session-new",
          goalId: "goal-new",
          namedGoalId: "README 摘要",
          goalSummary: "读取 README.md 并写出 5 条中文要点",
          state: "active"
        })
      ]);
    getSession.mockResolvedValueOnce(makeWorkSession({
      id: "session-new",
      goalId: "goal-new",
      namedGoalId: "README 摘要",
      goalSummary: "读取 README.md 并写出 5 条中文要点",
      state: "active"
    }));

    render(<App />);

    expect(await screen.findByRole("heading", { name: "新建任务" })).toBeInTheDocument();
    expect(screen.getByText("示例任务")).toBeInTheDocument();

    fireEvent.input(screen.getByLabelText("任务标题（可选）"), {
      target: { value: "README 摘要" }
    });
    fireEvent.input(screen.getByLabelText("任务说明"), {
      target: { value: "读取 README.md，并在 docs/trial-summary.md 中写出 5 条中文要点。" }
    });
    fireEvent.submit(screen.getByRole("button", { name: "提交任务" }).closest("form") as HTMLFormElement);

    await waitFor(() => {
      expect(submitGoal).toHaveBeenCalledWith({
        description: "读取 README.md，并在 docs/trial-summary.md 中写出 5 条中文要点。",
        namedGoalId: "README 摘要"
      });
    });
    await waitFor(() => {
      expect(listSessions).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(getSession).toHaveBeenCalledWith("session-new");
    });
  });

  it("opens artifact preview in a modal", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "预览 PLAN.md" }));

    await waitFor(() => {
      expect(getArtifactContent).toHaveBeenCalledWith("session-1", "PLAN.md");
    });
    expect(await screen.findByRole("dialog", { name: "PLAN.md" })).toBeInTheDocument();
    expect(await screen.findByText("# PLAN")).toBeInTheDocument();
  });
});
