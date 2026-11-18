import type { LabelScore, WorkflowLabel } from './types.ts';
import { LABEL_DEFINITIONS, LABEL_ORDER } from './types.ts';
import { expandAbbreviations } from './preprocess.ts';

/**
 * Deterministic safety rules engine.
 *
 * This is NOT an AI model. It is a transparent, auditable rules engine that
 * provides a dependable floor when the embedding model is unavailable and acts
 * as a second opinion for the model path. The two engines are kept strictly
 * separate so the UI can state which one produced a decision.
 *
 * Design notes:
 *  - Every match records the exact phrase that triggered it, so a reviewer can
 *    see the evidence rather than an opaque score.
 *  - Negated phrases ("no urgent concerns", "denies chest pain") must not
 *    escalate a resident. Each hit is checked for a negation in the preceding
 *    clause before it counts.
 */

export interface RuleHit {
  label: WorkflowLabel;
  phrase: string;
  /** The sentence the phrase was found in. */
  context: string;
  /** False when the phrase was negated (for example "no urgent concerns"). */
  negated: boolean;
}

export interface RulesResult {
  label: WorkflowLabel;
  scores: LabelScore[];
  hits: RuleHit[];
  rationale: string;
}

const NEGATION_TOKENS = [
  'no',
  'not',
  'without',
  'denies',
  'denied',
  'deny',
  'never',
  'absent',
  'free of',
  'ruled out',
  'none',
  'negative for',
  'resolved',
  'never had',
  'free from',
  'nothing',
  'nil',
];

/**
 * Connectors that break a negation's scope.
 *
 * "The resident has no falls and is acutely unwell" negates "falls", not
 * "acutely unwell". A contrastive connector between the negation and the
 * candidate phrase means the negation has already finished its work.
 */
const CONTRASTIVE_CONNECTORS = ['and', 'but', 'however', 'although', 'though', 'yet', 'but still'];

/**
 * Tokens that end the clause a negation can reach across.
 *
 * "no urgent concerns" negates "urgent", but "no falls, resident acutely
 * unwell" must not let the negation reach "acutely". A comma ends the
 * negation scope.
 */
const CLAUSE_BOUNDARY = /[,;:()]/;

/**
 * Maximum number of words allowed between a negation and the phrase it
 * negates.
 *
 * Two words is enough for "no evidence of acute deterioration" while
 * rejecting a negation that has drifted across the clause.
 */
const MAX_NEGATION_DISTANCE = 2;

/** Split text into sentences for clause-level negation analysis. */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?;])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

function wordsIn(text: string): string[] {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.replace(/[^\w'-]/g, '').toLowerCase())
    .filter(Boolean);
}

/**
 * Look for a negation token immediately preceding the phrase.
 *
 * The negation must be close to the phrase (at most
 * {@link MAX_NEGATION_DISTANCE} intervening words) and must not be separated
 * from it by a contrastive connector.
 */
function hasNegationBefore(beforeScope: string): boolean {
  const words = wordsIn(beforeScope);
  for (let i = words.length - 1; i >= 0; i -= 1) {
    const word = words[i];
    const pair = i > 0 ? `${words[i - 1]} ${word}` : word;
    if (NEGATION_TOKENS.includes(word) || NEGATION_TOKENS.includes(pair)) {
      // Count the words between the negation and the phrase.
      const distance = words.length - 1 - i;
      if (distance > MAX_NEGATION_DISTANCE) return false;
      const between = words.slice(i + 1);
      if (between.some((connector) => CONTRASTIVE_CONNECTORS.includes(connector))) return false;
      return true;
    }
  }
  return false;
}

/**
 * Look for a negation token immediately following the phrase.
 *
 * Trailing negation only reaches back one word. "Pain not reported" is a
 * denial; "bleeding that did not stop" is not - there the negation belongs
 * to "stop", not to "bleeding".
 */
function hasNegationAfter(afterScope: string): boolean {
  const words = wordsIn(afterScope);
  for (let i = 0; i < Math.min(words.length, 2); i += 1) {
    const word = words[i];
    const pair = i + 1 < words.length ? `${word} ${words[i + 1]}` : word;
    if (NEGATION_TOKENS.includes(word) || NEGATION_TOKENS.includes(pair)) return true;
  }
  return false;
}

/**
 * Decide whether a hit is negated.
 *
 * Negation can appear before the phrase ("no urgent concerns", "denies chest
 * pain") or after it ("falls not reported", "swelling absent"). The negation
 * scope is the enclosing clause: a comma, semicolon, colon or parenthesis
 * ends it, so "no falls, acutely unwell" still escalates.
 */
function isNegated(clause: string, matchIndex: number, matchLength: number): boolean {
  const lowerClause = clause.toLowerCase();
  const before = lowerClause.slice(0, matchIndex);
  const after = lowerClause.slice(matchIndex + matchLength);

  // Look back to the nearest clause boundary before the phrase.
  const boundaryMatch = [...before.matchAll(new RegExp(CLAUSE_BOUNDARY, 'g'))].pop();
  const beforeScope = boundaryMatch ? before.slice((boundaryMatch.index ?? 0) + 1) : before;

  // Look forward to the nearest clause boundary after the phrase.
  const afterBoundary = after.search(CLAUSE_BOUNDARY);
  const afterScope = afterBoundary === -1 ? after : after.slice(0, afterBoundary);

  return hasNegationBefore(beforeScope) || hasNegationAfter(afterScope);
}

/** Normalize a signal so hyphen and space variants match the same phrase. */
function normalizeForMatch(text: string): string {
  return text.toLowerCase().replace(/[-\u2010\u2011\u2012]/g, ' ');
}

export function findRuleHits(text: string): RuleHit[] {
  const normalizedText = normalizeForMatch(text);
  const hits: RuleHit[] = [];

  for (const label of LABEL_ORDER) {
    const definition = LABEL_DEFINITIONS[label];
    for (const signal of definition.ruleSignals) {
      const normalizedSignal = normalizeForMatch(signal);
      const index = normalizedText.indexOf(normalizedSignal);
      if (index === -1) continue;

      // Determine which sentence/clause the phrase belongs to.
      let context = '';
      let localIndex = index;
      for (const sentence of sentences(text)) {
        const clauseIndex = normalizeForMatch(sentence).indexOf(normalizedSignal);
        if (clauseIndex !== -1) {
          context = sentence;
          localIndex = clauseIndex;
          break;
        }
      }

      const matchLength = normalizedSignal.length;
      hits.push({
        label,
        phrase: signal,
        context: context || text.slice(Math.max(0, index - 40), index + matchLength + 40),
        negated: isNegated(context || text, localIndex, matchLength),
      });
    }

    // Regular-expression signals cover patterns a literal stem cannot
    // express, such as "A&O x3" or a respiratory rate written as a number.
    for (const pattern of definition.rulePatterns ?? []) {
      // The expression is shared state, so its lastIndex is reset before
      // every use. Without this, a second call would start from where the
      // previous one stopped.
      pattern.lastIndex = 0;
      const match = pattern.exec(text);
      if (!match) continue;
      const phrase = match[0].trim();
      if (phrase.length === 0) continue;

      let context = '';
      let localIndex = match.index;
      for (const sentence of sentences(text)) {
        pattern.lastIndex = 0;
        const sentenceMatch = pattern.exec(sentence);
        if (sentenceMatch) {
          context = sentence;
          localIndex = sentenceMatch.index;
          break;
        }
      }
      pattern.lastIndex = 0;

      hits.push({
        label,
        phrase,
        context:
          context || text.slice(Math.max(0, match.index - 40), match.index + phrase.length + 40),
        negated: isNegated(context || text, localIndex, phrase.length),
      });
    }
  }

  return hits;
}

/**
 * Score the text with the rules engine.
 *
 * A label's score is the weighted count of its un-negated signals. Priority
 * outranks follow-up, which outranks routine, so a safety signal always wins
 * over administrative language.
 */
export function scoreWithRules(text: string): { scores: LabelScore[]; hits: RuleHit[] } {
  const hits = findRuleHits(text);
  const active = hits.filter((hit) => !hit.negated);

  const weights: Record<WorkflowLabel, number> = {
    priority: 1,
    'follow-up': 0.7,
    routine: 0.5,
  };

  const raw: Record<WorkflowLabel, number> = { priority: 0, 'follow-up': 0, routine: 0 };
  for (const hit of active) raw[hit.label] += weights[hit.label];

  const total = LABEL_ORDER.reduce((sum, label) => sum + raw[label], 0);
  const scores: LabelScore[] = LABEL_ORDER.map((label) => {
    const share = total === 0 ? 0 : raw[label] / total;
    return {
      label,
      score: share,
      similarity: Number((share * 2 - 1).toFixed(4)),
    };
  });

  // The shares must sum to exactly one. Rounding each share independently
  // would leave a residue of up to 1.5e-4, which is enough to break a
  // "probability distribution" assertion downstream. The residue is added
  // to the first non-zero label, so the total is exact.
  const residue = 1 - scores.reduce((sum, score) => sum + score.score, 0);
  if (total > 0 && residue !== 0) {
    const target = scores.find((score) => score.score > 0);
    if (target) target.score = Number((target.score + residue).toFixed(10));
  }

  return { scores, hits };
}

/**
 * Vocabulary that indicates the text belongs to the care-workflow domain.
 *
 * Used as an in-domain relevance check. Text with no domain vocabulary at all
 * is treated as out of distribution and routed to manual review rather than
 * being forced into a class.
 */
const DOMAIN_VOCABULARY = [
  'resident',
  'patient',
  'care team',
  'care plan',
  'care-plan',
  'clinical',
  'clinician',
  'nursing',
  'nurse',
  'assessment',
  'medication',
  'prescription',
  'dose',
  'therapy',
  'appointment',
  'schedule',
  'scheduling',
  'follow-up',
  'follow up',
  'monitoring',
  'blood pressure',
  'heart rate',
  'weight',
  'oxygen',
  'temperature',
  'symptom',
  'symptoms',
  'pain',
  'dizziness',
  'falls',
  'fell',
  'wound',
  'nutrition',
  'dietitian',
  'wellness',
  'annual',
  'routine',
  'preventive',
  'vitals',
  'observation',
  'discharge',
  'admitted',
  'referral',
  'same-day',
  'same day',
  'urgent',
  'normal range',
  'normal results',
  'reports',
  'reported',
  'denies',
  'suture',
  'caregiver',
  'family',
  'chronic condition',
  'blood work',
  'stable',
  'unchanged',
  'nothing outstanding',
];

/**
 * Vocabulary that identifies a *person and their care*, rather than any
 * mention of an appointment or a schedule.
 *
 * The distinction matters. A facilities note such as "the fire drill is
 * scheduled for Tuesday" contains scheduling vocabulary but is not about a
 * resident, and must not be classified. Requiring a person-and-care term -
 * or a concrete clinical detail alongside weaker scheduling vocabulary -
 * keeps that case out of the workflow.
 */
const CARE_CONTEXT_VOCABULARY = [
  'resident',
  'patient',
  'care team',
  'care plan',
  'care-plan',
  'clinical',
  'clinician',
  'nursing',
  'nurse',
  'medical',
  'therapy',
  'medication',
  'prescription',
  'dose',
  'vital',
  'vitals',
  'symptom',
  'pain',
  'wound',
  'nutrition',
  'dietitian',
  'wellness',
  'assessment',
  'discharge',
  'referral',
  'oxygen',
  'temperature',
  'weight',
  'heart rate',
  'blood pressure',
  'blood work',
  'chronic condition',
  'family',
  'caregiver',
  'clinic',
  'physio',
  'physiotherapy',
  'hearing',
  'audiology',
  'podiatry',
  'physician',
  'doctor',
  'pharmacy',
  'insulin',
  'hearing aid',
  'dressing',
  'orthostatic',
];

/**
 * Markers of a *specific* clinical detail.
 *
 * A handover fragment such as "discussed at handover, will review later" is
 * in-domain but carries no patient-specific fact. Requiring at least one
 * concrete detail (a measurement, a symptom, a medication, a procedure, or a
 * concrete timeframe) keeps such fragments in manual review.
 */
const DETAIL_PATTERNS: RegExp[] = [
  // A measurement with a unit.
  /\b\d+(?:\.\d+)?\s*(?:mmHg|bpm|beats\/min|kg|g\/dL|mg|mmol\/L|µmol\/L|°C|%|days?|weeks?|months?)\b/i,
  // A named measurement.
  /\b(?:blood pressure|heart rate|oxygen saturation|respiratory rate|body temperature|haemoglobin|hemoglobin|creatinine|weight)\b/i,
  // A symptom.
  /\b(?:dizziness|pain|falls?|fell|confusion|unresponsive|breathless|shortness of breath|unwell|headache|nausea|swelling|erythema|drainage|wound|declining intake|intake)\b/i,
  // A medication.
  /\b(?:medication|prescription|dose|tablet|antihypertensive|insulin|diuretic|refill)\b/i,
  // A procedure or referral.
  /\b(?:suture|dressing|referral|physiotherapy|physiotherapist|dietitian|screening)\b/i,
  // A concrete timeframe.
  /\b(?:within (?:seven|ten|\w+) days|due in \w+|same[- ]day|this (?:morning|afternoon|evening)|within a week|next week)\b/i,
];

/** True when the text carries at least one concrete, patient-specific detail. */
export function hasClinicalDetail(text: string): boolean {
  const content = stripStructuralPrefixes(text);
  return DETAIL_PATTERNS.some((pattern) => pattern.test(content));
}

/**
 * Structural prefixes added by the normalizer.
 *
 * These are workflow labels, not clinical content, so they must be removed
 * before the in-domain check - otherwise "Note:" alone would make every
 * record look like it contains clinical vocabulary.
 */
const STRUCTURAL_PREFIXES = /^(note|encounter|observation|open work)\s*:\s*/i;

/**
 * The synthetic-data marker every bundled note carries.
 *
 * "Synthetic note:" is a data provenance marker, not clinical vocabulary, so
 * it is stripped before the in-domain check.
 */
const SYNTHETIC_MARKER = /^synthetic\s+(note|record|entry)\s*:\s*/i;

/** Strip the normalizer's structural prefixes from a line. */
export function stripStructuralPrefixes(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(SYNTHETIC_MARKER, '').replace(STRUCTURAL_PREFIXES, '').trim())
    .filter((line) => line.length > 0)
    .join(' ');
}

/**
 * True when the text contains enough care-workflow vocabulary to classify.
 *
 * The check is two-tier. Strong care-context vocabulary ("resident",
 * "medication", "wound") is sufficient on its own. Weaker administrative
 * vocabulary ("appointment", "schedule", "monitoring") only counts when it
 * is accompanied by at least one concrete clinical detail, because a
 * facilities note about a scheduled fire drill is not a care record.
 */
export function isInDomain(text: string): boolean {
  const content = stripStructuralPrefixes(text);
  const normalized = normalizeForMatch(content);

  const hasStrongContext = CARE_CONTEXT_VOCABULARY.some((term) =>
    normalized.includes(normalizeForMatch(term)),
  );
  if (hasStrongContext) return true;

  const expanded = normalizeForMatch(expandAbbreviations(content));
  if (CARE_CONTEXT_VOCABULARY.some((term) => expanded.includes(normalizeForMatch(term)))) {
    return true;
  }

  const hasWeakContext = DOMAIN_VOCABULARY.some((term) =>
    normalized.includes(normalizeForMatch(term)),
  );
  if (!hasWeakContext) return false;

  // Administrative vocabulary alone is not enough. It has to be backed by a
  // concrete clinical detail or the record is out of distribution.
  return hasClinicalDetail(content);
}

/**
 * Minimum number of words for the rules engine to commit to a label.
 *
 * Very short notes ("review.", "ok.") carry too little evidence to act on.
 * The engine still names its closest label so a reviewer can see it, but the
 * confidence stays low and the workflow abstains.
 */
export const MIN_RULES_EVIDENCE_WORDS = 6;

/**
 * Confidence for the rules engine.
 *
 * An explicit phrase match is stronger evidence than an embedding similarity,
 * so the scale starts higher than the model's. A single unambiguous signal in
 * a substantial note is enough to act on; thin notes never clear the bar.
 *
 * The scale is kept comparable with the model's calibrated confidence so a
 * single decision threshold applies to both engines.
 */
export function rulesConfidence(text: string, label: WorkflowLabel): number {
  const { hits } = scoreWithRules(text);
  const active = hits.filter((hit) => !hit.negated && hit.label === label);
  if (active.length === 0) return 0;

  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words < MIN_RULES_EVIDENCE_WORDS) return 0;

  const base = Math.min(0.9, 0.72 + (active.length - 1) * 0.08);
  const lengthBoost = words >= 25 ? 0.08 : words >= 12 ? 0.04 : 0;
  return Number(Math.min(0.97, base + lengthBoost).toFixed(4));
}

export function classifyWithRules(text: string): RulesResult {
  const { scores, hits } = scoreWithRules(text);
  const active = hits.filter((hit) => !hit.negated);

  const ordered = [...scores].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Deterministic tie-break: priority wins, then follow-up, then routine.
    const rank: Record<WorkflowLabel, number> = { priority: 0, 'follow-up': 1, routine: 2 };
    return rank[a.label] - rank[b.label];
  });

  const best = ordered[0];
  const runnerUp = ordered[1];
  const tied = best.score === runnerUp.score;

  if (!best || best.score === 0) {
    return {
      label: 'routine',
      scores,
      hits,
      rationale:
        'The deterministic rules engine found no priority or follow-up signal in this record, so the workflow stays on the routine path.',
    };
  }

  const matched = active.filter((hit) => hit.label === best.label);
  const phrases = matched.slice(0, 3).map((hit) => `"${hit.phrase}"`);
  const phraseList =
    phrases.length === 1
      ? phrases[0]
      : `${phrases.slice(0, -1).join(', ')} and ${phrases[phrases.length - 1]}`;
  const negatedNote = hits.some((hit) => hit.negated) ? ' Negated mentions were discounted.' : '';

  return {
    label: best.label,
    scores,
    hits,
    rationale: `Deterministic rules matched ${phraseList} for the ${LABEL_DEFINITIONS[best.label].title.toLowerCase()} workflow.${negatedNote}${
      tied ? ' The top two labels were tied, so the higher-priority label was selected.' : ''
    }`,
  };
}
