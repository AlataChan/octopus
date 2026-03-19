import type { WorkEvent } from "@octopus/observability";

import { useI18n } from "../i18n/useI18n.js";

interface EventStreamProps {
  events: WorkEvent[];
}

export function EventStream({ events }: EventStreamProps) {
  const { t, formatTime } = useI18n();

  return (
    <section class="card event-stream">
      <div class="panel-header">
        <div>
          <p class="eyebrow">{t("event.activity")}</p>
          <h3>{t("event.recentActivity")}</h3>
        </div>
        <span>{events.length}</span>
      </div>
      <div class="event-log">
        {events.map((event) => (
          <div class="event-line" key={event.id}>
            <span>{formatTime(event.timestamp)}</span>
            <span>{event.type}</span>
            <span>{event.sourceLayer}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
