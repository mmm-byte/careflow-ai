import test from 'node:test';
import assert from 'node:assert/strict';

import { validateDecisionShape, WORKFLOW_LABELS } from './types.ts';

test('workflow labels use kebab-case ids', () => {
  assert.deepEqual([...WORKFLOW_LABELS], ['priority', 'follow-up', 'routine']);
});

test('decision schema rejects an unknown label', () => {
  const result = validateDecisionShape({
    label: 'followup',
    confidence: 0.8,
    scores: [],
    rationale: 'x',
  });
  assert.equal(result.ok, false);
});

test('decision schema rejects out-of-range confidence', () => {
  const result = validateDecisionShape({
    label: 'routine',
    confidence: 1.4,
    scores: [],
    rationale: 'x',
  });
  assert.equal(result.ok, false);
});

test('decision schema rejects a non-numeric score', () => {
  const result = validateDecisionShape({
    label: 'routine',
    confidence: 0.5,
    scores: [{ label: 'routine', score: 'high' }],
    rationale: 'x',
  });
  assert.equal(result.ok, false);
});

test('decision schema accepts a well-formed decision', () => {
  const result = validateDecisionShape({
    label: 'follow-up',
    confidence: 0.7,
    scores: [{ label: 'follow-up', score: 0.7 }],
    rationale: 'matched follow-up signals',
  });
  assert.equal(result.ok, true);
});
