import { useState } from "preact/hooks";

interface ClarificationDialogProps {
  question: string;
  busy: boolean;
  onAnswer: (answer: string) => void;
}

export function ClarificationDialog({ question, busy, onAnswer }: ClarificationDialogProps) {
  const [answer, setAnswer] = useState("");

  return (
    <div class="card clarification-dialog">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Clarification Required</p>
          <h3>Agent needs your input</h3>
        </div>
      </div>
      <p class="clarification-question">{question}</p>
      <textarea
        class="clarification-input"
        value={answer}
        onInput={(e) => setAnswer((e.target as HTMLTextAreaElement).value)}
        placeholder="Enter your answer..."
        rows={3}
      />
      <button
        type="button"
        class="button-primary"
        disabled={busy || answer.trim().length === 0}
        onClick={() => onAnswer(answer)}
      >
        {busy ? "Sending..." : "Submit Answer"}
      </button>
    </div>
  );
}
