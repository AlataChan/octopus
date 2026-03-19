import { fireEvent, render, screen } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";

import { SessionDetail } from "../components/SessionDetail.js";
import { makeApproval, makeEvent, makeWorkSession } from "./fixtures.js";

describe("SessionDetail", () => {
  it("renders blocked guidance, task-first overview, and artifact preview actions", () => {
    const onPreviewArtifact = vi.fn(async () => undefined);

    render(
      <SessionDetail
        session={makeWorkSession({
          state: "blocked",
          namedGoalId: "README 摘要",
          goalSummary: "读取 README.md 并整理要点",
          items: [
            {
              id: "item-1",
              sessionId: "session-1",
              description: "Use MCP",
              state: "active",
              observations: [],
              actions: [],
              verifications: [],
              createdAt: new Date("2026-03-19T15:42:36.000Z")
            }
          ],
          artifacts: [
            {
              id: "artifact-1",
              type: "document",
              path: "PLAN.md",
              description: "Plan document",
              createdAt: new Date("2026-03-19T15:42:36.000Z")
            },
            {
              id: "artifact-2",
              type: "dataset",
              path: "report.csv",
              description: "Dataset artifact",
              createdAt: new Date("2026-03-19T15:42:36.000Z")
            }
          ],
          transitions: [
            {
              from: "active",
              to: "blocked",
              reason: "Completion predicate failed.",
              triggerEvent: "session.blocked",
              timestamp: new Date("2026-03-19T15:42:36.000Z")
            }
          ]
        })}
        events={[makeEvent()]}
        approval={makeApproval()}
        busy={false}
        onControl={vi.fn(async () => undefined)}
        onPreviewArtifact={onPreviewArtifact}
        onResolveApproval={vi.fn(async () => undefined)}
      />
    );

    expect(screen.getByRole("heading", { name: "会话概览" })).toBeInTheDocument();
    expect(screen.getByText("README 摘要")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "阻塞原因" })).toBeInTheDocument();
    expect(screen.getByText("Completion predicate failed.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "待审批" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "最近活动" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "继续" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "预览 PLAN.md" }));

    expect(onPreviewArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "artifact-1",
        path: "PLAN.md"
      })
    );
    expect(screen.getByRole("button", { name: "不可预览" })).toBeDisabled();
  });
});
