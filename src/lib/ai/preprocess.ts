/**
 * Text normalization shared by the two classification engines.
 *
 * The embedding model and the deterministic rules engine consume different
 * views of the same record:
 *
 *  - the **rules engine** wants the literal wording, because a phrase match
 *    must be auditable and must quote the source text back to the reviewer;
 *  - the **embedding model** wants a cleaned, expanded view, because a stray
 *    brace or a terse abbreviation changes the meaning of an otherwise
 *    ordinary sentence.
 *
 * Normalization is therefore split into three independent, individually
 * testable steps, and each engine opts into the steps it needs.
 *
 * Every transformation here is lossless enough to be explained in the
 * Decision Inspector: the UI shows the normalized text next to the raw
 * record so a reviewer can see exactly what the model saw.
 */

/**
 * Clinical abbreviations expanded before embedding.
 *
 * The expansion table is intentionally small and high-frequency. Each entry
 * is a genuine shorthand found in the synthetic corpus; the map is applied
 * case-insensitively and only on whole-token boundaries so "afib" is expanded
 * but "afternoon" is not.
 */
export const ABBREVIATIONS: Record<string, string> = {
  pt: 'patient',
  pts: 'patients',
  resp: 'respiratory',
  'resp distress': 'respiratory distress',
  sob: 'shortness of breath',
  'w/': 'with',
  'w/o': 'without',
  'h/o': 'history of',
  hx: 'history',
  pmh: 'past medical history',
  afib: 'atrial fibrillation',
  af: 'atrial fibrillation',
  chf: 'congestive heart failure',
  copd: 'chronic obstructive pulmonary disease',
  ckd: 'chronic kidney disease',
  dka: 'diabetic ketoacidosis',
  uti: 'urinary tract infection',
  'f/u': 'follow-up',
  fu: 'follow-up',
  rvu: 'review',
  rx: 'prescription',
  'pt/ot': 'physical therapy and occupational therapy',
  md: 'doctor',
  dr: 'doctor',
  rn: 'nurse',
  np: 'nurse practitioner',
  stat: 'immediately',
  'a&o': 'alert and oriented',
  'e/o': 'examination of',
  'r/o': 'rule out',
  's/p': 'status post',
  'w/in': 'within',
  'd/c': 'discharge',
  qhs: 'every night',
  po: 'by mouth',
  prn: 'as needed',
  'b/p': 'blood pressure',
  hr: 'heart rate',
  rr: 'respiratory rate',
  spo2: 'oxygen saturation',
  bmi: 'body mass index',
  cna: 'care assistant',
  hcw: 'healthcare worker',
  ecg: 'electrocardiogram',
  ekg: 'electrocardiogram',
  cbc: 'complete blood count',
  abg: 'arterial blood gas',
};

/**
 * Repair text that was decoded with the wrong character encoding.
 *
 * The synthetic corpus deliberately includes a mojibake case: bytes that were
 * meant to be "£" or an em dash arrive as "Â£" and "Â€”". Left alone those
 * characters push the embedding away from every clinical prototype and
 * provide no signal to the rules engine.
 */
export function repairEncoding(text: string): string {
  return (
    text
      // Strip the classic UTF-8-as-Latin-1 prefix.
      .replace(/Â/g, '')
      // Mojibake punctuation.
      .replace(/[“”„]/g, '"')
      .replace(/[‘’‚]/g, "'")
      .replace(/[–—]/g, '-')
      .replace(/…/g, '...')
      // Collapse whitespace left behind by the replacements.
      .replace(/[ \t]{2,}/g, ' ')
  );
}

/**
 * Remove the formatting noise that appears in malformed records.
 *
 * Only characters that carry no clinical meaning are touched: braces,
 * angle brackets, stray caret and pipe characters, and excessive runs of
 * punctuation. Digits, letters and clinical punctuation are preserved.
 */
export function stripFormattingNoise(text: string): string {
  return text
    .replace(/[{}\[\]<>|^~`]/g, ' ')
    .replace(/(?:\?{2,}|!{2,}|\.{4,}|,{2,}|;{2,})/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Expand clinical abbreviations on whole-token boundaries.
 *
 * Longer entries are applied first so "a&o" wins over the single letter
 * "a", and multi-word entries such as "resp distress" win over "resp".
 */
export function expandAbbreviations(text: string): string {
  const entries = Object.entries(ABBREVIATIONS).sort((a, b) => b[0].length - a[0].length);
  let result = text;
  for (const [abbreviation, expansion] of entries) {
    const escaped = abbreviation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, 'gi');
    result = result.replace(pattern, expansion);
  }
  return result.replace(/\s{2,}/g, ' ').trim();
}

/**
 * Remove a phrase from a string, keeping the surrounding wording intact.
 * Used to strip negated trigger phrases out of the model input.
 */
function removePhrase(text: string, phrase: string): string {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\b${escaped}\\b`, 'gi');
  return text.replace(pattern, ' ').replace(/\s{2,}/g, ' ');
}

/**
 * Mask negated clinical trigger phrases.
 *
 * A negated mention of a serious symptom ("chest pain ruled out") is
 * evidence *against* escalation, but an embedding model has no way to know
 * that: "chest pain" sits much closer to the priority prototype than to any
 * routine phrasing. The rules engine handles negation properly through
 * clause-scoped analysis, so it keeps the original wording.
 *
 * The model receives the text with the negated trigger phrases removed. The
 * negated wording itself is preserved elsewhere in the record, so the
 * reviewer still sees the complete sentence in the Decision Inspector.
 *
 * @param text Text to mask.
 * @param negatedPhrases Trigger phrases that were found in a negated context.
 */
export function maskNegatedPhrases(text: string, negatedPhrases: string[]): string {
  // Longest first, so "chest pain" is removed before a shorter overlapping hit.
  const ordered = [...new Set(negatedPhrases)].sort((a, b) => b.length - a.length);
  let result = text;
  for (const phrase of ordered) {
    result = removePhrase(result, phrase);
  }
  return result.replace(/\s{2,}/g, ' ').trim();
}

export interface ModelPreprocessInput {
  text: string;
  /** Trigger phrases that appeared only in a negated context. */
  negatedPhrases: string[];
  /** When false, abbreviations are left untouched. */
  expandAbbreviations?: boolean;
}

/**
 * Build the text the embedding model actually embeds.
 *
 * Pipeline: repair encoding -> strip formatting noise -> expand abbreviations
 * -> mask negated trigger phrases.
 */
export function preprocessForModel(input: ModelPreprocessInput): string {
  let text = repairEncoding(input.text);
  text = stripFormattingNoise(text);
  if (input.expandAbbreviations !== false) {
    text = expandAbbreviations(text);
  }
  text = maskNegatedPhrases(text, input.negatedPhrases);
  return text;
}

/**
 * Build the text the rules engine reads.
 *
 * The rules engine matches literal phrases and must be able to quote them
 * back to the reviewer, so the wording is preserved. Only clearly
 * non-semantic repairs are applied: encoding repair and formatting noise.
 */
export function preprocessForRules(text: string): string {
  return stripFormattingNoise(repairEncoding(text));
}
