import { fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeSessionSummary, makeStatus, makeWorkSession } from "./fixtures.js";

const {
  listSessions,
  getSession,
  listSnapshots,
  getStatus,
  getSetupStatus,
  validateSetupToken,
  validateRuntime,
  initialize,
  submitGoal,
  getArtifactContent,
  connectEventStream,
  login,
  logout,
  rollbackSession,
  UnauthorizedError,
  authState
} = vi.hoisted(() => ({
  listSessions: vi.fn(),
  getSession: vi.fn(),
  listSnapshots: vi.fn(),
  getStatus: vi.fn(),
  getSetupStatus: vi.fn(),
  validateSetupToken: vi.fn(),
  validateRuntime: vi.fn(),
  initialize: vi.fn(),
  submitGoal: vi.fn(),
  getArtifactContent: vi.fn(),
  connectEventStream: vi.fn(() => ({ detach: vi.fn() })),
  login: vi.fn(async (username: string) => {
    authState.authenticated = true;
    return {
      token: "token-1",
      expiresAt: "2026-04-02T10:00:00.000Z",
      role: "operator" as const,
      username
    };
  }),
  logout: vi.fn(async () => {
    authState.authenticated = false;
  }),
  rollbackSession: vi.fn(),
  UnauthorizedError: class UnauthorizedError extends Error {
    constructor(message = "Authentication required.") {
      super(message);
      this.name = "UnauthorizedError";
    }
  },
  authState: {
    authenticated: true
  }
}));

vi.mock("@octopus/work-packs/browser", () => ({
  loadBuiltinPacks: () => [],
  validateParams: () => {},
}));

vi.mock("../api/client.js", () => {
  class FakeGatewayClient {
    getAuthSession() {
      return authState.authenticated
        ? {
            token: "token-1",
            expiresAt: "2026-04-02T10:00:00.000Z",
            role: "operator" as const,
            username: "ops1"
          }
        : null;
    }

    isAuthenticated() {
      return authState.authenticated;
    }

    clearAuthSession() {
      authState.authenticated = false;
    }

    login = login;

    logout = logout;

    listSessions = listSessions;
    getSession = getSession;
    listSnapshots = listSnapshots;
    getStatus = getStatus;
    getSetupStatus = getSetupStatus;
    validateSetupToken = validateSetupToken;
    validateRuntime = validateRuntime;
    initialize = initialize;
    submitGoal = submitGoal;
    getArtifactContent = getArtifactContent;
    rollbackSession = rollbackSession;
    connectEventStream = connectEventStream;

    async controlSession() {}

    async approvePrompt() {}
  }

  return { GatewayClient: FakeGatewayClient, UnauthorizedError };
});

import { App } from "../App.js";

describe("App dashboard shell", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    authState.authenticated = true;
    listSessions.mockReset();
    getSession.mockReset();
    getStatus.mockReset();
    getSetupStatus.mockReset();
    validateSetupToken.mockReset();
    validateRuntime.mockReset();
    initialize.mockReset();
    submitGoal.mockReset();
    getArtifactContent.mockReset();
    listSnapshots.mockReset();
    rollbackSession.mockReset();
    login.mockClear();
    logout.mockClear();

    listSessions.mockResolvedValue([
      makeSessionSummary({ id: "session-1", state: "active", namedGoalId: "README 摘要", goalSummary: "读取 README.md 并整理要点" }),
      makeSessionSummary({ id: "session-2", state: "blocked" }),
      makeSessionSummary({ id: "session-3", state: "completed" })
    ]);
    getSetupStatus.mockResolvedValue({
      initialized: true,
      workspaceWritable: true
    });
    validateSetupToken.mockResolvedValue({ valid: true });
    validateRuntime.mockResolvedValue({
      valid: true,
      latencyMs: 120
    });
    initialize.mockResolvedValue({
      initialized: true
    });
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
    listSnapshots.mockResolvedValue([]);
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

  it("shows the setup wizard before login when the gateway is not initialized", async () => {
    authState.authenticated = false;
    getSetupStatus.mockResolvedValue({
      initialized: false,
      workspaceWritable: true
    });

    render(<App />);

    expect(await screen.findByRole("heading", { name: "验证设置令牌" })).toBeInTheDocument();
    expect(screen.queryByLabelText("用户名")).not.toBeInTheDocument();
    expect(listSessions).not.toHaveBeenCalled();
  }, 30_000);

  it("shows a retry panel when the setup status request fails", async () => {
    authState.authenticated = false;
    getSetupStatus
      .mockRejectedValueOnce(new Error("Gateway request failed."))
      .mockResolvedValueOnce({
        initialized: false,
        workspaceWritable: true
      });

    render(<App />);

    expect(await screen.findByRole("heading", { name: "无法连接网关" })).toBeInTheDocument();
    expect(screen.getByText("网关请求失败。")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    expect(await screen.findByRole("heading", { name: "验证设置令牌" })).toBeInTheDocument();
    expect(getSetupStatus).toHaveBeenCalledTimes(2);
  }, 30_000);

  it("completes the setup wizard and returns to login after initialization", async () => {
    authState.authenticated = false;
    getSetupStatus.mockResolvedValue({
      initialized: false,
      workspaceWritable: true
    });

    render(<App />);

    fireEvent.input(await screen.findByLabelText("设置令牌"), {
      target: { value: "setup-token-1" }
    });
    fireEvent.submit(screen.getByRole("button", { name: "验证令牌" }).closest("form") as HTMLFormElement);

    await waitFor(() => {
      expect(validateSetupToken).toHaveBeenCalledWith("setup-token-1");
    });

    fireEvent.input(await screen.findByLabelText("模型 ID"), {
      target: { value: "gpt-4.1-mini" }
    });
    fireEvent.input(screen.getByLabelText("模型 API Key"), {
      target: { value: "sk-test" }
    });
    fireEvent.input(screen.getByLabelText("兼容接口 Base URL"), {
      target: { value: "https://example.test/v1" }
    });
    fireEvent.submit(screen.getByRole("button", { name: "验证运行时" }).closest("form") as HTMLFormElement);

    await waitFor(() => {
      expect(validateRuntime).toHaveBeenCalledWith("setup-token-1", {
        provider: "openai-compatible",
        model: "gpt-4.1-mini",
        apiKey: "sk-test",
        baseUrl: "https://example.test/v1"
      });
    });

    fireEvent.input(await screen.findByLabelText("管理员用户名"), {
      target: { value: "ops-admin" }
    });
    fireEvent.input(screen.getByLabelText("管理员密码"), {
      target: { value: "super-secret" }
    });
    fireEvent.input(screen.getByLabelText("确认密码"), {
      target: { value: "super-secret" }
    });
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));

    fireEvent.input(await screen.findByLabelText("附加账号用户名"), {
      target: { value: "viewer-1" }
    });
    fireEvent.input(screen.getByLabelText("附加账号密码"), {
      target: { value: "viewer-secret" }
    });
    fireEvent.change(screen.getByLabelText("附加账号角色"), {
      target: { value: "viewer" }
    });
    fireEvent.click(screen.getByRole("button", { name: "添加账号" }));

    expect(await screen.findByText("viewer-1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "下一步" }));

    expect(await screen.findByRole("heading", { name: "检查初始化配置" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "完成初始化" }));

    await waitFor(() => {
      expect(initialize).toHaveBeenCalledWith("setup-token-1", {
        runtime: {
          provider: "openai-compatible",
          model: "gpt-4.1-mini",
          apiKey: "sk-test",
          baseUrl: "https://example.test/v1"
        },
        admin: {
          username: "ops-admin",
          password: "super-secret"
        },
        additionalUsers: [
          {
            username: "viewer-1",
            password: "viewer-secret",
            role: "viewer"
          }
        ]
      });
    });

    expect(await screen.findByRole("heading", { name: "初始化完成" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "前往登录" }));

    expect(await screen.findByLabelText("用户名")).toBeInTheDocument();
  }, 30_000);

  it("blocks the admin step until password confirmation matches", async () => {
    authState.authenticated = false;
    getSetupStatus.mockResolvedValue({
      initialized: false,
      workspaceWritable: true
    });

    render(<App />);

    fireEvent.input(await screen.findByLabelText("设置令牌"), {
      target: { value: "setup-token-1" }
    });
    fireEvent.submit(screen.getByRole("button", { name: "验证令牌" }).closest("form") as HTMLFormElement);

    fireEvent.input(await screen.findByLabelText("模型 ID"), {
      target: { value: "gpt-4.1-mini" }
    });
    fireEvent.input(screen.getByLabelText("模型 API Key"), {
      target: { value: "sk-test" }
    });
    fireEvent.submit(screen.getByRole("button", { name: "验证运行时" }).closest("form") as HTMLFormElement);

    expect(await screen.findByRole("heading", { name: "创建管理员账号" })).toBeInTheDocument();

    fireEvent.input(screen.getByLabelText("管理员用户名"), {
      target: { value: "ops-admin" }
    });
    fireEvent.input(screen.getByLabelText("管理员密码"), {
      target: { value: "super-secret" }
    });
    fireEvent.input(screen.getByLabelText("确认密码"), {
      target: { value: "different-secret" }
    });

    expect(screen.getByText("两次输入的密码不一致。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下一步" })).toBeDisabled();
  }, 30_000);

  it("defaults to Chinese and allows switching to English", async () => {
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Octopus八爪鱼" })).toBeInTheDocument();
    expect(await screen.findByText("全部会话")).toBeInTheDocument();
    const totalCard = screen.getByText("全部会话").closest("article");
    expect(totalCard).not.toBeNull();
    await waitFor(() => {
      expect(within(totalCard as HTMLElement).getByText("3")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "状态" }));

    expect(await screen.findByText("网关状态")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "EN" }));

    expect(await screen.findByText("Total Sessions")).toBeInTheDocument();
    expect(window.localStorage.getItem("octopus.locale")).toBe("en-US");
  }, 30_000);

  it("signs in with username and password before loading the dashboard", async () => {
    authState.authenticated = false;

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Octopus八爪鱼" })).toBeInTheDocument();
    expect(screen.getByLabelText("用户名")).toBeInTheDocument();
    expect(screen.getByLabelText("密码")).toBeInTheDocument();

    fireEvent.input(screen.getByLabelText("用户名"), {
      target: { value: "ops1" }
    });
    fireEvent.input(screen.getByLabelText("密码"), {
      target: { value: "octopus-ops" }
    });
    fireEvent.submit(screen.getByRole("button", { name: "登录" }).closest("form") as HTMLFormElement);

    await waitFor(() => {
      expect(login).toHaveBeenCalledWith("ops1", "octopus-ops");
    });
    await waitFor(() => {
      expect(listSessions).toHaveBeenCalled();
    });
  }, 30_000);

  it("returns to the login form when the stored browser session is no longer authorized", async () => {
    listSessions.mockRejectedValueOnce(new UnauthorizedError("Authentication required."));

    render(<App />);

    expect(await screen.findByLabelText("用户名")).toBeInTheDocument();
    expect(authState.authenticated).toBe(false);
  }, 30_000);

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
        taskTitle: "README 摘要"
      });
    });
    await waitFor(() => {
      expect(listSessions).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(getSession).toHaveBeenCalledWith("session-new");
    });
  }, 30_000);

  it("opens artifact preview in a modal", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "预览 PLAN.md" }));

    await waitFor(() => {
      expect(getArtifactContent).toHaveBeenCalledWith("session-1", "PLAN.md");
    });
    expect(await screen.findByRole("dialog", { name: "PLAN.md" })).toBeInTheDocument();
    expect(await screen.findByText("# PLAN")).toBeInTheDocument();
  }, 30_000);
});
