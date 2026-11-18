import type {
  DataQualityWarning,
  FhirCodeableConcept,
  FhirDocumentReference,
  FhirEncounter,
  FhirObservation,
  FhirPatient,
  FhirReference,
  FhirResourceBase,
  NormalizedAppointment,
  NormalizedDocument,
  NormalizedEncounter,
  NormalizedObservation,
  NormalizedTask,
  RawBundle,
  Resident,
} from './types.ts';
import {
  isValidDateOnly,
  isValidDateTime,
  validateBundle,
  validateResources,
} from './validation.ts';

export interface ParseResult {
  residents: Resident[];
  resources: FhirResourceBase[];
  warnings: DataQualityWarning[];
  /** Resources that could not be attributed to a patient. */
  orphans: FhirResourceBase[];
  /**
   * The id of the enclosing bundle, when it has one. A `Provenance` resource
   * targets the bundle itself, so the reference graph needs it to resolve
   * that reference rather than reporting it as an orphan.
   */
  bundleId: string | null;
}

function conceptText(concept: FhirCodeableConcept | undefined): string | null {
  if (!concept) return null;
  if (concept.text) return concept.text;
  const coding = concept.coding?.find((c) => c.display || c.code);
  return coding?.display ?? coding?.code ?? null;
}

function quantityText(value: unknown): string {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  return '';
}

function referenceId(reference: FhirReference | undefined): string | null {
  if (!reference?.reference) return null;
  const parts = reference.reference.split('/');
  return parts[parts.length - 1] ?? null;
}

/** Resource types that are expected to point at a patient. */
const PATIENT_BOUND_TYPES = new Set([
  'Encounter',
  'Observation',
  'DocumentReference',
  'CarePlan',
  'Task',
  'Appointment',
]);

/**
 * Find the patient a resource belongs to.
 *
 * Most clinical resources use `subject.reference`. Appointments instead list
 * the patient as a `participant.actor`. Both are honoured so an Appointment
 * is not misreported as an orphan.
 */
export function patientSubjectOf(resource: FhirResourceBase): {
  id: string | null;
  field: string | null;
} {
  const subject = (resource as { subject?: FhirReference }).subject;
  if (subject?.reference?.startsWith('Patient/')) {
    return { id: referenceId(subject), field: 'subject.reference' };
  }
  if (subject?.reference) {
    // A subject that points at a non-Patient resource (for example a group).
    return { id: null, field: 'subject.reference' };
  }
  if (resource.resourceType === 'Appointment') {
    const participants =
      (resource as { participant?: { actor?: FhirReference }[] }).participant ?? [];
    for (const participant of participants) {
      const actor = participant.actor?.reference;
      if (actor?.startsWith('Patient/')) {
        return { id: referenceId(participant.actor), field: 'participant.actor.reference' };
      }
    }
  }
  return { id: null, field: null };
}

function referenceKey(resource: FhirResourceBase): string {
  return `${resource.resourceType}/${resource.id}`;
}

export { referenceKey };

function parseDateOnly(value: string | undefined): string | null {
  if (!value) return null;
  return isValidDateOnly(value) ? value : null;
}

function parseDateTime(value: string | undefined): string | null {
  if (!value) return null;
  return isValidDateTime(value) ? value : null;
}

export function ageFromBirthDate(birthDate: string | null, now: Date = new Date()): number | null {
  if (!birthDate) return null;
  const born = new Date(`${birthDate}T00:00:00Z`);
  if (Number.isNaN(born.getTime())) return null;
  let age = now.getUTCFullYear() - born.getUTCFullYear();
  const monthDelta = now.getUTCMonth() - born.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < born.getUTCDate())) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

function normalizeObservation(resource: FhirResourceBase): NormalizedObservation {
  const observation = resource as FhirObservation;
  const quantity = observation.valueQuantity;
  const numeric = typeof quantity?.value === 'number' ? quantity.value : null;
  const interpretation = conceptText(observation.interpretation?.[0]);
  const range = observation.referenceRange?.[0];
  const rangeText = range
    ? (range.text ??
      [
        range.low?.value !== undefined ? `>= ${quantityText(range.low.value)}` : null,
        range.high?.value !== undefined ? `<= ${quantityText(range.high.value)}` : null,
      ]
        .filter(Boolean)
        .join(' and '))
    : null;

  const displayValue =
    numeric !== null
      ? `${numeric}${quantity?.unit ? ` ${quantity.unit}` : ''}`
      : (observation.valueString ?? quantityText(observation.valueCodeableConcept?.text) ?? '—');

  return {
    id: resource.id ?? '',
    label: conceptText(observation.code) ?? 'Observation',
    value: numeric,
    unit: quantity?.unit ?? '',
    displayValue,
    effectiveAt:
      parseDateTime(observation.effectiveDateTime) ??
      parseDateTime(observation.effectivePeriod?.start) ??
      parseDateTime(observation.issued),
    status: observation.status ?? null,
    interpretation,
    referenceRange: rangeText,
    note: observation.note?.[0]?.text ?? null,
    resourceType: 'Observation',
  };
}

function normalizeEncounter(resource: FhirResourceBase): NormalizedEncounter {
  const encounter = resource as FhirEncounter;
  return {
    id: resource.id ?? '',
    status: encounter.status ?? null,
    reason: conceptText(encounter.reasonCode?.[0]) ?? conceptText(encounter.type?.[0]) ?? null,
    startedAt: parseDateTime(encounter.period?.start),
    endedAt: parseDateTime(encounter.period?.end),
    type: encounter.class?.display ?? encounter.class?.code ?? null,
    resourceType: 'Encounter',
  };
}

function normalizeDocument(resource: FhirResourceBase): NormalizedDocument {
  const document = resource as FhirDocumentReference;
  const attachment = document.content?.[0]?.attachment;
  return {
    id: resource.id ?? '',
    description: document.description ?? '',
    authoredAt: parseDateTime(document.date) ?? parseDateTime(document.context?.[0]?.period?.start),
    contentType: attachment?.contentType ?? null,
    title: attachment?.title ?? null,
    resourceType: 'DocumentReference',
  };
}

function normalizeTask(resource: FhirResourceBase): NormalizedTask {
  const task = resource as {
    description?: string;
    status?: string;
    dueDate?: string;
    code?: FhirCodeableConcept;
    activity?: {
      detail?: { description?: string; status?: string; scheduled?: { start?: string } };
    }[];
  };
  const activity = resource.resourceType === 'CarePlan' ? task.activity?.[0]?.detail : undefined;
  return {
    id: resource.id ?? '',
    description: activity?.description ?? task.description ?? 'Follow-up activity',
    status: activity?.status ?? task.status ?? null,
    dueAt: parseDateTime(task.dueDate) ?? parseDateTime(activity?.scheduled?.start),
    scheduledStart: parseDateTime(activity?.scheduled?.start),
    code: conceptText(task.code),
    resourceType: resource.resourceType === 'CarePlan' ? 'CarePlan' : 'Task',
  };
}

function normalizeAppointment(resource: FhirResourceBase): NormalizedAppointment {
  const appointment = resource as {
    description?: string;
    status?: string;
    start?: string;
    end?: string;
    serviceType?: FhirCodeableConcept[];
  };
  return {
    id: resource.id ?? '',
    description:
      appointment.description ?? conceptText(appointment.serviceType?.[0]) ?? 'Appointment',
    status: appointment.status ?? null,
    startsAt: parseDateTime(appointment.start),
    endsAt: parseDateTime(appointment.end),
    resourceType: 'Appointment',
  };
}

function residentName(patient: FhirPatient): { name: string; given: string; family: string } {
  const preferred = patient.name?.find((n) => n.use === 'official') ?? patient.name?.[0];
  const given = preferred?.given?.filter(Boolean).join(' ') ?? '';
  const family = preferred?.family ?? '';
  const composed = [given, family].filter(Boolean).join(' ') || preferred?.text || '';
  return { name: composed, given, family };
}

/**
 * Parse a FHIR bundle into normalized residents.
 *
 * Resources are attributed to a patient through `subject.reference`; resources
 * with no patient reference are reported as orphans instead of being dropped
 * silently.
 */
export function parseBundle(bundle: RawBundle): ParseResult {
  const warnings = validateBundle(bundle);
  const entries = Array.isArray(bundle?.entry) ? bundle.entry : [];
  const resources: FhirResourceBase[] = [];
  const malformedEntries: FhirResourceBase[] = [];

  for (const entry of entries) {
    const resource = entry?.resource;
    if (resource && typeof resource === 'object' && typeof resource.resourceType === 'string') {
      resources.push(resource);
    } else if (resource) {
      malformedEntries.push(resource);
    }
  }

  warnings.push(...validateResources(resources));

  const patients = resources.filter(
    (r): r is FhirResourceBase & FhirPatient => r.resourceType === 'Patient',
  );
  const patientIndex = new Map<string, FhirResourceBase>();
  for (const patient of patients) {
    if (patient.id) patientIndex.set(patient.id, patient);
  }

  const byPatient = new Map<string, FhirResourceBase[]>();
  const orphans: FhirResourceBase[] = [];

  for (const resource of resources) {
    if (resource.resourceType === 'Patient') continue;
    const { id: subjectId, field } = patientSubjectOf(resource);
    if (!subjectId) {
      if (PATIENT_BOUND_TYPES.has(resource.resourceType)) {
        orphans.push(resource);
        warnings.push({
          code: 'resource.no-subject',
          severity: 'warning',
          message: `${resource.resourceType} "${resource.id ?? 'unknown'}" has no patient reference and cannot be attributed.`,
          resourceType: resource.resourceType,
          resourceId: resource.id,
          field: 'subject',
        });
      }
      continue;
    }
    if (!patientIndex.has(subjectId)) {
      orphans.push(resource);
      warnings.push({
        code: 'reference.unresolved',
        severity: 'warning',
        message: `${resource.resourceType} references unknown patient "${subjectId}".`,
        resourceType: resource.resourceType,
        resourceId: resource.id,
        field: field ?? 'subject.reference',
      });
      continue;
    }
    const list = byPatient.get(subjectId) ?? [];
    list.push(resource);
    byPatient.set(subjectId, list);
  }

  const residents: Resident[] = patients.map((patient) => {
    const related = byPatient.get(patient.id ?? '') ?? [];
    const warningsForResident = warnings.filter(
      (w) =>
        (w.resourceId && related.some((r) => r.id === w.resourceId)) ||
        (w.resourceType === 'Patient' && w.resourceId === patient.id),
    );

    const encounters = related
      .filter((r) => r.resourceType === 'Encounter')
      .map(normalizeEncounter);
    const observations = related
      .filter((r) => r.resourceType === 'Observation')
      .map(normalizeObservation);
    const documents = related
      .filter((r) => r.resourceType === 'DocumentReference')
      .map(normalizeDocument);
    const tasks = related
      .filter((r) => r.resourceType === 'CarePlan' || r.resourceType === 'Task')
      .map(normalizeTask);
    const appointments = related
      .filter((r) => r.resourceType === 'Appointment')
      .map(normalizeAppointment);

    const { name, given, family } = residentName(patient);
    const birthDate = parseDateOnly(patient.birthDate);

    if (!name) {
      warningsForResident.push({
        code: 'patient.anonymous',
        severity: 'warning',
        message: 'Patient has no usable name; displayed as "Unnamed resident".',
        resourceType: 'Patient',
        resourceId: patient.id,
        field: 'name',
      });
    }

    return {
      id: patient.id ?? '',
      name: name || 'Unnamed resident',
      givenName: given,
      familyName: family,
      birthDate,
      gender: patient.gender ?? null,
      ageYears: ageFromBirthDate(birthDate),
      identifiers: (patient.identifier ?? [])
        .map((identifier) => identifier.value)
        .filter((value): value is string => Boolean(value)),
      encounters: encounters.sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? '')),
      observations: observations.sort((a, b) =>
        (b.effectiveAt ?? '').localeCompare(a.effectiveAt ?? ''),
      ),
      documents: documents.sort((a, b) => (b.authoredAt ?? '').localeCompare(a.authoredAt ?? '')),
      tasks: tasks.sort((a, b) => (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999')),
      appointments: appointments.sort((a, b) =>
        (a.startsAt ?? '9999').localeCompare(b.startsAt ?? '9999'),
      ),
      warnings: warningsForResident,
      sourceResourceIds: [patient.id ?? '', ...related.map((r) => r.id ?? '')].filter(Boolean),
    };
  });

  return {
    residents,
    resources,
    warnings,
    orphans,
    bundleId: typeof bundle?.id === 'string' ? bundle.id : null,
  };
}

/** Parse a JSON string, tolerating malformed input. */
export function parseBundleJson(json: string): {
  result: ParseResult | null;
  error: string | null;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    return { result: null, error: error instanceof Error ? error.message : 'Malformed JSON' };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { result: null, error: 'Bundle payload is not a JSON object.' };
  }
  return { result: parseBundle(parsed as RawBundle), error: null };
}

/**
 * Resolve the resources referenced by a resident, in a stable order.
 * Used by the FHIR Explorer to show what actually contributed to a decision.
 */
export function resolveResidentResources(
  resident: Resident,
  resources: FhirResourceBase[],
): FhirResourceBase[] {
  const wanted = new Set(resident.sourceResourceIds);
  return resources.filter((resource) => resource.id && wanted.has(resource.id));
}
