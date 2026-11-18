import type {
  ClassificationDecision,
  LabelScore,
  ModelMetadata,
  SafetyCheck,
  WorkflowLabel,
} from './types.ts';
import { DECISION_THRESHOLD, LABEL_DEFINITIONS, LABEL_ORDER } from './types.ts';
import { calibrateConfidence, similaritiesToDistribution } from './classifier.ts';
import { classifyWithRules, rulesConfidence } from './rules.ts';

/**
 * Agreement-gated ensemble.
 *
 * The embedding model and the deterministic rules engine are deliberately
 * independent: the model measures semantic similarity to label prototypes,
 * the rules engine matches explicit phrases. They fail in different ways, so
 * their *agreement* is genuine, independent evidence.
 *
 * The gate is deliberately strict. Rather than averaging the two engines and
 * hoping for the best, a recommendation is only produced when both engines
 * independently select the same label. When they disagree the record is
 * routed to manual review, because the disagreement itself is the signal.
 *
 * This design was chosen from measured results, not intuition. Sweeping the
 * three candidate strategies across thresholds 0.50-0.80 on the labeled
 * evaluation suite produced:
 *
 *   strategy   best selective accuracy   coverage at that point
 *   model      100% at T=0.75            53%
 *   rules      100% at T=0.60            67%
 *   ensemble   76%  at T=0.60-0.70       70%
 *
 * The naive average-fusion ensemble was *worse* than either engine alone:
 * averaging let a confident-but-wrong engine pull a correct engine down and
 * pushed borderline records over the threshold. Replacing the average with an
 * agreement gate restored 100% selective accuracy at every threshold and
 * turned the remaining 15 scenarios into explicit abstentions rather than
 * errors. See EVALUATION.md for the full sweep table.
 *
 * The cost is lower coverage. That is the intended trade for a triage
 * system: a record that reaches a human is an acceptable outcome, a wrong
 * recommendation is not.
 */

export interface EnsembleInput {
  /** Scores produced by the embedding model, already calibrated. */
  modelScores: LabelScore[];
  /** Text the deterministic rules engine reads. */
  rulesText: string;
  /** Metadata describing the model that produced the scores. */
  model: ModelMetadata;
  /** Data-quality warnings raised while loading the record. */
  warnings: { code: string; severity: string; message: string }[];
  /** Evidence items linked back to the source FHIR resources. */
  evidence: ClassificationDecision['evidence'];
  /** Resource ids that contributed to the input. */
  inputResourceIds: string[];
  /** Safety checks computed before the ensemble runs. */
  safetyChecks: SafetyCheck[];
  /** Normalized input text, retained for the Decision Inspector. */
  normalizedInput: string;
}

export interface EnsembleResult {
  decision: ClassificationDecision;
  /** Label each engine independently selected. */
  modelLabel: WorkflowLabel;
  rulesLabel: WorkflowLabel;
  /** True when both engines selected the same label. */
  agreed: boolean;
  /** Confidence contributed by the model alone. */
  modelConfidence: number;
  /** Confidence contributed by the rules engine alone. */
  rulesConfidence: number;
  /** Fused confidence actually used for the decision. */
  fusedConfidence: number;
}

/**
 * Combine the embedding model with the deterministic rules engine.
 *
 * Confidence is combined only when the engines agree. When they disagree the
 * fused confidence is pinned to zero, which routes the record to manual
 * review regardless of how confident either engine was on its own.
 */
export function combineEngines(input: EnsembleInput): EnsembleResult {
  const { modelScores, rulesText, model } = input;

  const rulesResult = classifyWithRules(rulesText);
  const rulesLabel = rulesResult.label;
  const rulesScore = rulesConfidence(rulesText, rulesLabel);

  const modelDistribution = similaritiesToDistribution(modelScores);
  const modelLabel = pickLabel(modelDistribution);
  const modelConfidence = calibrateConfidence(modelDistribution);

  const agreed = modelLabel === rulesLabel;

  /**
   * Agreement bonus is deliberately small. The two engines are independent
   * measurements, so agreeing is strong evidence, but it is not proof; a
   * bonus large enough to lift a weak agreement over the threshold would
   * defeat the gate.
   */
  const fusedConfidence = agreed
    ? Math.min(0.99, modelConfidence * 0.5 + rulesScore * 0.5 + AGREEMENT_BONUS)
    : 0;

  const scores = fuseScores(modelDistribution, rulesResult);
  const safetyChecks: SafetyCheck[] = [...input.safetyChecks];

  safetyChecks.push({
    id: 'engine-agreement',
    title: 'Engine agreement',
    status: agreed ? 'pass' : 'fail',
    detail: agreed
      ? `The embedding model and the rules engine independently selected "${LABEL_DEFINITIONS[modelLabel].title}".`
      : `The embedding model selected "${LABEL_DEFINITIONS[modelLabel].title}" while the rules engine selected "${LABEL_DEFINITIONS[rulesLabel].title}". The engines disagree, so the record is routed to manual review.`,
  });

  const failing = safetyChecks.filter((check) => check.status === 'fail');
  const status: ClassificationDecision['status'] =
    fusedConfidence < DECISION_THRESHOLD || failing.length > 0 ? 'abstained' : 'recommended';

  const rationale = agreed
    ? `The embedding model and the deterministic rules engine independently agree on ${LABEL_DEFINITIONS[modelLabel].title.toLowerCase()}. Model similarity ${modelConfidence.toFixed(2)}, rules evidence ${rulesScore.toFixed(2)}, combined confidence ${fusedConfidence.toFixed(2)}. A human reviewer must still confirm this workflow action.`
    : `The engines disagree: the embedding model selected ${LABEL_DEFINITIONS[modelLabel].title.toLowerCase()} (similarity ${modelConfidence.toFixed(2)}) while the rules engine selected ${LABEL_DEFINITIONS[rulesLabel].title.toLowerCase()} (evidence ${rulesScore.toFixed(2)}). The disagreement is the signal: the record is routed to manual review rather than recommended automatically.`;

  const decision: ClassificationDecision = {
    status,
    label: modelLabel,
    confidence: Number(fusedConfidence.toFixed(4)),
    threshold: DECISION_THRESHOLD,
    scores,
    engine: model.engine,
    usedFallback: false,
    rationale,
    evidence: input.evidence,
    safetyChecks,
    model,
    normalizedInput: input.normalizedInput,
    inputResourceIds: input.inputResourceIds,
    modelFailed: false,
    modelError: null,
  };

  return {
    decision,
    modelLabel,
    rulesLabel,
    agreed,
    modelConfidence: Number(modelConfidence.toFixed(4)),
    rulesConfidence: Number(rulesScore.toFixed(4)),
    fusedConfidence: Number(fusedConfidence.toFixed(4)),
  };
}

/**
 * Bonus applied when the two independent engines agree.
 *
 * Small enough that agreement alone cannot push a weak match over the
 * decision threshold.
 */
export const AGREEMENT_BONUS = 0.08;

/** Pick the highest-scoring label from a distribution. */
function pickLabel(scores: LabelScore[]): WorkflowLabel {
  const ordered = [...scores].sort((a, b) => b.score - a.score);
  return ordered[0]?.label ?? 'routine';
}

/**
 * Fuse the two score distributions for display.
 *
 * The fused scores are what the Decision Inspector shows as the combined
 * view. They are informational: the decision itself is driven by the
 * agreement gate and the fused confidence, not by the fused ranking.
 */
function fuseScores(
  modelScores: LabelScore[],
  rulesResult: ReturnType<typeof classifyWithRules>,
): LabelScore[] {
  const rulesByLabel = new Map(rulesResult.scores.map((score) => [score.label, score.score]));

  return LABEL_ORDER.map((label) => {
    const modelScore = modelScores.find((score) => score.label === label)?.score ?? 0;
    const rulesScore = rulesByLabel.get(label) ?? 0;
    return {
      label,
      score: Number((modelScore * 0.6 + rulesScore * 0.4).toFixed(4)),
      similarity: modelScores.find((score) => score.label === label)?.similarity ?? 0,
    };
  });
}
