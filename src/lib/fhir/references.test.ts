import test from 'node:test';
import assert from 'node:assert/strict';

import { buildResourceGraph, buildTimeline, extractReferences } from './references.ts';
import type { FhirResourceBase, Resident } from './types.ts';

const RESOURCES: FhirResourceBase[] = [
  { resourceType: 'Patient', id: 'p-1', name: [{ family: 'Test' }] },
  {
    resourceType: 'Observation',
    id: 'o-1',
    subject: { reference: 'Patient/p-1' },
    encounter: { reference: 'Encounter/e-1' },
  },
  { resourceType: 'Encounter', id: 'e-1', subject: { reference: 'Patient/p-1' } },
];

test('references are extracted from nested fields', () => {
  const references = extractReferences(RESOURCES[1]);
  const fields = references.map((reference) => reference.field).sort();
  assert.deepEqual(fields, ['encounter', 'subject']);
});

test('the resource graph resolves inbound and outbound references', () => {
  const graph = buildResourceGraph(RESOURCES);
  const inbound = graph.inbound.get('Patient/p-1') ?? [];
  assert.equal(inbound.length, 2);
  assert.ok(inbound.every((reference) => reference.resolved));
});

test('an unresolvable reference is marked as unresolved', () => {
  const graph = buildResourceGraph([
    { resourceType: 'Observation', id: 'o-2', subject: { reference: 'Patient/missing' } },
  ] as FhirResourceBase[]);
  const inbound = graph.inbound.get('Patient/missing') ?? [];
  assert.equal(inbound.length, 1);
  assert.equal(inbound[0].resolved, false);
});

test('the timeline merges resource types and sorts newest first', () => {
  const resident: Resident = {
    id: 'p-1',
    name: 'Test Resident',
    givenName: 'Test',
    familyName: 'Resident',
    birthDate: null,
    gender: null,
    ageYears: null,
    identifiers: [],
    encounters: [
      {
        id: 'e-1',
        startedAt: '2026-01-02T00:00:00Z',
        endedAt: null,
        reason: 'Check-up',
        status: 'finished',
        type: null,
        resourceType: 'Encounter',
      },
    ],
    observations: [
      {
        id: 'o-1',
        label: 'BP',
        value: 120,
        unit: 'mmHg',
        displayValue: '120/80',
        effectiveAt: '2026-01-03T00:00:00Z',
        status: 'final',
        interpretation: null,
        referenceRange: null,
        note: null,
        resourceType: 'Observation',
      },
    ],
    documents: [],
    tasks: [],
    appointments: [],
    warnings: [],
    sourceResourceIds: ['p-1', 'e-1', 'o-1'],
  };

  const timeline = buildTimeline(resident);
  assert.equal(timeline.length, 2);
  assert.equal(timeline[0].kind, 'Observation');
});

test('a Provenance target pointing at the enclosing bundle resolves', () => {
  // The bundle is not an entry in itself, so this reference needs the bundle
  // id to resolve rather than being reported as an orphan.
  const provenance: FhirResourceBase = {
    resourceType: 'Provenance',
    id: 'prov-1',
    target: [{ reference: 'Bundle/synthetic' }],
  };

  const withoutBundleId = buildResourceGraph([provenance]);
  assert.equal((withoutBundleId.inbound.get('Bundle/synthetic') ?? [])[0].resolved, false);

  const withBundleId = buildResourceGraph([provenance], 'synthetic');
  assert.equal((withBundleId.inbound.get('Bundle/synthetic') ?? [])[0].resolved, true);
});
