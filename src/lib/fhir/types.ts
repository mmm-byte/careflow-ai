/**
 * Typed FHIR R4 resource shapes and normalized domain models.
 *
 * The original FHIR JSON is always preserved verbatim (see `RawBundle`). The
 * normalized types in this file are *views* over those resources used by the
 * workflow engine; they never replace the source data.
 */

export type FhirResourceType =
  | 'Bundle'
  | 'Patient'
  | 'Encounter'
  | 'Observation'
  | 'DocumentReference'
  | 'CarePlan'
  | 'Appointment'
  | 'Task'
  | 'Condition'
  | 'MedicationRequest'
  | 'Practitioner'
  | 'Organization'
  | 'Provenance';

export interface FhirCoding {
  system?: string;
  code?: string;
  display?: string;
}

export interface FhirCodeableConcept {
  coding?: FhirCoding[];
  text?: string;
}

export interface FhirReference {
  reference?: string;
  display?: string;
  type?: string;
}

export interface FhirQuantity {
  value?: number;
  unit?: string;
  system?: string;
  code?: string;
}

export interface FhirPeriod {
  start?: string;
  end?: string;
}

export interface FhirIdentifier {
  system?: string;
  value?: string;
  use?: string;
}

export interface FhirHumanName {
  use?: string;
  given?: string[];
  family?: string;
  text?: string;
  /** Period during which the name was used. */
  period?: FhirPeriod;
  /** Name that was officially assigned to the individual. */
  official?: boolean;
}

export interface FhirMeta {
  versionId?: string;
  lastUpdated?: string;
  profile?: string[];
  tag?: FhirCoding[];
  security?: FhirCoding[];
  source?: string;
}

export interface FhirAnnotation {
  authorString?: string;
  time?: string;
  text?: string;
}

export interface FhirResourceBase {
  resourceType: string;
  id?: string;
  meta?: FhirMeta;
  text?: { status?: string; div?: string };
  [key: string]: unknown;
}

export interface FhirPatient extends FhirResourceBase {
  resourceType: 'Patient';
  name?: FhirHumanName[];
  birthDate?: string;
  gender?: string;
  identifier?: FhirIdentifier[];
  active?: boolean;
}

export interface FhirEncounter extends FhirResourceBase {
  resourceType: 'Encounter';
  status?: string;
  class?: FhirCoding;
  type?: FhirCodeableConcept[];
  subject?: FhirReference;
  participant?: { individual?: FhirReference }[];
  period?: FhirPeriod;
  reasonCode?: FhirCodeableConcept[];
  serviceProvider?: FhirReference;
}

export interface FhirObservation extends FhirResourceBase {
  resourceType: 'Observation';
  status?: string;
  category?: FhirCodeableConcept[];
  code?: FhirCodeableConcept;
  subject?: FhirReference;
  encounter?: FhirReference;
  effectiveDateTime?: string;
  effectivePeriod?: FhirPeriod;
  issued?: string;
  valueQuantity?: FhirQuantity;
  valueString?: string;
  valueBoolean?: boolean;
  valueCodeableConcept?: FhirCodeableConcept;
  interpretation?: FhirCodeableConcept[];
  referenceRange?: { low?: FhirQuantity; high?: FhirQuantity; text?: string }[];
  note?: FhirAnnotation[];
}

export interface FhirDocumentReference extends FhirResourceBase {
  resourceType: 'DocumentReference';
  status?: string;
  type?: FhirCodeableConcept;
  subject?: FhirReference;
  date?: string;
  author?: FhirReference[];
  description?: string;
  content?: {
    attachment?: { contentType?: string; title?: string; url?: string; data?: string };
  }[];
  context?: { period?: FhirPeriod; encounter?: FhirReference[] }[];
}

export interface FhirActivity {
  detail?: {
    status?: string;
    description?: string;
    code?: FhirCodeableConcept;
    scheduled?: { start?: string; end?: string };
    statusReason?: FhirCodeableConcept;
  };
}

export interface FhirCarePlan extends FhirResourceBase {
  resourceType: 'CarePlan';
  status?: string;
  intent?: string;
  title?: string;
  description?: string;
  subject?: FhirReference;
  period?: FhirPeriod;
  created?: string;
  activity?: FhirActivity[];
  note?: FhirAnnotation[];
}

export interface FhirAppointment extends FhirResourceBase {
  resourceType: 'Appointment';
  status?: string;
  serviceType?: FhirCodeableConcept[];
  description?: string;
  start?: string;
  end?: string;
  participant?: { actor?: FhirReference; status?: string }[];
  reasonCode?: FhirCodeableConcept[];
}

export interface FhirTask extends FhirResourceBase {
  resourceType: 'Task';
  status?: string;
  intent?: string;
  description?: string;
  subject?: FhirReference;
  encounter?: FhirReference;
  authoredOn?: string;
  dueDate?: string;
  priority?: string;
  code?: FhirCodeableConcept;
  note?: FhirAnnotation[];
}

export interface FhirProvenance extends FhirResourceBase {
  resourceType: 'Provenance';
  target?: FhirReference[];
  recorded?: string;
  activity?: { coding?: FhirCoding[]; text?: string };
  agent?: { who?: FhirReference; onBehalfOf?: FhirReference; type?: FhirCodeableConcept }[];
  entity?: { role?: string; what?: FhirReference }[];
}

/** Verbatim parsed bundle. Nothing in the app mutates this structure. */
export interface RawBundle {
  resourceType: string;
  /** The bundle's own id. A `Provenance` resource targets the bundle itself. */
  id?: string;
  type?: string;
  meta?: FhirMeta;
  entry?: { resource?: FhirResourceBase }[];
}

export interface NormalizedObservation {
  id: string;
  label: string;
  value: number | null;
  unit: string;
  displayValue: string;
  effectiveAt: string | null;
  status: string | null;
  interpretation: string | null;
  referenceRange: string | null;
  note: string | null;
  resourceType: 'Observation';
}

export interface NormalizedEncounter {
  id: string;
  status: string | null;
  reason: string | null;
  startedAt: string | null;
  endedAt: string | null;
  type: string | null;
  resourceType: 'Encounter';
}

export interface NormalizedDocument {
  id: string;
  description: string;
  authoredAt: string | null;
  contentType: string | null;
  title: string | null;
  resourceType: 'DocumentReference';
}

export interface NormalizedTask {
  id: string;
  description: string;
  status: string | null;
  dueAt: string | null;
  scheduledStart: string | null;
  code: string | null;
  resourceType: 'CarePlan' | 'Task';
}

export interface NormalizedAppointment {
  id: string;
  description: string;
  status: string | null;
  startsAt: string | null;
  endsAt: string | null;
  resourceType: 'Appointment';
}

export interface DataQualityWarning {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  resourceType?: string;
  resourceId?: string;
  field?: string;
}

export interface Resident {
  id: string;
  name: string;
  givenName: string;
  familyName: string;
  birthDate: string | null;
  gender: string | null;
  ageYears: number | null;
  identifiers: string[];
  encounters: NormalizedEncounter[];
  observations: NormalizedObservation[];
  documents: NormalizedDocument[];
  tasks: NormalizedTask[];
  appointments: NormalizedAppointment[];
  warnings: DataQualityWarning[];
  /** Resource ids that contributed to this resident's view. */
  sourceResourceIds: string[];
}
