import type { WorkflowSnapshot, ReviewDecision } from '../workflow/orchestrator.ts';

/**
 * Observability recorder.
 *
 * Workflow events are written to `localStorage` so the Observability view
 * shows what actually happened during this session, including runs the user
 * has already completed. The store is deliberately small and transparent:
 * every event carries the engine, the label, the confidence and the stage
 * durations that produced it.
 *
 * Nothing is sent anywhere. The recorder has no network code at all.
 */

export interface WorkflowEvent {
  id: string;
  workflowId: string;
  residentId: string;
  residentName: string;
  /** ISO timestamp of the event. */
  timestamp: string;
  status: WorkflowSnapshot['status'];
  /** Total workflow duration in milliseconds. */
  durationMs: number;
  /** Per-stage durations, in stage order. */
  stageDurations: { id: string; title: string; durationMs: number; status: string }[];
  /** Which engine produced the decision. */
  engine: string;
  /** The label that was selected. */
  label: string;
  /** The calibrated confidence. */
  confidence: number;
  /** The threshold that was applied. */
  threshold: number;
  /** True when the rules engine answered because the model failed. */
  usedFallback: boolean;
  /** True when the model failed outright. */
  modelFailed: boolean;
  /** The reviewer outcome, once a decision has been made. */
  reviewOutcome: ReviewDecision['outcome'] | null;
  /** Total number of stage timings recorded. */
  stageCount: number;
}

export const OBSERVABILITY_STORAGE_KEY = 'careflow.observability.v1';

/** Maximum number of events retained in local storage. */
export const MAX_EVENTS = 200;

let eventSequence = 0;

/**
 * A monotonic counter that makes every event id unique.
 *
 * Workflow ids are derived from the resident and the start time, so a repeat
 * run inside the same millisecond would otherwise collide.
 */
function nextEventSequence(): number {
  eventSequence += 1;
  return eventSequence;
}

function hasStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

/**
 * Read the recorded events.
 *
 * A corrupt or unreadable store is treated as empty rather than throwing:
 * observability must never be able to break the application.
 */
export function readEvents(): WorkflowEvent[] {
  if (!hasStorage()) return [];
  try {
    const raw = window.localStorage.getItem(OBSERVABILITY_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isWorkflowEvent);
  } catch {
    return [];
  }
}

function isWorkflowEvent(value: unknown): value is WorkflowEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Record<string, unknown>;
  return (
    typeof event.id === 'string' &&
    typeof event.workflowId === 'string' &&
    typeof event.timestamp === 'string' &&
    typeof event.residentId === 'string'
  );
}

/**
 * Convert a workflow snapshot into a recorded event.
 *
 * The snapshot is the source of truth; the event is a flattened view of it
 * that is cheap to store and easy to aggregate.
 */
export function snapshotToEvent(snapshot: WorkflowSnapshot): WorkflowEvent {
  const decision = snapshot.decision;
  return {
    // The same workflow is recorded twice: once when it stops at the approval
    // gate and again after a reviewer decides. The status is part of the id so
    // the two events remain distinct, and a counter guarantees uniqueness even
    // if the same workflow is re-run with the same clock reading.
    id: `${snapshot.id}-${snapshot.startedAt}-${snapshot.status}-${nextEventSequence()}`,
    workflowId: snapshot.id,
    residentId: snapshot.residentId,
    residentName: snapshot.residentName,
    timestamp: snapshot.startedAt,
    status: snapshot.status,
    durationMs: snapshot.durationMs,
    stageDurations: snapshot.stages.map((stage) => ({
      id: stage.id,
      title: stage.title,
      durationMs: stage.durationMs,
      status: stage.status,
    })),
    engine: decision?.engine ?? 'none',
    label: decision?.label ?? 'routine',
    confidence: decision?.confidence ?? 0,
    threshold: decision?.threshold ?? 0,
    usedFallback: decision?.usedFallback ?? false,
    modelFailed: decision?.modelFailed ?? false,
    reviewOutcome: snapshot.review?.outcome ?? null,
    stageCount: snapshot.stages.length,
  };
}

/**
 * Persist an event.
 *
 * The store is capped so a long session cannot grow without bound.
 */
export function recordEvent(event: WorkflowEvent): WorkflowEvent[] {
  if (!hasStorage()) return [];
  const events = [event, ...readEvents()].slice(0, MAX_EVENTS);
  try {
    window.localStorage.setItem(OBSERVABILITY_STORAGE_KEY, JSON.stringify(events));
  } catch {
    // A full or unavailable store must not break the workflow.
  }
  return events;
}

/** Record a workflow snapshot and return the updated event list. */
export function recordSnapshot(snapshot: WorkflowSnapshot): WorkflowEvent[] {
  return recordEvent(snapshotToEvent(snapshot));
}

/** Clear every recorded event. */
export function clearEvents(): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.removeItem(OBSERVABILITY_STORAGE_KEY);
  } catch {
    // Ignore: clearing observability must never throw.
  }
}

export interface ObservabilitySummary {
  totalRuns: number;
  completed: number;
  abstained: number;
  failed: number;
  fallbacks: number;
  /** Mean workflow duration across all runs. */
  meanDurationMs: number;
  /** Mean duration of each stage across all runs. */
  meanStageDurations: { id: string; title: string; meanMs: number }[];
  /** Counts per selected label. */
  labelCounts: Record<string, number>;
  /** Counts per review outcome. */
  reviewCounts: Record<string, number>;
}

/** Aggregate the recorded events into the summary the view displays. */
export function summariseEvents(events: WorkflowEvent[]): ObservabilitySummary {
  const totalRuns = events.length;
  const completed = events.filter((event) => event.status === 'completed').length;
  const abstained = events.filter((event) => event.status === 'abstained').length;
  const failed = events.filter((event) => event.status === 'failed').length;
  const fallbacks = events.filter((event) => event.usedFallback).length;

  const meanDurationMs =
    totalRuns === 0
      ? 0
      : Number((events.reduce((sum, event) => sum + event.durationMs, 0) / totalRuns).toFixed(2));

  const stageTotals = new Map<string, { title: string; total: number; count: number }>();
  for (const event of events) {
    for (const stage of event.stageDurations) {
      const entry = stageTotals.get(stage.id) ?? { title: stage.title, total: 0, count: 0 };
      entry.total += stage.durationMs;
      entry.count += 1;
      stageTotals.set(stage.id, entry);
    }
  }
  const meanStageDurations = [...stageTotals.entries()].map(([id, entry]) => ({
    id,
    title: entry.title,
    meanMs: entry.count === 0 ? 0 : Number((entry.total / entry.count).toFixed(2)),
  }));

  const labelCounts: Record<string, number> = {};
  for (const event of events) {
    labelCounts[event.label] = (labelCounts[event.label] ?? 0) + 1;
  }

  const reviewCounts: Record<string, number> = {};
  for (const event of events) {
    if (!event.reviewOutcome) continue;
    reviewCounts[event.reviewOutcome] = (reviewCounts[event.reviewOutcome] ?? 0) + 1;
  }

  return {
    totalRuns,
    completed,
    abstained,
    failed,
    fallbacks,
    meanDurationMs,
    meanStageDurations,
    labelCounts,
    reviewCounts,
  };
}
