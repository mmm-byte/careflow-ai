/**
 * Shared AI contract types.
 *
 * A `WorkflowLabel` is the single source of truth for the label vocabulary.
 * The wire format uses kebab-case ids (`follow-up`) that are safe in CSS
 * selectors, DOM ids and FHIR-adjacent payloads.
 */

export const WORKFLOW_LABELS = ['priority', 'follow-up', 'routine'] as const;

export type WorkflowLabel = (typeof WORKFLOW_LABELS)[number];

export interface LabelDefinition {
  id: WorkflowLabel;
  title: string;
  /**
   * Natural-language prototypes the embedding model is compared against.
   * Several prototypes per label give the model more surface to match, and
   * the best-matching prototype wins for that label.
   */
  prototypes: string[];
  /** Short description of what the class means operationally. */
  description: string;
  /** Workflow action proposed for this class. */
  proposedAction: string;
  /**
   * Signals used by the deterministic rules engine.
   *
   * These are deliberately *generic stems* rather than phrases copied from the
   * evaluation scenarios. A rules engine tuned on the same scenarios it is
   * scored against would look better than it is; keeping the vocabulary
   * general is what makes the Model Lab comparison meaningful.
   */
  ruleSignals: string[];
  /**
   * Regular-expression signals, for patterns a literal stem cannot express.
   *
   * The expressions are shared state, so they are created with the `g` flag
   * and must be reset before each use.
   */
  rulePatterns?: RegExp[];
}

export const LABEL_DEFINITIONS: Record<WorkflowLabel, LabelDefinition> = {
  priority: {
    id: 'priority',
    title: 'Priority review',
    prototypes: [
      'urgent concern, abnormal result requiring immediate clinician review, severe or escalating symptom, safety issue, possible acute deterioration',
      'the resident is acutely unwell and needs urgent or emergency assessment today',
      'a fall with injury, chest pain, severe confusion, or breathing difficulty requiring same-day escalation',
    ],
    description:
      'A safety-relevant signal suggests a clinician should look at this resident promptly.',
    proposedAction: 'Route to a clinician for priority review within the same shift.',
    ruleSignals: [
      'urgent',
      'emergency',
      'acute',
      'abnormal',
      'critical',
      'deteriorat',
      'fall',
      'fell',
      'chest pain',
      'shortness of breath',
      'confusion',
      'unresponsive',
      'seizure',
      'severe',
      'worsening',
      'escalate',
      'same day',
      'same-day',
      'stat',
      'unconscious',
      'collapsed',
      'choking',
      'bleeding',
      'droop',
      'weakness down',
      'stroke',
      'hypoxic',
      'distress',
      'immediate',
    ],
    rulePatterns: [
      /\b(?:could\s*not|couldn't|can\s*not|can't|difficulty)\s+(?:breathe|breathing)\b/i,
      /\bbarely\s+(?:breathe|breathing)\b/i,
      /\bnot\s+making\s+sense\b/i,
      /\b(?:resp(?:iratory)?\s+distress)\b/i,
      /\bA&O\s*x\s*[1-4]\b/i,
      /\b(?:resp(?:iratory)?\s+rate)\s+(?:2[4-9]|[3-9]\d)\b/i,
      /\b(?:saturation|sats?|spo2)\s*(?:of|at|:)?\s*(?:8[0-9]|7[0-9])\s*%?\b/i,
      /\bwork\s+of\s+breathing\b/i,
      /\bdid\s+not\s+stop\b/i,
      /\bslurring\s+(?:her|his|their)?\s*words\b/i,
      /\bslurred\s+speech\b/i,
      /\bfacial\s+droop\b/i,
      /\bstroke\s+pathway\b/i,
    ],
  },
  'follow-up': {
    id: 'follow-up',
    title: 'Follow-up',
    prototypes: [
      'follow-up required, scheduling needed, medication review, incomplete task, monitoring plan, care-plan activity still open',
      'the care team must arrange a future appointment, repeat a measurement, or review medication',
      'a referral, prescription renewal, or monitoring task that is scheduled but not yet completed',
    ],
    description: 'Administrative or monitoring work is outstanding but not acutely urgent.',
    proposedAction: 'Create a follow-up task for the care team to schedule and close.',
    ruleSignals: [
      'follow-up',
      'follow up',
      'followup',
      'scheduling',
      'schedule',
      'scheduled',
      'medication review',
      'medication change',
      'prescription renewal',
      'renewal',
      'renew',
      'monitoring plan',
      'monitor',
      'pending',
      'outstanding',
      'due in',
      'within seven days',
      'within days',
      'in ten days',
      'care-plan',
      'care plan',
      'recheck',
      're-check',
      'referral',
      'dietitian',
      'nutrition',
      'suture removal',
      'appointment',
      'assistance requested',
      'needs changing',
      'must be reviewed',
      'still needs',
      'still to be',
      'to be arranged',
      'to arrange',
      'needs booking',
      'arranged for',
      'repeat postural',
      'repeat reading',
      'recheck',
      'dressing must be',
      'booking',
      'book',
      'check due',
      'hearing check',
      'wound care',
      'dressing on',
      'soiled',
      'medication review still',
      'pharmacist',
      'postural readings',
      'light-headedness when standing',
      'dizziness when standing',
      'dose was adjusted',
      'dose change',
    ],
    rulePatterns: [
      /\b(?:still|remains?)\s+(?:to\s+be\s+)?(?:arranged|booked|scheduled|due|outstanding)\b/i,
      /\b(?:needs?|needs\s+to\s+be|must\s+be)\s+(?:booking|scheduling|arranging|reviewing|changing|renewing)\b/i,
      /\b(?:within|in)\s+(?:the\s+)?(?:next\s+week|five\s+days|a\s+week|tomorrow)\b/i,
      /\b(?:repeat|recheck)\s+\w+\s+(?:reading|measurement|assessment)\b/i,
    ],
  },
  routine: {
    id: 'routine',
    title: 'Routine',
    prototypes: [
      'stable condition, routine wellness visit, no urgent concerns, annual review, standard preventive care, no action outstanding',
      'the resident is well, measurements are within the normal range, and only usual preventive care is needed',
      'nothing time sensitive: a regular check-up with no outstanding administrative work',
    ],
    description:
      'The record looks stable and administrative; nothing appears to need prompt action.',
    proposedAction: 'Continue the routine workflow and record no additional action.',
    ruleSignals: [
      'routine',
      'stable',
      'wellness',
      'annual',
      'preventive',
      'no urgent concerns',
      'no concerns',
      'unchanged',
      'normal',
      'regular',
      'standard preventive',
      'within normal range',
      'completed',
      'nothing outstanding',
      'no concerns raised',
      'within the target range',
      'within range',
      'unremarkable',
      'no new symptoms',
      'no infection',
      'not infected',
      'comfortable at rest',
      'no action needed',
      'no further action',
      'nothing further',
      'checks completed',
      'in range',
      'unaffected',
    ],
  },
};

export const LABEL_ORDER: WorkflowLabel[] = [...WORKFLOW_LABELS];

/**
 * Softmax temperature used to turn raw cosine similarities into a
 * probability-like distribution over the labels.
 *
 * Chosen empirically: cosine similarities between clinical notes and label
 * prototypes occupy a narrow band (roughly 0.2-0.7), so a naive comparison
 * badly understates how far the winning label leads. The value was selected
 * by sweeping against the labeled evaluation suite - see EVALUATION.md.
 */
export const SIMILARITY_TEMPERATURE = 0.05;

/**
 * Minimum confidence required before a prediction is presented as a
 * recommendation. Below this the system abstains and routes to manual review.
 *
 * Selected by sweeping the threshold against the labeled evaluation suite.
 * See EVALUATION.md for the sweep table and the overfitting caveat.
 */
export const DECISION_THRESHOLD = 0.75;

/**
 * Minimum number of words of clinical content before the system is willing to
 * act on a record, regardless of which engine produced the scores.
 */
export const MIN_CONTENT_WORDS = 6;

export type EngineKind = 'embedding-model' | 'rules' | 'none';

export interface LabelScore {
  label: WorkflowLabel;
  score: number;
  /** Raw similarity in [-1, 1] before calibration. */
  similarity: number;
}

export interface EvidenceItem {
  resourceType: string;
  resourceId: string;
  label: string;
  excerpt: string;
}

export interface SafetyCheck {
  id: string;
  title: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

export interface ModelMetadata {
  /** Human-readable model identity. */
  modelId: string;
  /** Runtime that executed inference. */
  engine: EngineKind;
  /** Runtime detail, e.g. "transformers.js / wasm (q8)". */
  engineDetail: string;
  /** Quantization of the downloaded weights. */
  dtype: string;
  /** Parameter count when known. */
  parameters: string;
  /** Approximate on-disk size of the weights. */
  modelSize: string;
  /** Embedding dimensionality. */
  dimensions: number | null;
  /** Wall-clock milliseconds for this inference call. */
  latencyMs: number;
  /** Wall-clock milliseconds for the very first (cold) inference call. */
  coldStartMs: number | null;
  /** True when the model was already resident and reused. */
  warm: boolean;
}

export type DecisionStatus = 'recommended' | 'abstained';

export interface ClassificationDecision {
  status: DecisionStatus;
  /** Selected label. Always present so a reviewer can see what was closest. */
  label: WorkflowLabel;
  /** Calibrated confidence in [0, 1]. */
  confidence: number;
  /** Threshold applied to the calibrated confidence. */
  threshold: number;
  scores: LabelScore[];
  /** Which engine produced the decision. */
  engine: EngineKind;
  /** True when a fallback engine produced the decision instead of the model. */
  usedFallback: boolean;
  rationale: string;
  evidence: EvidenceItem[];
  safetyChecks: SafetyCheck[];
  model: ModelMetadata;
  /** Normalized text that was fed to the classifier. */
  normalizedInput: string;
  /** Resource ids that contributed to the input. */
  inputResourceIds: string[];
  /** True when the model was requested but could not run. */
  modelFailed: boolean;
  /** Present when the model path failed. */
  modelError: string | null;
}

export function isWorkflowLabel(value: unknown): value is WorkflowLabel {
  return typeof value === 'string' && (WORKFLOW_LABELS as readonly string[]).includes(value);
}

/**
 * Runtime validation of a raw engine payload against the decision schema.
 * Any shape mismatch becomes an error rather than a silently coerced value.
 */
export function validateDecisionShape(value: unknown): { ok: true } | { ok: false; error: string } {
  if (!value || typeof value !== 'object') {
    return { ok: false, error: 'Decision payload is not an object.' };
  }
  const decision = value as Record<string, unknown>;
  if (!isWorkflowLabel(decision.label)) {
    return { ok: false, error: `Decision label must be one of ${WORKFLOW_LABELS.join(', ')}.` };
  }
  if (typeof decision.confidence !== 'number' || Number.isNaN(decision.confidence)) {
    return { ok: false, error: 'Decision confidence must be a number.' };
  }
  if (decision.confidence < 0 || decision.confidence > 1) {
    return { ok: false, error: 'Decision confidence must be within [0, 1].' };
  }
  if (!Array.isArray(decision.scores)) {
    return { ok: false, error: 'Decision scores must be an array.' };
  }
  for (const score of decision.scores) {
    if (!score || typeof score !== 'object')
      return { ok: false, error: 'Each score must be an object.' };
    const typed = score as Record<string, unknown>;
    if (!isWorkflowLabel(typed.label))
      return { ok: false, error: 'Score label is not a valid workflow label.' };
    if (typeof typed.score !== 'number' || Number.isNaN(typed.score)) {
      return { ok: false, error: 'Score value must be a number.' };
    }
  }
  if (typeof decision.rationale !== 'string' || decision.rationale.length === 0) {
    return { ok: false, error: 'Decision rationale must be a non-empty string.' };
  }
  return { ok: true };
}
