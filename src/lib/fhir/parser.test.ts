import test from 'node:test';
import assert from 'node:assert/strict';

import { parseBundle, parseBundleJson, ageFromBirthDate } from './parser.ts';
import type { FhirResourceBase, RawBundle } from './types.ts';

function bundleOf(resources: unknown[]): RawBundle {
  return {
    resourceType: 'Bundle',
    type: 'collection',
    entry: resources.map((resource) => ({ resource: resource as FhirResourceBase })),
  };
}

const PATIENT = {
  resourceType: 'Patient',
  id: 'p-1',
  name: [{ given: ['Ada'], family: 'Lovelace' }],
  birthDate: '1939-12-10',
  gender: 'female',
};

test('parses a patient with related resources', () => {
  const bundle = bundleOf([
    PATIENT,
    {
      resourceType: 'Observation',
      id: 'o-1',
      status: 'final',
      subject: { reference: 'Patient/p-1' },
      code: { text: 'Systolic blood pressure' },
      valueQuantity: { value: 164, unit: 'mmHg' },
      effectiveDateTime: '2026-11-15T10:14:00-06:00',
    },
    {
      resourceType: 'DocumentReference',
      id: 'd-1',
      status: 'current',
      subject: { reference: 'Patient/p-1' },
      description: 'Synthetic note: medication review requested.',
      date: '2026-11-15T11:00:00-06:00',
    },
  ]);

  const { residents } = parseBundle(bundle);
  assert.equal(residents.length, 1);
  const resident = residents[0];
  assert.equal(resident.name, 'Ada Lovelace');
  assert.equal(resident.observations.length, 1);
  assert.equal(resident.observations[0].displayValue, '164 mmHg');
  assert.equal(resident.documents.length, 1);
});

test('resources without a patient reference are reported as orphans, not dropped', () => {
  const bundle = bundleOf([
    PATIENT,
    {
      resourceType: 'Observation',
      id: 'o-orphan',
      status: 'final',
      code: { text: 'Weight' },
      valueQuantity: { value: 80, unit: 'kg' },
    },
  ]);

  const { residents, orphans, warnings } = parseBundle(bundle);
  assert.equal(residents.length, 1);
  assert.equal(orphans.length, 1);
  assert.ok(warnings.some((w) => w.code === 'resource.no-subject'));
});

test('a reference to an unknown patient produces an unresolved-reference warning', () => {
  const bundle = bundleOf([
    PATIENT,
    {
      resourceType: 'Observation',
      id: 'o-x',
      status: 'final',
      subject: { reference: 'Patient/does-not-exist' },
      code: { text: 'Heart rate' },
      valueQuantity: { value: 70, unit: 'bpm' },
    },
  ]);

  const { warnings } = parseBundle(bundle);
  assert.ok(warnings.some((w) => w.code === 'reference.unresolved'));
});

test('an empty bundle yields no residents and a warning', () => {
  const { residents, warnings } = parseBundle({
    resourceType: 'Bundle',
    type: 'collection',
    entry: [],
  });
  assert.equal(residents.length, 0);
  assert.ok(warnings.some((w) => w.code === 'bundle.empty'));
});

test('a bundle with no entry array is handled without throwing', () => {
  const { residents, warnings } = parseBundle({ resourceType: 'Bundle' });
  assert.equal(residents.length, 0);
  assert.ok(warnings.some((w) => w.code === 'bundle.empty'));
});

test('malformed JSON is reported as an error rather than thrown', () => {
  const { result, error } = parseBundleJson('{ not json');
  assert.equal(result, null);
  assert.ok(error);
});

test('a non-object payload is reported as an error', () => {
  const { result, error } = parseBundleJson('42');
  assert.equal(result, null);
  assert.ok(error);
});

test('a patient with no name is flagged and given a placeholder', () => {
  const bundle = bundleOf([{ resourceType: 'Patient', id: 'p-2', birthDate: '1950-01-01' }]);
  const { residents } = parseBundle(bundle);
  assert.equal(residents[0].name, 'Unnamed resident');
  assert.ok(residents[0].warnings.some((w) => w.code === 'patient.anonymous'));
});

test('an invalid birth date is flagged and produces a null birth date', () => {
  const bundle = bundleOf([
    { resourceType: 'Patient', id: 'p-3', name: [{ family: 'Test' }], birthDate: '1939-02-31' },
  ]);
  const { residents, warnings } = parseBundle(bundle);
  assert.equal(residents[0].birthDate, null);
  assert.ok(warnings.some((w) => w.code === 'patient.invalid-birthdate'));
});

test('duplicate resource ids are flagged', () => {
  const bundle = bundleOf([PATIENT, PATIENT]);
  const { warnings } = parseBundle(bundle);
  assert.ok(warnings.some((w) => w.code === 'resource.duplicate-id'));
});

test('an observation without a value is flagged', () => {
  const bundle = bundleOf([
    PATIENT,
    {
      resourceType: 'Observation',
      id: 'o-novalue',
      status: 'final',
      subject: { reference: 'Patient/p-1' },
      code: { text: 'Weight' },
    },
  ]);
  const { warnings } = parseBundle(bundle);
  assert.ok(warnings.some((w) => w.code === 'observation.missing-value'));
});

test('age is computed from the birth date', () => {
  const age = ageFromBirthDate('2000-06-15', new Date('2026-11-17T00:00:00Z'));
  assert.equal(age, 26);
});

test('age is null for a missing or impossible birth date', () => {
  assert.equal(ageFromBirthDate(null), null);
  // A birth date in the future cannot yield a valid age.
  assert.equal(ageFromBirthDate('2030-01-01', new Date('2026-11-17T00:00:00Z')), null);
});
