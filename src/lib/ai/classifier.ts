import type {
  ClassificationDecision,
  EvidenceItem,
  LabelScore,
  ModelMetadata,
  SafetyCheck,
  WorkflowLabel,
} from './types.ts';
import {
  DECISION_THRESHOLD,
  LABEL_DEFINITIONS,
  LABEL_ORDER,
  MIN_CONTENT_WORDS,
  SIMILARITY_TEMPERATURE,
  validateDecisionShape,
} from './types.ts';
import {
  classifyWithRules,
  findRuleHits,
  isInDomain,
  rulesConfidence,
  scoreWithRules,
  stripStructuralPrefixes,
  type RuleHit,
} from './rules.ts';
import { preprocessForModel, preprocessForRules } from './preprocess.ts';
import { combineEngines } from './ensemble.ts';

export interface ClassifierInput {
  /** Free-text note content from DocumentReference resources. */
  notes: { id: string; text: string }[];
  /** Structured observations rendered to text. */
  observations: { id: string; text: string }[];
  /** Open care-plan / task work items. */
  tasks: { id: string; text: string }[];
  /** Encounter reasons. */
  encounters: { id: string; text: string }[];
}

export interface NormalizedInput {
  text: string;
  resourceIds: string[];
  evidence: EvidenceItem[];
}

/**
 * Build the single normalized text blob the classifiers consume.
 *
 * The text is deterministic and traceable: every fragment is prefixed with the
 * resource it came from, so the Decision Inspector can show the exact input.
 */
export function normalizeInput(input: ClassifierInput): NormalizedInput {
  const parts: string[] = [];
  const resourceIds: string[] = [];
  const evidence: EvidenceItem[] = [];

  for (const encounter of input.encounters) {
    if (!encounter.text.trim()) continue;
    parts.push(`Encounter: ${encounter.text.trim()}`);
    resourceIds.push(encounter.id);
    evidence.push({
      resourceType: 'Encounter',
      resourceId: encounter.id,
      label: 'Encounter reason',
      excerpt: encounter.text.trim(),
    });
  }

  for (const observation of input.observations) {
    if (!observation.text.trim()) continue;
    parts.push(`Observation: ${observation.text.trim()}`);
    resourceIds.push(observation.id);
    evidence.push({
      resourceType: 'Observation',
      resourceId: observation.id,
      label: 'Recorded measurement',
      excerpt: observation.text.trim(),
    });
  }

  for (const note of input.notes) {
    if (!note.text.trim()) continue;
    parts.push(`Note: ${note.text.trim()}`);
    resourceIds.push(note.id);
    evidence.push({
      resourceType: 'DocumentReference',
      resourceId: note.id,
      label: 'Unstructured note',
      excerpt: note.text.trim(),
    });
  }

  for (const task of input.tasks) {
    if (!task.text.trim()) continue;
    parts.push(`Open work: ${task.text.trim()}`);
    resourceIds.push(task.id);
    evidence.push({
      resourceType: 'CarePlan',
      resourceId: task.id,
      label: 'Open care-plan activity',
      excerpt: task.text.trim(),
    });
  }

  return { text: parts.join('\n'), resourceIds, evidence };
}

/** Number of whitespace-separated words of clinical content in the input. */
export function countWords(text: string): number {
  return stripStructuralPrefixes(text).trim().split(/\s+/).filter(Boolean).length;
}

export interface EngineInputs {
  /** Text the deterministic rules engine reads. */
  rulesText: string;
  /** Text the embedding model embeds. */
  modelText: string;
  /** Trigger phrases that appeared only in a negated context. */
  negatedPhrases: string[];
  /** Rule hits found in the rules text. */
  hits: RuleHit[];
}

/**
 * Build the two engine-specific views of a normalized record.
 *
 * The rules engine reads the repaired original wording so it can quote exact
 * phrases back to the reviewer. The model reads an expanded and
 * negation-masked view so that terse shorthand is understood and a negated
 * symptom ("chest pain ruled out") is not mistaken for a positive one.
 *
 * Both views are returned together so the Decision Inspector can show the
 * reviewer exactly what each engine saw.
 */
export function buildEngineInputs(normalized: NormalizedInput): EngineInputs {
  const rulesText = preprocessForRules(normalized.text);
  const hits = findRuleHits(rulesText);
  const negatedPhrases = hits.filter((hit) => hit.negated).map((hit) => hit.phrase);
  const modelText = preprocessForModel({ text: rulesText, negatedPhrases });
  return { rulesText, modelText, negatedPhrases, hits };
}

/**
 * Select the winning label from a set of scores.
 *
 * When no signal is present at all the result is `routine`: with zero evidence
 * the safe administrative default is "nothing to do", and the accompanying
 * confidence of zero routes the record to manual review anyway.
 */
export function selectLabel(scores: LabelScore[]): WorkflowLabel {
  const ordered = [...scores].sort((a, b) => b.score - a.score);
  const best = ordered[0];
  if (!best || best.score <= 0) return 'routine';
  return best.label;
}

/**
 * Convert raw similarity values into a distribution that sums to one.
 *
 * Embedding cosine similarities all sit in a narrow band (often 0.3-0.7), so
 * comparing them directly understates how much the winner leads. A softmax
 * over the similarities expresses the model's actual preference between the
 * prototypes, and puts both engines on the same footing for calibration.
 */
export function similaritiesToDistribution(
  scores: { label: WorkflowLabel; similarity: number }[],
  temperature = SIMILARITY_TEMPERATURE,
): LabelScore[] {
  const max = Math.max(...scores.map((score) => score.similarity));
  const exponentials = scores.map((score) => Math.exp((score.similarity - max) / temperature));
  const total = exponentials.reduce((sum, value) => sum + value, 0);
  return scores.map((score, index) => ({
    label: score.label,
    score: Number((exponentials[index] / (total || 1)).toFixed(4)),
    similarity: score.similarity,
  }));
}

/**
 * Calibrate a score distribution into an interpretable confidence.
 *
 * Confidence combines how much probability mass the winning label holds with
 * how far it leads the runner-up. A three-way split is therefore never
 * confident, and a decisive separation is.
 */
export function calibrateConfidence(scores: LabelScore[]): number {
  const ordered = [...scores].sort((a, b) => b.score - a.score);
  const best = ordered[0]?.score ?? 0;
  const runnerUp = ordered[1]?.score ?? 0;
  const margin = Math.max(0, best - runnerUp);
  const absolute = Math.max(0, Math.min(1, best));
  const separation = Math.max(0, Math.min(1, margin * 4));
  return Number(Math.max(0, Math.min(0.99, absolute * 0.5 + separation * 0.5)).toFixed(4));
}

export interface SafetyInputs {
  dataQualityWarnings: { code: string; severity: string; message: string }[];
  emptyInput: boolean;
  contradictory: boolean;
  ruleHits: RuleHit[];
  scores: LabelScore[];
  /** False when the text contains no care-workflow vocabulary at all. */
  inDomain?: boolean;
  /** Word count of the normalized input, when known. */
  wordCount?: number;
}

export function runSafetyChecks(inputs: SafetyInputs): SafetyCheck[] {
  const checks: SafetyCheck[] = [];
  const errors = inputs.dataQualityWarnings.filter((w) => w.severity === 'error');
  const warnings = inputs.dataQualityWarnings.filter((w) => w.severity === 'warning');

  checks.push({
    id: 'input-present',
    title: 'Sufficient record content',
    status: inputs.emptyInput ? 'fail' : 'pass',
    detail: inputs.emptyInput
      ? 'No clinical narrative or measurement was available to classify.'
      : 'The record contains narrative and/or structured content.',
  });

  if (inputs.wordCount !== undefined) {
    const sufficient = inputs.wordCount >= MIN_CONTENT_WORDS;
    checks.push({
      id: 'content-depth',
      title: 'Content depth',
      // Too little text to act on is a hard failure: a record with a couple of
      // words cannot support a workflow recommendation, only a human review.
      status: sufficient ? 'pass' : 'fail',
      detail: sufficient
        ? `The record contains ${inputs.wordCount} words of content.`
        : `The record contains only ${inputs.wordCount} word(s); there is too little text to act on confidently.`,
    });
  }

  if (inputs.inDomain !== undefined) {
    checks.push({
      id: 'domain-relevance',
      title: 'In-domain relevance',
      status: inputs.inDomain ? 'pass' : 'fail',
      detail: inputs.inDomain
        ? 'The record contains care-workflow vocabulary.'
        : 'The record contains no recognisable care-workflow vocabulary and is treated as out of distribution.',
    });
  }

  checks.push({
    id: 'fhir-validity',
    title: 'FHIR data quality',
    status: errors.length > 0 ? 'fail' : warnings.length > 0 ? 'warn' : 'pass',
    detail:
      errors.length > 0
        ? `${errors.length} FHIR validation error(s) were detected.`
        : warnings.length > 0
          ? `${warnings.length} FHIR validation warning(s) were detected.`
          : 'No FHIR validation issues were detected.',
  });

  const ordered = [...inputs.scores].sort((a, b) => b.score - a.score);
  const margin = (ordered[0]?.score ?? 0) - (ordered[1]?.score ?? 0);
  checks.push({
    id: 'label-separation',
    title: 'Label separation',
    status: margin >= 0.08 ? 'pass' : 'warn',
    detail:
      margin >= 0.08
        ? `The top label leads the runner-up by ${margin.toFixed(3)}.`
        : `The top two labels are within ${margin.toFixed(3)}; the decision is weakly separated.`,
  });

  checks.push({
    id: 'contradiction',
    title: 'Contradictory evidence',
    status: inputs.contradictory ? 'warn' : 'pass',
    detail: inputs.contradictory
      ? 'The record contains signals pointing at more than one workflow label.'
      : 'No conflicting workflow signals were detected.',
  });

  checks.push({
    id: 'clinical-scope',
    title: 'Administrative scope only',
    status: 'pass',
    detail:
      'The system classifies administrative workflow only. It does not diagnose, prescribe, or recommend treatment.',
  });

  return checks;
}

/** True when the top scores are too close to call. */
export function isContradictory(scores: LabelScore[]): boolean {
  const ordered = [...scores].sort((a, b) => b.score - a.score);
  if (ordered.length < 2) return false;
  return ordered[0].score - ordered[1].score < 0.04;
}

export interface EngineInput {
  scores: LabelScore[];
  /** Confidence override; when omitted it is derived from the score spread. */
  confidence?: number;
  engine: ModelMetadata['engine'];
  rationale: string;
  usedFallback: boolean;
  modelFailed: boolean;
  modelError: string | null;
  evidence: EvidenceItem[];
  safetyChecks: SafetyCheck[];
  normalizedInput: string;
  inputResourceIds: string[];
  threshold?: number;
  /** Metadata about the model that produced the scores, when there was one. */
  model?: ModelMetadata;
}

/**
 * Assemble a validated decision from raw engine output.
 *
 * Every decision - model or rules - passes through here, so the schema
 * guarantee holds regardless of which engine produced the scores.
 */
export function buildDecision(input: EngineInput): ClassificationDecision {
  const threshold = input.threshold ?? DECISION_THRESHOLD;
  const confidence = input.confidence ?? calibrateConfidence(input.scores);
  const ordered = [...input.scores].sort((a, b) => b.score - a.score);
  const label = ordered[0]?.label ?? 'routine';
  const failing = input.safetyChecks.filter((check) => check.status === 'fail');

  const status: ClassificationDecision['status'] =
    confidence < threshold || failing.length > 0 ? 'abstained' : 'recommended';

  const decision: ClassificationDecision = {
    status,
    label,
    confidence,
    threshold,
    scores: input.scores,
    engine: input.engine,
    usedFallback: input.usedFallback,
    rationale: input.rationale,
    evidence: input.evidence,
    safetyChecks: input.safetyChecks,
    model: input.model ?? {
      modelId: 'n/a',
      engine: input.engine,
      engineDetail: 'deterministic rules engine',
      dtype: 'n/a',
      parameters: 'n/a',
      modelSize: 'n/a',
      dimensions: null,
      latencyMs: 0,
      coldStartMs: null,
      warm: false,
    },
    normalizedInput: input.normalizedInput,
    inputResourceIds: input.inputResourceIds,
    modelFailed: input.modelFailed,
    modelError: input.modelError,
  };

  const validated = validateDecisionShape(decision);
  if (!validated.ok) {
    throw new Error(`Decision failed schema validation: ${validated.error}`);
  }
  return decision;
}

/** Decision built purely from the deterministic rules engine. */
export function decideWithRules(
  normalized: NormalizedInput,
  warnings: { code: string; severity: string; message: string }[],
): ClassificationDecision {
  const engineInputs = buildEngineInputs(normalized);
  const { scores, hits } = scoreWithRules(engineInputs.rulesText);
  const rulesResult = classifyWithRules(engineInputs.rulesText);
  const contradictory = isContradictory(scores);
  const safetyChecks = runSafetyChecks({
    dataQualityWarnings: warnings,
    emptyInput: normalized.text.trim().length === 0,
    contradictory,
    ruleHits: hits,
    scores,
    inDomain: isInDomain(engineInputs.rulesText),
    wordCount: countWords(engineInputs.rulesText),
  });

  return buildDecision({
    scores,
    confidence: rulesConfidence(engineInputs.rulesText, rulesResult.label),
    engine: 'rules',
    rationale: rulesResult.rationale,
    usedFallback: false,
    modelFailed: false,
    modelError: null,
    evidence: normalized.evidence,
    safetyChecks,
    normalizedInput: normalized.text,
    inputResourceIds: normalized.resourceIds,
  });
}

export interface ModelDecisionInput {
  scores: LabelScore[];
  latencyMs: number;
  coldStartMs: number | null;
  warm: boolean;
  dimensions: number | null;
  modelId: string;
  engineDetail: string;
  dtype: string;
  parameters: string;
  modelSize: string;
  normalized: NormalizedInput;
  warnings: { code: string; severity: string; message: string }[];
}

/** Decision built from embedding-model output. */
export function decideWithModel(input: ModelDecisionInput): ClassificationDecision {
  const engineInputs = buildEngineInputs(input.normalized);
  const contradictory = isContradictory(input.scores);
  const safetyChecks = runSafetyChecks({
    dataQualityWarnings: input.warnings,
    emptyInput: input.normalized.text.trim().length === 0,
    contradictory,
    ruleHits: [],
    scores: input.scores,
    inDomain: isInDomain(engineInputs.rulesText),
    wordCount: countWords(engineInputs.rulesText),
  });

  const ordered = [...input.scores].sort((a, b) => b.score - a.score);
  const best = ordered[0];
  const winner = best?.label ?? 'routine';

  const model: ModelMetadata = {
    modelId: input.modelId,
    engine: 'embedding-model',
    engineDetail: input.engineDetail,
    dtype: input.dtype,
    parameters: input.parameters,
    modelSize: input.modelSize,
    dimensions: input.dimensions,
    latencyMs: input.latencyMs,
    coldStartMs: input.coldStartMs,
    warm: input.warm,
  };

  return buildDecision({
    scores: input.scores,
    engine: 'embedding-model',
    rationale: `Semantic similarity against the ${LABEL_DEFINITIONS[winner].title.toLowerCase()} prototype produced the closest match (cosine ${(best?.similarity ?? 0).toFixed(3)}). This is a workflow similarity score, not a clinical probability, and a human must confirm it.`,
    usedFallback: false,
    modelFailed: false,
    modelError: null,
    evidence: input.normalized.evidence,
    safetyChecks,
    normalizedInput: input.normalized.text,
    inputResourceIds: input.normalized.resourceIds,
    model,
  });
}

/** Decision produced when the model was requested but could not run. */
export function decideWithFallback(
  normalized: NormalizedInput,
  warnings: { code: string; severity: string; message: string }[],
  error: string,
): ClassificationDecision {
  const decision = decideWithRules(normalized, warnings);
  return {
    ...decision,
    usedFallback: true,
    modelFailed: true,
    modelError: error,
    model: {
      modelId: 'Xenova/bge-small-en-v1.5',
      engine: 'rules',
      engineDetail: 'deterministic rules engine (model unavailable)',
      dtype: 'n/a',
      parameters: 'n/a',
      modelSize: 'n/a',
      dimensions: null,
      latencyMs: 0,
      coldStartMs: null,
      warm: false,
    },
    rationale: `The embedding model could not run (${error}). The decision below comes from the deterministic rules engine, not from model inference.`,
  };
}

export interface EnsembleDecisionInput {
  /** Scores from the embedding model. */
  modelScores: LabelScore[];
  /** Model metadata. */
  model: ModelMetadata;
  normalized: NormalizedInput;
  warnings: { code: string; severity: string; message: string }[];
}

/**
 * Decision produced by the agreement-gated ensemble.
 *
 * This is the primary decision path in the application: the embedding model
 * and the deterministic rules engine must independently select the same label
 * before a recommendation is issued.
 */
export function decideWithEnsemble(input: EnsembleDecisionInput): ClassificationDecision {
  const engineInputs = buildEngineInputs(input.normalized);
  const { scores: rulesScores } = scoreWithRules(engineInputs.rulesText);
  const contradictory = isContradictory(rulesScores);

  const safetyChecks = runSafetyChecks({
    dataQualityWarnings: input.warnings,
    emptyInput: input.normalized.text.trim().length === 0,
    contradictory,
    ruleHits: engineInputs.hits,
    scores: rulesScores,
    inDomain: isInDomain(engineInputs.rulesText),
    wordCount: countWords(engineInputs.rulesText),
  });

  return combineEngines({
    modelScores: input.modelScores,
    rulesText: engineInputs.rulesText,
    model: input.model,
    warnings: input.warnings,
    evidence: input.normalized.evidence,
    inputResourceIds: input.normalized.resourceIds,
    safetyChecks,
    normalizedInput: input.normalized.text,
  }).decision;
}

export { DECISION_THRESHOLD, LABEL_DEFINITIONS, LABEL_ORDER };
export type { WorkflowLabel };
