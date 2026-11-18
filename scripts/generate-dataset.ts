/**
 * Generate the curated synthetic FHIR R4 demonstration bundle.
 *
 * Run with:  npm run generate:dataset
 *
 * All records are synthetic. Names, identifiers, dates and measurements are
 * fabricated for demonstration and must never be replaced with real data.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(here, '..', 'public', 'data', 'fhir-bundle.json');

type Json = Record<string, unknown>;

const SYNTHETIC_SYSTEM = 'https://careflow.demo/data-classification';

function meta(source: string): Json {
  return {
    versionId: '1',
    lastUpdated: '2026-11-17T09:00:00-06:00',
    source,
    tag: [{ system: SYNTHETIC_SYSTEM, code: 'SYNTHETIC', display: 'SYNTHETIC' }],
  };
}

interface ResidentSpec {
  id: string;
  given: string;
  family: string;
  birthDate: string;
  gender: 'female' | 'male' | 'other' | 'unknown';
  encounterReason: string;
  encounterStatus: string;
  encounterStart: string;
  observations: {
    code: string;
    loinc: string;
    value: number;
    unit: string;
    effective: string;
    interpretation?: string;
    referenceLow?: number;
    referenceHigh?: number;
  }[];
  notes: { id: string; description: string; date: string; contentType: string; title: string }[];
  carePlan?: {
    id: string;
    title: string;
    created: string;
    activities: { status: string; description: string; start?: string }[];
  };
  tasks?: {
    id: string;
    status: string;
    intent: string;
    description: string;
    priority: string;
    dueDate?: string;
    authoredOn: string;
  }[];
  appointments?: { id: string; status: string; description: string; start: string; end: string }[];
}

const RESIDENTS: ResidentSpec[] = [
  {
    id: 'p-1001',
    given: 'Margaret',
    family: 'Wilson',
    birthDate: '1938-04-12',
    gender: 'female',
    encounterReason: 'Routine blood pressure review',
    encounterStatus: 'finished',
    encounterStart: '2026-11-15T10:00:00-06:00',
    observations: [
      {
        code: 'Systolic blood pressure',
        loinc: '8480-6',
        value: 164,
        unit: 'mmHg',
        effective: '2026-11-15T10:14:00-06:00',
        interpretation: 'High',
        referenceLow: 90,
        referenceHigh: 140,
      },
      {
        code: 'Diastolic blood pressure',
        loinc: '8462-4',
        value: 88,
        unit: 'mmHg',
        effective: '2026-11-15T10:16:00-06:00',
        referenceLow: 60,
        referenceHigh: 90,
      },
      {
        code: 'Heart rate',
        loinc: '8867-4',
        value: 78,
        unit: 'beats/min',
        effective: '2026-11-15T10:17:00-06:00',
        referenceLow: 60,
        referenceHigh: 100,
      },
    ],
    notes: [
      {
        id: 'd-1001',
        description:
          'Synthetic note: resident reports a mild headache this morning and blood pressure measured markedly elevated at 164/88. Same-day clinician review requested to reassess antihypertensive therapy.',
        date: '2026-11-15T10:40:00-06:00',
        contentType: 'text/plain',
        title: 'Primary care progress note',
      },
    ],
    carePlan: {
      id: 'cp-1001',
      title: 'Hypertension monitoring plan',
      created: '2026-02-03T14:00:00-06:00',
      activities: [
        {
          status: 'in-progress',
          description: 'Review blood pressure trend and arrange clinician follow-up',
          start: '2026-11-16T09:00:00-06:00',
        },
      ],
    },
    appointments: [
      {
        id: 'a-1001',
        status: 'booked',
        description: 'Same-day clinician review of elevated blood pressure',
        start: '2026-11-15T15:00:00-06:00',
        end: '2026-11-15T15:30:00-06:00',
      },
    ],
  },
  {
    id: 'p-1002',
    given: 'Robert',
    family: 'James',
    birthDate: '1942-09-03',
    gender: 'male',
    encounterReason: 'Medication review',
    encounterStatus: 'finished',
    encounterStart: '2026-11-14T13:30:00-06:00',
    observations: [
      {
        code: 'Weight',
        loinc: '29463-7',
        value: 88.4,
        unit: 'kg',
        effective: '2026-11-14T13:35:00-06:00',
        referenceLow: 55,
        referenceHigh: 95,
      },
    ],
    notes: [
      {
        id: 'd-1002',
        description:
          'Synthetic note: resident reports dizziness after medication change; follow-up scheduling requested within seven days.',
        date: '2026-11-14T14:05:00-06:00',
        contentType: 'text/plain',
        title: 'Medication review note',
      },
    ],
    carePlan: {
      id: 'cp-1002',
      title: 'Antihypertensive therapy review',
      created: '2026-10-28T11:00:00-06:00',
      activities: [
        {
          status: 'scheduled',
          description: 'Recheck postural blood pressure and review dizziness after dose change',
          start: '2026-11-21T09:00:00-06:00',
        },
      ],
    },
  },
  {
    id: 'p-1003',
    given: 'Helen',
    family: 'Martinez',
    birthDate: '1935-01-28',
    gender: 'female',
    encounterReason: 'Annual wellness visit',
    encounterStatus: 'finished',
    encounterStart: '2026-11-12T09:15:00-06:00',
    observations: [
      {
        code: 'Body temperature',
        loinc: '8310-5',
        value: 36.7,
        unit: '°C',
        effective: '2026-11-12T09:20:00-06:00',
        referenceLow: 36,
        referenceHigh: 37.5,
      },
    ],
    notes: [
      {
        id: 'd-1003',
        description:
          'Synthetic note: annual wellness visit completed. No urgent concerns. Routine care-plan review remains open.',
        date: '2026-11-12T09:45:00-06:00',
        contentType: 'text/plain',
        title: 'Annual wellness summary',
      },
    ],
    carePlan: {
      id: 'cp-1003',
      title: 'Annual wellness care plan',
      created: '2026-01-15T10:00:00-06:00',
      activities: [
        {
          status: 'scheduled',
          description: 'Routine annual care-plan review with primary care team',
          start: '2026-12-02T09:00:00-06:00',
        },
      ],
    },
  },
  {
    id: 'p-1004',
    given: 'Arthur',
    family: 'Okafor',
    birthDate: '1929-11-30',
    gender: 'male',
    encounterReason: 'Post-fall observation',
    encounterStatus: 'finished',
    encounterStart: '2026-11-17T07:20:00-06:00',
    observations: [
      {
        code: 'Oxygen saturation',
        loinc: '2708-6',
        value: 91,
        unit: '%',
        effective: '2026-11-17T07:25:00-06:00',
        interpretation: 'Low',
        referenceLow: 92,
        referenceHigh: 100,
      },
      {
        code: 'Respiratory rate',
        loinc: '9279-1',
        value: 24,
        unit: 'breaths/min',
        effective: '2026-11-17T07:26:00-06:00',
        interpretation: 'High',
        referenceLow: 12,
        referenceHigh: 20,
      },
    ],
    notes: [
      {
        id: 'd-1004',
        description:
          'Synthetic note: resident found on floor in the early morning. Appears acutely unwell and short of breath on exertion. Escalated for urgent clinician assessment this morning.',
        date: '2026-11-17T07:35:00-06:00',
        contentType: 'text/plain',
        title: 'Incident note',
      },
    ],
    tasks: [
      {
        id: 't-1004',
        status: 'requested',
        intent: 'order',
        description: 'Escalate for same-day urgent clinician assessment',
        priority: 'urgent',
        dueDate: '2026-11-17T12:00:00-06:00',
        authoredOn: '2026-11-17T07:36:00-06:00',
      },
    ],
  },
  {
    id: 'p-1005',
    given: 'Yuki',
    family: 'Tanaka',
    birthDate: '1940-06-21',
    gender: 'female',
    encounterReason: 'Routine pharmacy reconciliation',
    encounterStatus: 'finished',
    encounterStart: '2026-11-13T11:00:00-06:00',
    observations: [
      {
        code: 'Serum creatinine',
        loinc: '2160-0',
        value: 78,
        unit: 'µmol/L',
        effective: '2026-11-13T11:10:00-06:00',
        referenceLow: 45,
        referenceHigh: 90,
      },
    ],
    notes: [
      {
        id: 'd-1005',
        description:
          'Synthetic note: resident denies dizziness, denies falls and reports no concerns today. Prescription renewal to be arranged by the pharmacy team within seven days.',
        date: '2026-11-13T11:30:00-06:00',
        contentType: 'text/plain',
        title: 'Pharmacy reconciliation note',
      },
    ],
    carePlan: {
      id: 'cp-1005',
      title: 'Chronic medication management',
      created: '2026-09-10T08:30:00-06:00',
      activities: [
        {
          status: 'scheduled',
          description: 'Prescription renewal review',
          start: '2026-11-24T08:30:00-06:00',
        },
      ],
    },
  },
  {
    id: 'p-1006',
    given: 'Ingrid',
    family: 'Bergstrom',
    birthDate: '1937-03-07',
    gender: 'female',
    encounterReason: 'Resident conference',
    encounterStatus: 'finished',
    encounterStart: '2026-11-10T15:00:00-06:00',
    observations: [],
    notes: [
      {
        id: 'd-1006',
        description:
          'Synthetic note: daughter raised concerns about declining oral intake. Nutritional monitoring requested and dietitian referral to follow up.',
        date: '2026-11-10T15:40:00-06:00',
        contentType: 'text/plain',
        title: 'Resident conference note',
      },
    ],
  },
  {
    id: 'p-1007',
    given: 'Samuel',
    family: 'Osei',
    birthDate: '1931-08-19',
    gender: 'male',
    encounterReason: 'Wound check',
    encounterStatus: 'finished',
    encounterStart: '2026-11-16T08:45:00-06:00',
    observations: [
      {
        code: 'Body weight',
        loinc: '29463-7',
        value: 71.2,
        unit: 'kg',
        effective: '2026-11-16T08:50:00-06:00',
      },
    ],
    notes: [
      {
        id: 'd-1007',
        description:
          'Synthetic note: surgical wound site dry and intact, no erythema, no drainage. Suture removal due in ten days; scheduling assistance requested.',
        date: '2026-11-16T09:05:00-06:00',
        contentType: 'text/plain',
        title: 'Wound assessment note',
      },
    ],
    tasks: [
      {
        id: 't-1007',
        status: 'requested',
        intent: 'order',
        description: 'Schedule suture removal appointment within ten days',
        priority: 'routine',
        dueDate: '2026-11-26T12:00:00-06:00',
        authoredOn: '2026-11-16T09:06:00-06:00',
      },
    ],
  },
];

function buildBundle(): Json {
  const entry: Json[] = [];

  for (const resident of RESIDENTS) {
    entry.push({
      resource: {
        resourceType: 'Patient',
        id: resident.id,
        meta: meta('https://careflow.demo/synthetic-generator'),
        identifier: [
          {
            system: 'https://careflow.demo/mrn',
            value: `SYN-${resident.id.toUpperCase()}`,
            use: 'usual',
          },
        ],
        name: [{ use: 'official', given: [resident.given], family: resident.family }],
        birthDate: resident.birthDate,
        gender: resident.gender,
        active: true,
      },
    });

    const encounterId = `e-${resident.id.slice(2)}`;
    entry.push({
      resource: {
        resourceType: 'Encounter',
        id: encounterId,
        meta: meta('https://careflow.demo/synthetic-generator'),
        status: resident.encounterStatus,
        class: {
          system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
          code: 'AMB',
          display: 'ambulatory',
        },
        type: [{ text: resident.encounterReason }],
        subject: {
          reference: `Patient/${resident.id}`,
          display: `${resident.given} ${resident.family}`,
        },
        period: { start: resident.encounterStart, end: resident.encounterStart },
        reasonCode: [{ text: resident.encounterReason }],
        serviceProvider: {
          reference: 'Organization/o-careflow',
          display: 'CareFlow Demo Facility',
        },
      },
    });

    resident.observations.forEach((observation, index) => {
      entry.push({
        resource: {
          resourceType: 'Observation',
          id: `o-${resident.id.slice(2)}-${index + 1}`,
          meta: meta('https://careflow.demo/synthetic-generator'),
          status: 'final',
          category: [{ text: 'vital-signs' }],
          code: {
            coding: [
              { system: 'http://loinc.org', code: observation.loinc, display: observation.code },
            ],
            text: observation.code,
          },
          subject: { reference: `Patient/${resident.id}` },
          encounter: { reference: `Encounter/${encounterId}` },
          effectiveDateTime: observation.effective,
          issued: observation.effective,
          valueQuantity: {
            value: observation.value,
            unit: observation.unit,
            system: 'http://unitsofmeasure.org',
            code: observation.unit,
          },
          ...(observation.interpretation
            ? {
                interpretation: [
                  {
                    coding: [
                      {
                        system:
                          'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation',
                        code:
                          observation.interpretation === 'High'
                            ? 'H'
                            : observation.interpretation === 'Low'
                              ? 'L'
                              : 'N',
                        display: observation.interpretation,
                      },
                    ],
                    text: observation.interpretation,
                  },
                ],
              }
            : {}),
          ...(observation.referenceLow !== undefined || observation.referenceHigh !== undefined
            ? {
                referenceRange: [
                  {
                    ...(observation.referenceLow !== undefined
                      ? { low: { value: observation.referenceLow, unit: observation.unit } }
                      : {}),
                    ...(observation.referenceHigh !== undefined
                      ? { high: { value: observation.referenceHigh, unit: observation.unit } }
                      : {}),
                  },
                ],
              }
            : {}),
        },
      });
    });

    resident.notes.forEach((note) => {
      entry.push({
        resource: {
          resourceType: 'DocumentReference',
          id: note.id,
          meta: meta('https://careflow.demo/synthetic-generator'),
          status: 'current',
          type: { text: 'Clinical note' },
          subject: { reference: `Patient/${resident.id}` },
          date: note.date,
          author: [{ reference: 'Practitioner/pr-careflow' }],
          description: note.description,
          content: [
            {
              attachment: {
                contentType: note.contentType,
                title: note.title,
                url: `DocumentReference/${note.id}`,
              },
            },
          ],
          context: [
            {
              period: { start: note.date },
              encounter: [{ reference: `Encounter/${encounterId}` }],
            },
          ],
        },
      });
    });

    if (resident.carePlan) {
      entry.push({
        resource: {
          resourceType: 'CarePlan',
          id: resident.carePlan.id,
          meta: meta('https://careflow.demo/synthetic-generator'),
          status: 'active',
          intent: 'plan',
          title: resident.carePlan.title,
          description: `Synthetic care plan for ${resident.given} ${resident.family}.`,
          subject: { reference: `Patient/${resident.id}` },
          period: { start: resident.carePlan.created },
          created: resident.carePlan.created,
          activity: resident.carePlan.activities.map((activity) => ({
            detail: {
              status: activity.status,
              description: activity.description,
              ...(activity.start ? { scheduled: { start: activity.start } } : {}),
            },
          })),
          note: [{ authorString: 'CareFlow synthetic generator', text: 'Synthetic record.' }],
        },
      });
    }

    resident.tasks?.forEach((task) => {
      entry.push({
        resource: {
          resourceType: 'Task',
          id: task.id,
          meta: meta('https://careflow.demo/synthetic-generator'),
          status: task.status,
          intent: task.intent,
          priority: task.priority,
          description: task.description,
          code: { text: 'Care workflow task' },
          subject: { reference: `Patient/${resident.id}` },
          encounter: { reference: `Encounter/${encounterId}` },
          authoredOn: task.authoredOn,
          ...(task.dueDate ? { dueDate: task.dueDate } : {}),
          note: [{ authorString: 'CareFlow synthetic generator', text: 'Synthetic record.' }],
        },
      });
    });

    resident.appointments?.forEach((appointment) => {
      entry.push({
        resource: {
          resourceType: 'Appointment',
          id: appointment.id,
          meta: meta('https://careflow.demo/synthetic-generator'),
          status: appointment.status,
          serviceType: [{ text: 'CareFlow follow-up' }],
          description: appointment.description,
          start: appointment.start,
          end: appointment.end,
          participant: [{ actor: { reference: `Patient/${resident.id}` }, status: 'accepted' }],
          reasonCode: [{ text: resident.encounterReason }],
        },
      });
    });
  }

  entry.push({
    resource: {
      resourceType: 'Organization',
      id: 'o-careflow',
      meta: meta('https://careflow.demo/synthetic-generator'),
      name: 'CareFlow Demo Facility',
      active: true,
    },
  });

  entry.push({
    resource: {
      resourceType: 'Practitioner',
      id: 'pr-careflow',
      meta: meta('https://careflow.demo/synthetic-generator'),
      name: [{ use: 'official', given: ['Demo'], family: 'Clinician' }],
      active: true,
    },
  });

  entry.push({
    resource: {
      resourceType: 'Provenance',
      id: 'prov-bundle',
      meta: meta('https://careflow.demo/synthetic-generator'),
      target: [{ reference: 'Bundle/synthetic' }],
      recorded: '2026-11-17T09:00:00-06:00',
      activity: {
        coding: [
          { system: 'http://terminology.hl7.org/CodeSystem/v3-DataOperationType', code: 'CREATE' },
        ],
        text: 'Synthetic bundle generated for demonstration',
      },
      agent: [{ type: { text: 'author' }, who: { display: 'CareFlow synthetic generator' } }],
      entity: [{ role: 'source', what: { display: 'scripts/generate-dataset.ts' } }],
    },
  });

  return {
    resourceType: 'Bundle',
    id: 'synthetic',
    type: 'collection',
    meta: {
      ...meta('https://careflow.demo/synthetic-generator'),
      tag: [{ system: SYNTHETIC_SYSTEM, code: 'SYNTHETIC', display: 'SYNTHETIC' }],
    },
    entry,
  };
}

const bundle = buildBundle();
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');

const entries = Array.isArray(bundle.entry) ? bundle.entry : [];
const resourceCount = entries.length;
console.log(`Wrote ${outputPath} with ${resourceCount} entries.`);
