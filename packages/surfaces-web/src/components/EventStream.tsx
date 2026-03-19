import type { WorkEvent } from "@octopus/observability";

interface EventStreamProps {
  events: WorkEvent[];
}

export function EventStream({ events }: EventStreamProps) {
  return (
    <section class="card event-stream">
      <div class="panel-header">
        <h3>Live Events</h3>
        <span>{events.length}</span>
      </div>
      <div class="event-log">
        {events.map((event) => (
          <div class="event-line" key={event.id}>
            <span>{event.timestamp.toLocaleTimeString()}</span>
            <span>{event.type}</span>
            <span>{event.sourceLayer}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
