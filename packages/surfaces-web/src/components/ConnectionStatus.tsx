interface ConnectionStatusProps {
  state: "connecting" | "connected" | "disconnected";
  onToggleStatus: () => void;
  onLogout: () => void;
}

export function ConnectionStatus({ state, onToggleStatus, onLogout }: ConnectionStatusProps) {
  return (
    <div class="connection-status">
      <span class={`status-indicator ${state}`}>{state}</span>
      <div class="header-actions">
        <button type="button" onClick={onToggleStatus}>Status</button>
        <button type="button" onClick={onLogout}>Logout</button>
      </div>
    </div>
  );
}
