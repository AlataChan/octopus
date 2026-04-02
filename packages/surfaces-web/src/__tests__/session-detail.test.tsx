import { fireEvent, render, screen, within } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";

import { SessionDetail } from "../components/SessionDetail.js";
import { makeApproval, makeEvent, makeWorkSession } from "./fixtures.js";

describe("SessionDetail", () => {
  it("renders blocked guidance, task-first overview, and artifact preview actions", () => {
    const onPreviewArtifact = vi.fn(async () => undefined);
    const onControl = vi.fn(async () => undefined);

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
        onControl={onControl}
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
    expect(screen.getByRole("button", { name: "恢复" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "预览 PLAN.md" }));
    fireEvent.click(screen.getByRole("button", { name: "恢复" }));

    expect(onPreviewArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "artifact-1",
        path: "PLAN.md"
      })
    );
    expect(onControl).toHaveBeenCalledWith("resume");
    expect(screen.getByRole("button", { name: "不可预览" })).toBeDisabled();
  }, 30_000);

  it("renders ClarificationDialog when blocked with clarification-required and onClarify is provided", () => {
    const onClarify = vi.fn();

    render(
      <SessionDetail
        session={makeWorkSession({
          state: "blocked",
          blockedReason: { kind: "clarification-required", question: "Which directory should I use?" },
          transitions: [
            {
              from: "active",
              to: "blocked",
              reason: "Needs clarification",
              triggerEvent: "session.blocked",
              timestamp: new Date("2026-03-19T15:42:36.000Z")
            }
          ]
        })}
        events={[makeEvent()]}
        approval={null}
        busy={false}
        onControl={vi.fn(async () => undefined)}
        onPreviewArtifact={vi.fn(async () => undefined)}
        onResolveApproval={vi.fn(async () => undefined)}
        onClarify={onClarify}
      />
    );

    expect(screen.getByText("Which directory should I use?")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "需要人工补充" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "提交说明" })).toBeDisabled();

    fireEvent.input(screen.getByPlaceholderText("请补充你的说明..."), {
      target: { value: "Use /tmp" }
    });
    fireEvent.click(screen.getByRole("button", { name: "提交说明" }));

    expect(onClarify).toHaveBeenCalledWith("Use /tmp");
  });

  it("renders approval hint when blocked with approval-required", () => {
    render(
      <SessionDetail
        session={makeWorkSession({
          state: "blocked",
          blockedReason: { kind: "approval-required", riskLevel: "dangerous" },
          transitions: [
            {
              from: "active",
              to: "blocked",
              reason: "Requires approval",
              triggerEvent: "session.blocked",
              timestamp: new Date("2026-03-19T15:42:36.000Z")
            }
          ]
        })}
        events={[makeEvent()]}
        approval={makeApproval()}
        busy={false}
        onControl={vi.fn(async () => undefined)}
        onPreviewArtifact={vi.fn(async () => undefined)}
        onResolveApproval={vi.fn(async () => undefined)}
      />
    );

    expect(screen.getByText("Octopus 正在等待你的审批决定。")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "需要人工补充" })).not.toBeInTheDocument();
  });

  it("does not render ClarificationDialog when onClarify is not provided even if kind is clarification-required", () => {
    render(
      <SessionDetail
        session={makeWorkSession({
          state: "blocked",
          blockedReason: { kind: "clarification-required", question: "Which directory?" },
          transitions: [
            {
              from: "active",
              to: "blocked",
              reason: "Needs clarification",
              triggerEvent: "session.blocked",
              timestamp: new Date("2026-03-19T15:42:36.000Z")
            }
          ]
        })}
        events={[makeEvent()]}
        approval={null}
        busy={false}
        onControl={vi.fn(async () => undefined)}
        onPreviewArtifact={vi.fn(async () => undefined)}
        onResolveApproval={vi.fn(async () => undefined)}
      />
    );

    expect(screen.queryByRole("heading", { name: "需要人工补充" })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("请补充你的说明...")).not.toBeInTheDocument();
    // Falls back to the inspect hint since no approval and no onClarify
    expect(screen.getByText("请先检查原因和产物，再决定是否发起后续任务。")).toBeInTheDocument();
  });

  it("falls back to goal ID before showing the raw session ID as the task title", () => {
    render(
      <SessionDetail
        session={makeWorkSession({
          id: "1c8e1f53-e3f6-4af3-801b-701096894cca",
          goalId: "legacy-goal-label",
          state: "active",
          namedGoalId: undefined,
          goalSummary: undefined
        })}
        events={[makeEvent({ type: "session.started", payload: { goalDescription: "Legacy session" } })]}
        approval={null}
        busy={false}
        onControl={vi.fn(async () => undefined)}
        onPreviewArtifact={vi.fn(async () => undefined)}
        onResolveApproval={vi.fn(async () => undefined)}
      />
    );

    const taskTitleField = screen.getByText("任务标题").closest(".session-kv");
    expect(taskTitleField).not.toBeNull();
    expect(within(taskTitleField as HTMLElement).getByText("legacy-goal-label")).toBeInTheDocument();
    expect(within(taskTitleField as HTMLElement).queryByText("1c8e1f53-e3f6-4af3-801b-701096894cca")).not.toBeInTheDocument();
  });

  it("shows checkpoints and rollback controls when snapshots are available", () => {
    const onRollback = vi.fn(async () => undefined);

    render(
      <SessionDetail
        session={makeWorkSession({
          state: "blocked",
          taskTitle: "README 摘要"
        })}
        events={[makeEvent(), makeEvent({ id: "evt-2", type: "artifact.emitted" })]}
        approval={null}
        busy={false}
        snapshots={[
          {
            snapshotId: "snapshot-2",
            capturedAt: new Date("2026-03-19T16:00:00.000Z"),
            schemaVersion: 2
          },
          {
            snapshotId: "snapshot-1",
            capturedAt: new Date("2026-03-19T15:50:00.000Z"),
            schemaVersion: 2
          }
        ]}
        onControl={vi.fn(async () => undefined)}
        onPreviewArtifact={vi.fn(async () => undefined)}
        onResolveApproval={vi.fn(async () => undefined)}
        onRollback={onRollback}
      />
    );

    expect(screen.getByRole("heading", { name: "检查点" })).toBeInTheDocument();
    expect(screen.getByText("最近检查点")).toBeInTheDocument();
    expect(screen.getByText("2 条审计事件")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "回滚到 snapshot-2" }));

    expect(onRollback).toHaveBeenCalledWith("snapshot-2");
  });

  it("falls back to an explicit unknown blocked reason when no reason metadata exists", () => {
    render(
      <SessionDetail
        session={makeWorkSession({
          state: "blocked",
          goalSummary: undefined,
          transitions: []
        })}
        events={[makeEvent()]}
        approval={null}
        busy={false}
        onControl={vi.fn(async () => undefined)}
        onPreviewArtifact={vi.fn(async () => undefined)}
        onResolveApproval={vi.fn(async () => undefined)}
      />
    );

    expect(screen.getByText("未知原因")).toBeInTheDocument();
  });
});
