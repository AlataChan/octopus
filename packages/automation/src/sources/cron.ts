import cron from "node-cron";

import type { AutomationEvent, AutomationSource, CronSourceConfig } from "../types.js";

export interface ScheduledTaskLike {
  stop(): void;
}

export type CronScheduler = (expression: string, onTick: () => void) => ScheduledTaskLike;

export class CronSource implements AutomationSource {
  readonly name: string;
  readonly sourceType = "cron" as const;
  readonly namedGoalId: string;
  private task?: ScheduledTaskLike;

  constructor(
    private readonly config: CronSourceConfig,
    private readonly scheduler: CronScheduler = (expression, onTick) => cron.schedule(expression, onTick)
  ) {
    if (!cron.validate(config.schedule)) {
      throw new Error(`Invalid cron schedule: ${config.schedule}`);
    }
    this.name = `cron:${config.namedGoalId}`;
    this.namedGoalId = config.namedGoalId;
  }

  async start(onEvent: (event: AutomationEvent) => void): Promise<void> {
    this.task = this.scheduler(this.config.schedule, () => {
      onEvent({
        sourceType: "cron",
        namedGoalId: this.config.namedGoalId,
        triggeredAt: new Date()
      });
    });
  }

  async stop(): Promise<void> {
    this.task?.stop();
  }
}
