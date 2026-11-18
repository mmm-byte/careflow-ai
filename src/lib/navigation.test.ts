import test from 'node:test';
import assert from 'node:assert/strict';

import { resourceHash, targetFromHash, viewFromHash, VIEW_IDS } from './navigation.ts';

test('a plain hash resolves to its view', () => {
  for (const id of VIEW_IDS) {
    assert.equal(viewFromHash(`#${id}`), id);
  }
});

test('an unknown hash falls back to the dashboard', () => {
  assert.equal(viewFromHash('#nonsense'), 'dashboard');
  assert.equal(viewFromHash(''), 'dashboard');
  assert.equal(viewFromHash('#'), 'dashboard');
});

test('a hash can target a specific FHIR resource', () => {
  const target = targetFromHash('#fhir/Observation/o-1001');
  assert.equal(target.view, 'fhir');
  assert.equal(target.resourceKey, 'Observation/o-1001');
});

test('a view hash without a resource has no target', () => {
  const target = targetFromHash('#inspector');
  assert.equal(target.view, 'inspector');
  assert.equal(target.resourceKey, null);
});

test('a resource hash builds a link the explorer can read', () => {
  const hash = resourceHash('DocumentReference', 'd-1001');
  const target = targetFromHash(hash);
  assert.equal(target.view, 'fhir');
  assert.equal(target.resourceKey, 'DocumentReference/d-1001');
});
