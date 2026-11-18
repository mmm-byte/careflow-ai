import type { FhirResourceBase, Resident } from './types.ts';

export interface ResourceReference {
  /** Raw reference string as it appears in the resource, e.g. "Patient/p-1001". */
  reference: string;
  /** "Patient" | "Encounter" | ... */
  targetType: string;
  /** Target id, or null when the reference is not in "Type/id" form. */
  targetId: string | null;
  /** Whether the target exists in the current bundle. */
  resolved: boolean;
  /** Field path the reference came from. */
  field: string;
  /** Human-readable label carried alongside the reference, when present. */
  display: string | null;
  /** The resource the reference was found in, as "ResourceType/id". */
  from: string | null;
}

const REFERENCE_FIELDS = [
  'subject',
  'patient',
  'encounter',
  'context',
  'target',
  'actor',
  'individual',
  'who',
  'what',
  'serviceProvider',
  'author',
  'generalPractitioner',
  'managingOrganization',
  'basedOn',
  'partOf',
  'focus',
  'performer',
  'requester',
  'recorder',
  'assessor',
  'onBehalfOf',
] as const;

function collectReferences(value: unknown, field: string, out: ResourceReference[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectReferences(item, field, out);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;

  if (typeof record.reference === 'string') {
    const [type, id] = record.reference.split('/');
    out.push({
      reference: record.reference,
      targetType: type ?? '',
      targetId: id ?? null,
      resolved: false,
      field,
      display: typeof record.display === 'string' ? record.display : null,
      from: null,
    });
  }

  for (const [key, nested] of Object.entries(record)) {
    if (key === 'reference') continue;
    collectReferences(nested, key, out);
  }
}

/** Extract every reference contained in a resource, without following them. */
export function extractReferences(resource: FhirResourceBase): ResourceReference[] {
  const found: ResourceReference[] = [];
  for (const field of REFERENCE_FIELDS) {
    if (!(field in resource)) continue;
    collectReferences(resource[field], field, found);
  }
  // De-duplicate identical (field, reference) pairs.
  const seen = new Set<string>();
  return found.filter((ref) => {
    const key = `${ref.field}|${ref.reference}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface ResourceGraph {
  /** Keyed by "ResourceType/id". */
  index: Map<string, FhirResourceBase>;
  /** Keyed by "ResourceType/id" -> references that point at it. */
  inbound: Map<string, ResourceReference[]>;
  /** Keyed by "ResourceType/id" -> references it contains. */
  outbound: Map<string, ResourceReference[]>;
}

export function buildResourceGraph(
  resources: FhirResourceBase[],
  bundleId?: string | null,
): ResourceGraph {
  const index = new Map<string, FhirResourceBase>();
  const inbound = new Map<string, ResourceReference[]>();
  const outbound = new Map<string, ResourceReference[]>();

  for (const resource of resources) {
    if (resource.id) index.set(`${resource.resourceType}/${resource.id}`, resource);
  }

  // A `Provenance` resource targets the bundle that contains it. The bundle is
  // not an entry in itself, so the reference resolves against the bundle id
  // rather than the resource index.
  const bundleKey = bundleId ? `Bundle/${bundleId}` : null;

  for (const resource of resources) {
    const key = resource.id ? `${resource.resourceType}/${resource.id}` : null;
    const references = extractReferences(resource);
    if (key) outbound.set(key, references);

    for (const reference of references) {
      // Record where the reference came from so the explorer can show which
      // resource points at which.
      reference.from = key;
      if (!reference.targetType) continue;
      const targetKey = `${reference.targetType}/${reference.targetId ?? ''}`;
      reference.resolved = index.has(targetKey) || (bundleKey !== null && targetKey === bundleKey);
      const list = inbound.get(targetKey) ?? [];
      list.push(reference);
      inbound.set(targetKey, list);
    }
  }

  return { index, inbound, outbound };
}

/** Resources that point at the given resource. */
export function inboundReferences(graph: ResourceGraph, key: string): ResourceReference[] {
  return graph.inbound.get(key) ?? [];
}

/** References contained in the given resource. */
export function outboundReferences(graph: ResourceGraph, key: string): ResourceReference[] {
  return graph.outbound.get(key) ?? [];
}

/**
 * Build a timeline of clinical events across resource types for one resident.
 * Each entry keeps the originating resource so the UI can link back to it.
 */
export interface TimelineEntry {
  id: string;
  at: string | null;
  kind: 'Encounter' | 'Observation' | 'Document' | 'CarePlan' | 'Task' | 'Appointment';
  title: string;
  detail: string | null;
  resourceType: string;
  resourceId: string;
}

/**
 * Build a chronological timeline of everything that happened to a resident.
 *
 * The function accepts the normalized `Resident` directly so the timeline
 * can never drift from the data the parser produces.
 */
export function buildTimeline(resident: Resident): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    ...resident.encounters.map((encounter) => ({
      id: `enc-${encounter.id}`,
      at: encounter.startedAt,
      kind: 'Encounter' as const,
      title: encounter.reason ?? 'Encounter',
      detail: encounter.status ? `Status: ${encounter.status}` : null,
      resourceType: 'Encounter',
      resourceId: encounter.id,
    })),
    ...resident.observations.map((observation) => ({
      id: `obs-${observation.id}`,
      at: observation.effectiveAt,
      kind: 'Observation' as const,
      title: observation.label,
      detail: `${observation.displayValue}${observation.interpretation ? ` · ${observation.interpretation}` : ''}`,
      resourceType: 'Observation',
      resourceId: observation.id,
    })),
    ...resident.documents.map((document) => ({
      id: `doc-${document.id}`,
      at: document.authoredAt,
      kind: 'Document' as const,
      title: document.description || 'Clinical note',
      detail: null,
      resourceType: 'DocumentReference',
      resourceId: document.id,
    })),
    ...resident.tasks.map((task) => ({
      id: `task-${task.id}`,
      at: task.dueAt,
      kind: 'CarePlan' as const,
      title: task.description,
      detail: task.status ? `Status: ${task.status}` : null,
      resourceType: task.resourceType,
      resourceId: task.id,
    })),
    ...resident.appointments.map((appointment) => ({
      id: `apt-${appointment.id}`,
      at: appointment.startsAt,
      kind: 'Appointment' as const,
      title: appointment.description,
      detail: appointment.status ? `Status: ${appointment.status}` : null,
      resourceType: 'Appointment',
      resourceId: appointment.id,
    })),
  ];

  return entries.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
}
