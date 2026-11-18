import type { WorkflowSnapshot, ReviewDecision } from '../workflow/orchestrator.ts';
import { LABEL_DEFINITIONS } from '../ai/types.ts';

/**
 * Audit trail.
 *
 * Every reviewer decision is recorded as an immutable audit entry that
 * contains enough information to reconstruct what the system saw, what it
 * proposed and what the human decided. Entries are stored in `localStorage`
 * alongside the observability events.
 *
 * A completed decision also produces a **demonstration artifact**: a FHIR
 * R4 `Task` resource describing the administrative action that was taken.
 * The artifact is explicitly marked as synthetic and is never submitted to a
 * real FHIR server - it exists so the audit trail can be inspected in the
 * same shape an integration would use.
 */

export const AUDIT_STORAGE_KEY = 'careflow.audit.v1';

export interface AuditEntry {
  id: string;
  workflowId: string;
  residentId: string;
  residentName: string;
  timestamp: string;
  /** The label the system proposed. */
  proposedLabel: string;
  /** The label the reviewer settled on. */
  finalLabel: string;
  /** The reviewer's outcome. */
  outcome: ReviewDecision['outcome'];
  /** The reviewer's note or edited action. */
  note: string;
  /** The reviewer identity. Always the synthetic demo reviewer. */
  reviewer: string;
  /** The confidence the system reported. */
  confidence: number;
  /** Which engine produced the proposal. */
  engine: string;
  /** True when the rules engine answered because the model failed. */
  usedFallback: boolean;
  /** The rationale the system gave. */
  rationale: string;
  /** The FHIR demonstration artifact created by the decision. */
  artifact: FhirTaskArtifact | null;
}

export interface FhirTaskArtifact {
  resourceType: 'Task';
  id: string;
  status: 'requested' | 'in-progress' | 'completed' | 'rejected';
  intent: 'order';
  description: string;
  priority: 'routine' | 'urgent';
  authoredOn: string;
  subject: { reference: string; display: string };
  note: { text: string }[];
  extension: {
    url: string;
    valueString: string;
  }[];
  meta: {
    tag: { system: string; code: string; display: string }[];
  };
}

/**
 * Extension URLs used by the demonstration artifacts.
 *
 * The `careflow-*` namespace records provenance for the demonstration
 * itself: which system produced the artifact, which workflow it came from,
 * and that it must never be treated as clinical output.
 */
export const EXTENSION_BASE = 'https://careflow.example.org/fhir/StructureDefinition';

function hasStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

/**
 * Build the FHIR `Task` demonstration artifact for a review decision.
 *
 * The artifact is administrative: it records that a workflow step was
 * requested, not that any treatment was ordered.
 */
export function buildTaskArtifact(
  snapshot: WorkflowSnapshot,
  review: ReviewDecision,
): FhirTaskArtifact {
  const label = LABEL_DEFINITIONS[review.finalLabel];
  const status: FhirTaskArtifact['status'] =
    review.outcome === 'rejected' ? 'rejected' : 'completed';

  return {
    resourceType: 'Task',
    id: `${snapshot.id}-task`,
    status,
    intent: 'order',
    description: label.proposedAction,
    priority: review.finalLabel === 'priority' ? 'urgent' : 'routine',
    authoredOn: review.decidedAt,
    subject: {
      reference: `Patient/${snapshot.residentId}`,
      display: snapshot.residentName,
    },
    note: [
      {
        text: `Reviewer outcome: ${review.outcome}. Reviewer note: ${review.note || '(none)'}`,
      },
      {
        text:
          'This Task is a synthetic demonstration artifact produced by CareFlow AI. ' +
          'It records administrative workflow routing only. It is not a clinical order, ' +
          'not a prescription and not a treatment recommendation.',
      },
    ],
    extension: [
      {
        url: `${EXTENSION_BASE}/workflow-id`,
        valueString: snapshot.id,
      },
      {
        url: `${EXTENSION_BASE}/source-engine`,
        valueString: snapshot.decision?.engine ?? 'none',
      },
      {
        url: `${EXTENSION_BASE}/model-confidence`,
        valueString: String(snapshot.decision?.confidence ?? 0),
      },
      {
        url: `${EXTENSION_BASE}/synthetic-artifact`,
        valueString: 'true',
      },
    ],
    meta: {
      tag: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationValue',
          code: 'SYNTHETIC',
          display: 'Synthetic demonstration artifact - not for clinical use',
        },
      ],
    },
  };
}

/** Read the recorded audit entries. Corrupt stores read as empty. */
export function readAuditEntries(): AuditEntry[] {
  if (!hasStorage()) return [];
  try {
    const raw = window.localStorage.getItem(AUDIT_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isAuditEntry);
  } catch {
    return [];
  }
}

function isAuditEntry(value: unknown): value is AuditEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === 'string' &&
    typeof entry.workflowId === 'string' &&
    typeof entry.outcome === 'string' &&
    typeof entry.timestamp === 'string'
  );
}

/**
 * Record a review decision in the audit trail.
 *
 * The entry is appended, never overwritten: the trail is append-only.
 */
export function recordAuditEntry(snapshot: WorkflowSnapshot, review: ReviewDecision): AuditEntry {
  const entry: AuditEntry = {
    // The decision timestamp keeps the id unique when the same workflow is
    // reviewed more than once.
    id: `${snapshot.id}-audit-${review.decidedAt}`,
    workflowId: snapshot.id,
    residentId: snapshot.residentId,
    residentName: snapshot.residentName,
    timestamp: review.decidedAt,
    proposedLabel: snapshot.decision?.label ?? 'routine',
    finalLabel: review.finalLabel,
    outcome: review.outcome,
    note: review.note,
    reviewer: review.reviewer,
    confidence: snapshot.decision?.confidence ?? 0,
    engine: snapshot.decision?.engine ?? 'none',
    usedFallback: snapshot.decision?.usedFallback ?? false,
    rationale: snapshot.decision?.rationale ?? '',
    artifact: buildTaskArtifact(snapshot, review),
  };

  if (hasStorage()) {
    const entries = [entry, ...readAuditEntries()];
    try {
      window.localStorage.setItem(AUDIT_STORAGE_KEY, JSON.stringify(entries));
    } catch {
      // A full store must not break the review flow.
    }
  }

  return entry;
}

/** Clear the audit trail. */
export function clearAuditEntries(): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.removeItem(AUDIT_STORAGE_KEY);
  } catch {
    // Ignore: clearing the trail must never throw.
  }
}
