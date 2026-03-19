interface ControlBarProps {
  busy: boolean;
  onControl: (action: "pause" | "resume" | "cancel") => Promise<void>;
}

export function ControlBar({ busy, onControl }: ControlBarProps) {
  return (
    <div class="control-bar">
      <button type="button" disabled={busy} onClick={() => void onControl("pause")}>Pause</button>
      <button type="button" disabled={busy} onClick={() => void onControl("resume")}>Resume</button>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          if (window.confirm("Cancel this remote session?")) {
            void onControl("cancel");
          }
        }}
      >
        Cancel
      </button>
    </div>
  );
}
