export interface CompletionEvidence {
  targetArtifactExists: boolean;
  verificationRecorded: boolean;
  limitationsPersisted: boolean;
  stateDurable: boolean;
}

export function isCompletable(evidence: CompletionEvidence): boolean {
  return (
    evidence.targetArtifactExists &&
    evidence.verificationRecorded &&
    evidence.limitationsPersisted &&
    evidence.stateDurable
  );
}

