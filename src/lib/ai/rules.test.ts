import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyWithRules, findRuleHits, scoreWithRules } from './rules.ts';

test('priority signals outrank administrative follow-up signals', () => {
  const result = classifyWithRules(
    'Resident reported acute confusion and a fall. Family requests follow-up scheduling.',
  );
  assert.equal(result.label, 'priority');
});

test('follow-up language is classified as follow-up, not routine', () => {
  const result = classifyWithRules(
    'Medication review requested; follow-up scheduling needed within seven days.',
  );
  assert.equal(result.label, 'follow-up');
});

test('negated priority language does not escalate the record', () => {
  const result = classifyWithRules(
    'Synthetic note: annual wellness visit completed. No urgent concerns. Routine care-plan review remains open.',
  );
  assert.notEqual(result.label, 'priority');
});

test('negation in the same clause is detected', () => {
  const hits = findRuleHits('Patient denies chest pain and reports no falls.');
  const negated = hits.filter((hit) => hit.negated).map((hit) => hit.phrase);
  assert.ok(
    negated.includes('chest pain'),
    `expected negated chest pain, got ${JSON.stringify(negated)}`,
  );
  assert.ok(negated.includes('fall'), `expected negated fall, got ${JSON.stringify(negated)}`);
});

test('an un-negated later statement still escalates', () => {
  const result = classifyWithRules(
    'No urgent concerns at the morning check. At 14:00 the resident became acutely unresponsive.',
  );
  assert.equal(result.label, 'priority');
});

test('routine text with no signals resolves to routine', () => {
  const result = classifyWithRules('Standard preventive visit. Everything stable and unchanged.');
  assert.equal(result.label, 'routine');
});

test('scores cover every workflow label and sum to one when signals exist', () => {
  const { scores } = scoreWithRules('urgent concern, medication review, annual wellness');
  assert.deepEqual(scores.map((score) => score.label).sort(), ['follow-up', 'priority', 'routine']);
  const total = scores.reduce((sum, score) => sum + score.score, 0);
  assert.ok(Math.abs(total - 1) < 1e-6, `expected scores to sum to 1, got ${total}`);
});

test('empty input yields a zero-weight routine result without throwing', () => {
  const result = classifyWithRules('');
  assert.equal(result.label, 'routine');
  assert.equal(result.hits.length, 0);
});

test('rationale names the matched phrases', () => {
  const result = classifyWithRules('Resident fell and appears acutely unwell.');
  assert.match(result.rationale, /"fell"/);
  assert.match(result.rationale, /"acutely"|"acute"/);
});
