import type { StatusResponse } from "../api/client.js";

interface StatusPanelProps {
  status: StatusResponse | null;
  visible: boolean;
}

export function StatusPanel({ status, visible }: StatusPanelProps) {
  if (!visible) {
    return null;
  }

  return (
    <aside class="card status-panel">
      <div class="panel-header">
        <h2>Status</h2>
      </div>
      <pre>{status ? JSON.stringify(status, null, 2) : "Loading..."}</pre>
    </aside>
  );
}
