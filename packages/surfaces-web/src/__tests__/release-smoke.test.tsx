import { render, screen } from "@testing-library/preact";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "../i18n/I18nProvider.js";
import { ArtifactPreviewModal } from "../components/ArtifactPreviewModal.js";
import { ClarificationDialog } from "../components/ClarificationDialog.js";
import { LoginForm } from "../components/LoginForm.js";
import { StatusPanel } from "../components/StatusPanel.js";
import { TaskComposer } from "../components/TaskComposer.js";
import { makeStatus } from "./fixtures.js";

describe("release smoke", () => {
  it("renders the release-critical surfaces", () => {
    render(
      <I18nProvider>
        <div>
          <LoginForm onLogin={async () => undefined} />
          <TaskComposer busy={false} onSubmit={async () => undefined} />
          <ClarificationDialog question="Use /tmp?" busy={false} onAnswer={async () => undefined} />
          <StatusPanel status={makeStatus({
            currentRole: "operator",
            currentOperator: "ops1",
            browserLoginConfigured: true,
            configuredUsers: 3,
            traceStreamingAvailable: true
          })} visible />
          <ArtifactPreviewModal
            path="PLAN.md"
            content="# PLAN"
            loading={false}
            onClose={() => undefined}
          />
        </div>
      </I18nProvider>
    );

    expect(screen.getByRole("button", { name: "登录" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "新建任务" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "需要人工补充" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "网关状态" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "PLAN.md" })).toBeInTheDocument();
  });
});
