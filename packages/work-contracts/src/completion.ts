export interface CompletionEvidence {
  targetArtifactExists: boolean;
  verificationPassed: boolean;
  noUnresolvedPartials: boolean;
  limitationsPersisted: boolean;
  stateDurable: boolean;
  partialOverrideGranted?: boolean;
}

export function isCompletable(evidence: CompletionEvidence): boolean {
  return (
    evidence.targetArtifactExists &&
    evidence.verificationPassed &&
    (evidence.noUnresolvedPartials || evidence.partialOverrideGranted === true) &&
    evidence.limitationsPersisted &&
    evidence.stateDurable
  );
}
