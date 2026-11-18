import test from 'node:test';
import assert from 'node:assert/strict';

import { combineSegmentScores, SEGMENT_MARGIN, splitIntoSegments } from './segments.ts';

test('a record is split at sentence boundaries', () => {
  const segments = splitIntoSegments(
    'Observations are stable and within normal range. However the resident reports chest pain.',
  );
  assert.ok(segments.length >= 2);
  assert.ok(segments.some((segment) => segment.includes('chest pain')));
});

test('the whole record is always included as a segment', () => {
  const text = 'One short.';
  const segments = splitIntoSegments(text);
  assert.ok(segments.some((segment) => segment.includes('One short')));
});

test('very short fragments are discarded as carrying no signal', () => {
  const segments = splitIntoSegments('Ok. This is a sufficiently long statement about care.');
  assert.equal(
    segments.some((segment) => segment.trim() === 'Ok.'),
    false,
  );
});

test('a segment only outranks the whole record by the configured margin', () => {
  assert.equal(combineSegmentScores(0.5, 0.5), 0.5);
  assert.equal(combineSegmentScores(0.5, 0.6), 0.6 - SEGMENT_MARGIN);
  assert.equal(combineSegmentScores(0.5, 0.55), 0.5);
});
