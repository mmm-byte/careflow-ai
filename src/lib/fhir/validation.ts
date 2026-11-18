import type { DataQualityWarning, FhirObservation, FhirResourceBase, RawBundle } from './types.ts';

export const SUPPORTED_RESOURCE_TYPES = [
  'Patient',
  'Encounter',
  'Observation',
  'DocumentReference',
  'CarePlan',
  'Appointment',
  'Task',
  'Provenance',
] as const;

/**
 * Directory resources legitimately have no patient subject (an Organization or
 * Practitioner describes the facility, not a resident). They are preserved and
 * reported as informational rather than as data-quality problems.
 */
const DIRECTORY_RESOURCE_TYPES = new Set([
  'Organization',
  'Practitioner',
  'PractitionerRole',
  'Location',
  'Device',
  'Endpoint',
  'HealthcareService',
]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?(Z|[+-]\d{2}:\d{2})?$/;

export function isValidDateOnly(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  // Reject calendar-invalid dates such as 2026-02-31.
  return parsed.toISOString().slice(0, 10) === value;
}

export function isValidDateTime(value: string): boolean {
  if (!ISO_DATETIME.test(value)) return false;
  return !Number.isNaN(new Date(value).getTime());
}

function warn(
  warnings: DataQualityWarning[],
  code: string,
  severity: DataQualityWarning['severity'],
  message: string,
  resource?: FhirResourceBase,
  field?: string,
): void {
  warnings.push({
    code,
    severity,
    message,
    resourceType: resource?.resourceType,
    resourceId: resource?.id,
    field,
  });
}

/**
 * Structural validation of a bundle and its entries.
 *
 * This is intentionally a pragmatic subset of the FHIR R4 spec: it checks the
 * invariants that actually matter for the care workflow (identifiers, subject
 * references, dates, observation values) rather than attempting full schema
 * conformance. Warnings are surfaced in the UI; they never block the demo.
 */
export function validateBundle(bundle: RawBundle): DataQualityWarning[] {
  const warnings: DataQualityWarning[] = [];

  if (!bundle || typeof bundle !== 'object') {
    warn(warnings, 'bundle.not-object', 'error', 'Bundle payload is not a JSON object.');
    return warnings;
  }
  if (bundle.resourceType !== 'Bundle') {
    warn(
      warnings,
      'bundle.wrong-resource-type',
      'error',
      `Expected resourceType "Bundle" but found "${String(bundle.resourceType)}".`,
    );
  }
  if (!Array.isArray(bundle.entry) || bundle.entry.length === 0) {
    warn(warnings, 'bundle.empty', 'warning', 'Bundle contains no entries.');
    return warnings;
  }

  const ids = new Set<string>();
  bundle.entry.forEach((entry, index) => {
    const resource = entry?.resource;
    if (!resource || typeof resource !== 'object') {
      warn(warnings, 'entry.missing-resource', 'error', `Entry ${index} has no resource.`);
      return;
    }
    if (typeof resource.resourceType !== 'string' || resource.resourceType.length === 0) {
      warn(
        warnings,
        'resource.missing-resource-type',
        'error',
        `Entry ${index} has no resourceType.`,
        resource,
      );
    }
    if (!resource.id) {
      warn(
        warnings,
        'resource.missing-id',
        'warning',
        `${resource.resourceType} has no id and cannot be referenced.`,
        resource,
        'id',
      );
    } else if (ids.has(`${resource.resourceType}/${resource.id}`)) {
      warn(
        warnings,
        'resource.duplicate-id',
        'error',
        `Duplicate resource id "${resource.id}" for ${resource.resourceType}.`,
        resource,
        'id',
      );
    } else {
      ids.add(`${resource.resourceType}/${resource.id}`);
    }
    if (!(SUPPORTED_RESOURCE_TYPES as readonly string[]).includes(resource.resourceType)) {
      if (!DIRECTORY_RESOURCE_TYPES.has(resource.resourceType)) {
        warn(
          warnings,
          'resource.unsupported-type',
          'info',
          `${resource.resourceType} is preserved but not interpreted by the workflow.`,
          resource,
        );
      }
    }
  });

  return warnings;
}

/** Validate resources that participate in the workflow and their relationships. */
export function validateResources(resources: FhirResourceBase[]): DataQualityWarning[] {
  const warnings: DataQualityWarning[] = [];
  const known = new Set(resources.map((r) => `${r.resourceType}/${r.id}`));

  for (const resource of resources) {
    const subject = (resource as { subject?: { reference?: string } }).subject;
    if (subject?.reference) {
      if (!/^[A-Za-z]+\/[^/]+$/.test(subject.reference)) {
        warn(
          warnings,
          'reference.malformed',
          'warning',
          `Malformed subject reference "${subject.reference}".`,
          resource,
          'subject.reference',
        );
      } else if (!known.has(subject.reference)) {
        warn(
          warnings,
          'reference.unresolved',
          'warning',
          `Subject reference "${subject.reference}" does not resolve to a resource in this bundle.`,
          resource,
          'subject.reference',
        );
      }
    }

    if (resource.resourceType === 'Appointment') {
      const participants =
        (resource as { participant?: { actor?: { reference?: string } }[] }).participant ?? [];
      const patientActor = participants.find((participant) =>
        participant.actor?.reference?.startsWith('Patient/'),
      );
      if (!patientActor) {
        warn(
          warnings,
          'appointment.no-patient',
          'warning',
          'Appointment has no patient participant.',
          resource,
          'participant',
        );
      } else if (!known.has(patientActor.actor?.reference ?? '')) {
        warn(
          warnings,
          'reference.unresolved',
          'warning',
          `Appointment participant "${patientActor.actor?.reference}" does not resolve to a resource in this bundle.`,
          resource,
          'participant.actor.reference',
        );
      }
    }

    if (resource.resourceType === 'Patient') {
      const patient = resource as {
        name?: { given?: string[]; family?: string; text?: string }[];
        birthDate?: string;
      };
      if (!patient.name?.length) {
        warn(
          warnings,
          'patient.missing-name',
          'warning',
          'Patient has no name entry.',
          resource,
          'name',
        );
      } else if (!patient.name[0]?.family && !patient.name[0]?.text) {
        warn(
          warnings,
          'patient.missing-family-name',
          'warning',
          'Patient name is missing a family or text value.',
          resource,
          'name.family',
        );
      }
      if (patient.birthDate && !isValidDateOnly(patient.birthDate)) {
        warn(
          warnings,
          'patient.invalid-birthdate',
          'warning',
          `Invalid birthDate "${patient.birthDate}".`,
          resource,
          'birthDate',
        );
      }
    }

    if (resource.resourceType === 'Observation') {
      const observation = resource as FhirObservation;
      if (observation.valueQuantity?.value === undefined && observation.valueString === undefined) {
        warn(
          warnings,
          'observation.missing-value',
          'warning',
          'Observation has no recorded value.',
          resource,
          'value',
        );
      }
      if (observation.effectiveDateTime && !isValidDateTime(observation.effectiveDateTime)) {
        warn(
          warnings,
          'observation.invalid-date',
          'warning',
          `Invalid effectiveDateTime "${observation.effectiveDateTime}".`,
          resource,
          'effectiveDateTime',
        );
      }
      if (!observation.code?.text && !observation.code?.coding?.length) {
        warn(
          warnings,
          'observation.missing-code',
          'warning',
          'Observation has no coded value.',
          resource,
          'code',
        );
      }
    }

    if (resource.resourceType === 'Encounter') {
      const period = (resource as { period?: { start?: string } }).period;
      if (period?.start && !isValidDateTime(period.start)) {
        warn(
          warnings,
          'encounter.invalid-period',
          'warning',
          `Invalid encounter period start "${period.start}".`,
          resource,
          'period.start',
        );
      }
    }

    if (resource.resourceType === 'DocumentReference') {
      const doc = resource as {
        description?: string;
        content?: { attachment?: { contentType?: string } }[];
      };
      if (!doc.description) {
        warn(
          warnings,
          'document.missing-description',
          'warning',
          'DocumentReference has no description.',
          resource,
          'description',
        );
      }
      if (!doc.content?.length) {
        warn(
          warnings,
          'document.no-content',
          'info',
          'DocumentReference carries no content payload; only metadata is used.',
          resource,
          'content',
        );
      }
    }
  }

  return warnings;
}

/** Detect records that claim to be synthetic, so provenance can be surfaced. */
export function extractProvenance(bundle: RawBundle): {
  tags: string[];
  isSynthetic: boolean;
  sources: string[];
} {
  const tags: string[] = [];
  const sources: string[] = [];
  let isSynthetic = false;

  const collectTags = (meta: { tag?: { code?: string; display?: string }[] } | undefined): void => {
    for (const tag of meta?.tag ?? []) {
      const label = tag.display ?? tag.code ?? '';
      if (label) tags.push(label);
      if ((tag.code ?? '').toUpperCase() === 'SYNTHETIC') isSynthetic = true;
    }
  };

  collectTags(bundle.meta);
  for (const entry of bundle.entry ?? []) {
    collectTags(entry?.resource?.meta);
    if (entry?.resource?.meta?.source) sources.push(entry.resource.meta.source);
  }

  return { tags, isSynthetic, sources: [...new Set(sources)] };
}
