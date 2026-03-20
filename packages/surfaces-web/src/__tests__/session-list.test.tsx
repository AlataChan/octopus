import { fireEvent, render, screen } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";

import { SessionList } from "../components/SessionList.js";
import { makeSessionSummary } from "./fixtures.js";

describe("SessionList", () => {
  it("renders task-first labels and keeps selection behavior", () => {
    const onSelect = vi.fn();
    const onRefresh = vi.fn(async () => undefined);

    render(
      <SessionList
        sessions={[
          makeSessionSummary({
            id: "session-alpha-1234567890",
            goalId: "goal-alpha",
            namedGoalId: "README 摘要",
            goalSummary: "读取 README.md 并整理成中文要点",
            state: "blocked"
          }),
          makeSessionSummary({
            id: "session-beta-1234567890",
            goalId: "goal-beta",
            goalSummary: "检查 gateway 路由中的 TODO 项",
            state: "active"
          }),
          makeSessionSummary({
            id: "1c8e1f53-e3f6-4af3-801b-701096894cca",
            goalId: "legacy-goal-label",
            state: "active"
          })
        ]}
        selectedSessionId="session-alpha-1234567890"
        onSelect={onSelect}
        onRefresh={onRefresh}
      />
    );

    expect(screen.getByText("README 摘要")).toBeInTheDocument();
    expect(screen.getByText("读取 README.md 并整理成中文要点")).toBeInTheDocument();
    expect(screen.getByText("session-alpha-1234567890")).toBeInTheDocument();
    expect(screen.getByText("检查 gateway 路由中的 TODO 项")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "legacy-goal-label" })).toBeInTheDocument();
    expect(screen.getByText("已阻塞")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "README 摘要" }));

    expect(onSelect).toHaveBeenCalledWith("session-alpha-1234567890");
  });
});
