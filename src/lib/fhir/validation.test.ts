import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractProvenance,
  isValidDateOnly,
  isValidDateTime,
  validateBundle,
} from './validation.ts';

test('valid ISO dates are accepted', () => {
  assert.equal(isValidDateOnly('2026-11-17'), true);
  assert.equal(isValidDateOnly('2026-02-31'), false);
  assert.equal(isValidDateOnly('17-11-2026'), false);
  assert.equal(isValidDateOnly('not-a-date'), false);
});

test('valid ISO datetimes are accepted', () => {
  assert.equal(isValidDateTime('2026-11-17T10:00:00-06:00'), true);
  assert.equal(isValidDateTime('2026-11-17T10:00:00Z'), true);
  assert.equal(isValidDateTime('2026-11-17'), true);
  assert.equal(isValidDateTime('tomorrow'), false);
});

test('a bundle with the wrong resource type is flagged', () => {
  const warnings = validateBundle({ resourceType: 'Patient' });
  assert.ok(warnings.some((w) => w.code === 'bundle.wrong-resource-type'));
});

test('an entry without a resource is flagged', () => {
  const warnings = validateBundle({
    resourceType: 'Bundle',
    entry: [{} as never],
  });
  assert.ok(warnings.some((w) => w.code === 'entry.missing-resource'));
});

test('a resource without an id is flagged as unreferenceable', () => {
  const warnings = validateBundle({
    resourceType: 'Bundle',
    entry: [{ resource: { resourceType: 'Observation' } }],
  });
  assert.ok(warnings.some((w) => w.code === 'resource.missing-id'));
});

test('an unsupported resource type is preserved and reported as informational', () => {
  const warnings = validateBundle({
    resourceType: 'Bundle',
    entry: [{ resource: { resourceType: 'Condition', id: 'c-1' } }],
  });
  assert.ok(warnings.some((w) => w.code === 'resource.unsupported-type'));
});

test('a directory resource is not reported as a data-quality problem', () => {
  const warnings = validateBundle({
    resourceType: 'Bundle',
    entry: [
      { resource: { resourceType: 'Organization', id: 'org-1' } },
      { resource: { resourceType: 'Practitioner', id: 'pr-1' } },
    ],
  });
  assert.equal(
    warnings.some((w) => w.code === 'resource.unsupported-type'),
    false,
  );
});

test('synthetic provenance is detected from the bundle tags', () => {
  const provenance = extractProvenance({
    resourceType: 'Bundle',
    meta: { tag: [{ system: 'https://careflow.demo/data-classification', code: 'SYNTHETIC' }] },
  });
  assert.equal(provenance.isSynthetic, true);
  assert.ok(provenance.tags.includes('SYNTHETIC'));
});
