import { fireEvent, render, screen } from "@testing-library/preact";
import { describe, expect, it } from "vitest";

import { EventStream } from "../components/EventStream.js";
import { I18nProvider } from "../i18n/I18nProvider.js";
import { makeEvent, makeWorkSession } from "./fixtures.js";

describe("EventStream", () => {
  it("groups action lifecycle events into collapsible action blocks", () => {
    const session = makeWorkSession({
      state: "active",
      items: [
        {
          id: "item-1",
          sessionId: "session-1",
          description: "Inspect repo",
          state: "active",
          observations: [],
          actions: [
            {
              id: "action-1",
              type: "shell",
              params: {
                executable: "rg",
                args: ["TODO", "packages"]
              },
              result: {
                success: true,
                output: "- find one\n- find two",
                outcome: "completed",
                durationMs: 845
              },
              createdAt: new Date("2026-03-19T15:42:36.000Z")
            }
          ],
          verifications: [],
          createdAt: new Date("2026-03-19T15:42:36.000Z")
        }
      ]
    });

    render(
      <I18nProvider>
        <EventStream
          session={session}
          events={[
            makeEvent({
              id: "evt-req",
              type: "action.requested",
              timestamp: new Date("2026-03-19T15:42:36.000Z"),
              sourceLayer: "work-core",
              payload: {
                actionId: "action-1",
                actionType: "shell"
              }
            }),
            makeEvent({
              id: "evt-other",
              type: "session.started",
              timestamp: new Date("2026-03-19T15:41:36.000Z"),
              sourceLayer: "work-core",
              payload: {
                goalDescription: "Inspect repo"
              }
            }),
            makeEvent({
              id: "evt-done",
              type: "action.completed",
              timestamp: new Date("2026-03-19T15:43:36.000Z"),
              sourceLayer: "work-core",
              payload: {
                actionId: "action-1",
                success: true
              }
            })
          ]}
          progressByActionId={{}}
        />
      </I18nProvider>
    );

    expect(screen.getByRole("button", { name: /rg TODO packages/i })).toBeInTheDocument();
    expect(screen.getByText("session.started")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /rg TODO packages/i }));

    expect(screen.getByText("find one")).toBeInTheDocument();
    expect(screen.getByText("845ms")).toBeInTheDocument();
  });

  it("renders live progress output for in-flight actions", () => {
    const session = makeWorkSession({
      state: "active",
      items: []
    });

    render(
      <I18nProvider>
        <EventStream
          session={session}
          events={[
            makeEvent({
              id: "evt-req",
              type: "action.requested",
              sourceLayer: "work-core",
              payload: {
                actionId: "action-live",
                actionType: "shell"
              }
            })
          ]}
          progressByActionId={{
            "action-live": {
              stdout: "first line\nsecond line",
              stderr: "",
              info: ""
            }
          }}
        />
      </I18nProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: /shell/i }));
    expect(screen.getByText("first line")).toBeInTheDocument();
    expect(screen.getByText("second line")).toBeInTheDocument();
  });
});
