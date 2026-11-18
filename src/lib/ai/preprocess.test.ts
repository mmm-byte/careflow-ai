import test from 'node:test';
import assert from 'node:assert/strict';

import {
  expandAbbreviations,
  maskNegatedPhrases,
  preprocessForModel,
  preprocessForRules,
  repairEncoding,
  stripFormattingNoise,
} from './preprocess.ts';

test('mojibake is repaired and the prose is left readable', () => {
  const repaired = repairEncoding('Â£Â£ urgent Â€” resident acutely unwell');
  assert.match(repaired, /urgent/);
  assert.match(repaired, /acutely unwell/);
  assert.equal(repaired.includes('Â'), false);
});

test('formatting noise is removed but clinical wording survives', () => {
  const cleaned = stripFormattingNoise('{{{ resident ))) stable ?? no urgent concerns');
  assert.equal(cleaned.includes('{'), false);
  assert.match(cleaned, /resident/);
  assert.match(cleaned, /stable/);
});

test('abbreviations are expanded on token boundaries only', () => {
  assert.match(expandAbbreviations('pt reports SOB w/ exertion'), /patient/);
  assert.match(expandAbbreviations('pt reports SOB w/ exertion'), /shortness of breath/);
  // "afternoon" must not be expanded by the "af" entry.
  assert.equal(expandAbbreviations('this afternoon').includes('atrial'), false);
});

test('a negated trigger phrase is masked out of the model input', () => {
  const masked = maskNegatedPhrases('chest pain ruled out. Symptoms stable.', ['chest pain']);
  assert.equal(masked.includes('chest pain'), false);
  assert.match(masked, /Symptoms stable/);
});

test('the rules text keeps the original wording so phrases can be quoted', () => {
  const text = 'Synthetic note: resident denies chest pain and reports no concerns today.';
  const rulesText = preprocessForRules(text);
  assert.match(rulesText, /chest pain/);
});

test('the model text repairs encoding, expands abbreviations and masks negations', () => {
  const text = 'Â€” pt reports SOB; chest pain ruled out.';
  const modelText = preprocessForModel({ text, negatedPhrases: ['chest pain'] });
  assert.equal(modelText.includes('chest pain'), false);
  assert.match(modelText, /shortness of breath/);
  assert.equal(modelText.includes('Â'), false);
});
