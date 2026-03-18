import { describe, expect, it } from "vitest";

import { CronSource } from "../../sources/cron.js";

describe("CronSource", () => {
  it("rejects invalid cron expressions before scheduling", () => {
    expect(() => {
      new CronSource({ type: "cron", namedGoalId: "daily-report", schedule: "not-a-cron" });
    }).toThrow(/invalid cron schedule/i);
  });

  it("emits automation events when the scheduled callback fires", async () => {
    let trigger: (() => void) | undefined;
    let stopped = false;
    const source = new CronSource(
      { type: "cron", namedGoalId: "daily-report", schedule: "0 9 * * 1-5" },
      (_expression, onTick) => {
        trigger = onTick;
        return {
          stop() {
            stopped = true;
          }
        };
      }
    );

    const events: Array<{ namedGoalId: string; sourceType: string }> = [];
    await source.start((event) => {
      events.push({ namedGoalId: event.namedGoalId, sourceType: event.sourceType });
    });

    trigger?.();
    await source.stop();

    expect(events).toEqual([{ namedGoalId: "daily-report", sourceType: "cron" }]);
    expect(stopped).toBe(true);
  });
});
