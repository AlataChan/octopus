import type {
  Action,
  Artifact,
  BlockedReason,
  Observation,
  StateTransition,
  Verification,
  WorkItem,
  WorkSession
} from "@octopus/work-contracts";

export interface StoredAction extends Omit<Action, "createdAt"> {
  createdAt: string;
}

export interface StoredVerification extends Omit<Verification, "createdAt"> {
  createdAt: string;
}

export interface StoredObservation extends Omit<Observation, "createdAt"> {
  createdAt: string;
}

export interface StoredArtifact extends Omit<Artifact, "createdAt"> {
  createdAt: string;
}

export interface StoredStateTransition extends Omit<StateTransition, "timestamp"> {
  timestamp: string;
}

export interface StoredWorkItem
  extends Omit<WorkItem, "createdAt" | "observations" | "actions" | "verifications"> {
  createdAt: string;
  observations: StoredObservation[];
  actions: StoredAction[];
  verifications: StoredVerification[];
}

export interface StoredWorkSession
  extends Omit<WorkSession, "createdAt" | "updatedAt" | "items" | "observations" | "artifacts" | "transitions"> {
  createdAt: string;
  updatedAt: string;
  items: StoredWorkItem[];
  observations: StoredObservation[];
  artifacts: StoredArtifact[];
  transitions: StoredStateTransition[];
}

export function serializeWorkSession(session: WorkSession): StoredWorkSession {
  return {
    id: session.id,
    goalId: session.goalId,
    workspaceId: session.workspaceId,
    configProfileId: session.configProfileId,
    ...(session.createdBy ? { createdBy: session.createdBy } : {}),
    ...(session.taskTitle ? { taskTitle: session.taskTitle } : {}),
    ...(session.namedGoalId ? { namedGoalId: session.namedGoalId } : {}),
    ...(session.goalSummary ? { goalSummary: session.goalSummary } : {}),
    ...(session.skillContext ? { skillContext: session.skillContext } : {}),
    ...(session.injectionPlanIds ? { injectionPlanIds: [...session.injectionPlanIds] } : {}),
    state: session.state,
    items: session.items.map(serializeWorkItem),
    observations: session.observations.map(serializeObservation),
    artifacts: session.artifacts.map(serializeArtifact),
    transitions: session.transitions.map(serializeStateTransition),
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
    ...(session.blockedReason ? { blockedReason: session.blockedReason } : {})
  };
}

export function hydrateWorkSession(session: StoredWorkSession): WorkSession {
  return {
    id: session.id,
    goalId: session.goalId,
    workspaceId: session.workspaceId ?? "default",
    configProfileId: session.configProfileId ?? "default",
    ...(session.createdBy ? { createdBy: session.createdBy } : {}),
    ...(session.taskTitle ? { taskTitle: session.taskTitle } : {}),
    ...(session.namedGoalId ? { namedGoalId: session.namedGoalId } : {}),
    ...(session.goalSummary ? { goalSummary: session.goalSummary } : {}),
    ...(session.skillContext ? { skillContext: session.skillContext } : {}),
    ...(session.injectionPlanIds ? { injectionPlanIds: [...session.injectionPlanIds] } : {}),
    state: session.state,
    items: session.items.map(hydrateWorkItem),
    observations: session.observations.map(hydrateObservation),
    artifacts: session.artifacts.map(hydrateArtifact),
    transitions: session.transitions.map(hydrateStateTransition),
    createdAt: new Date(session.createdAt),
    updatedAt: new Date(session.updatedAt),
    ...(session.blockedReason ? { blockedReason: session.blockedReason as BlockedReason } : {})
  };
}

export function serializeWorkItem(item: WorkItem): StoredWorkItem {
  return {
    ...item,
    observations: item.observations.map(serializeObservation),
    actions: item.actions.map(serializeAction),
    verifications: item.verifications.map(serializeVerification),
    createdAt: item.createdAt.toISOString()
  };
}

export function hydrateWorkItem(item: StoredWorkItem): WorkItem {
  return {
    ...item,
    observations: item.observations.map(hydrateObservation),
    actions: item.actions.map(hydrateAction),
    verifications: item.verifications.map(hydrateVerification),
    createdAt: new Date(item.createdAt)
  };
}

export function serializeObservation(observation: Observation): StoredObservation {
  return {
    ...observation,
    createdAt: observation.createdAt.toISOString()
  };
}

export function hydrateObservation(observation: StoredObservation): Observation {
  return {
    ...observation,
    createdAt: new Date(observation.createdAt)
  };
}

export function serializeAction(action: Action): StoredAction {
  return {
    ...action,
    createdAt: action.createdAt.toISOString()
  };
}

export function hydrateAction(action: StoredAction): Action {
  return {
    ...action,
    createdAt: new Date(action.createdAt)
  };
}

export function serializeVerification(verification: Verification): StoredVerification {
  return {
    ...verification,
    createdAt: verification.createdAt.toISOString()
  };
}

export function hydrateVerification(verification: StoredVerification): Verification {
  return {
    ...verification,
    createdAt: new Date(verification.createdAt)
  };
}

export function serializeArtifact(artifact: Artifact): StoredArtifact {
  return {
    ...artifact,
    createdAt: artifact.createdAt.toISOString()
  };
}

export function hydrateArtifact(artifact: StoredArtifact): Artifact {
  return {
    ...artifact,
    createdAt: new Date(artifact.createdAt)
  };
}

export function serializeStateTransition(transition: StateTransition): StoredStateTransition {
  return {
    ...transition,
    timestamp: transition.timestamp.toISOString()
  };
}

export function hydrateStateTransition(transition: StoredStateTransition): StateTransition {
  return {
    ...transition,
    timestamp: new Date(transition.timestamp)
  };
}
