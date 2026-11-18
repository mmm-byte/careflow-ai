import type { WorkflowLabel } from '../ai/types.ts';
import { DECISION_THRESHOLD, LABEL_DEFINITIONS, LABEL_ORDER } from '../ai/types.ts';
import {
  buildEngineInputs,
  calibrateConfidence,
  isContradictory,
  normalizeInput,
  runSafetyChecks,
  selectLabel,
  countWords,
  similaritiesToDistribution,
} from '../ai/classifier.ts';
import { scoreWithRules, isInDomain, rulesConfidence, classifyWithRules } from '../ai/rules.ts';
import { AGREEMENT_BONUS } from '../ai/ensemble.ts';
import type { EvaluationScenario } from './scenarios.ts';
import { EVALUATION_SCENARIOS } from './scenarios.ts';
import type { EvaluationMetrics, PredictionRecord } from './metrics.ts';
import { analyseFailures, computeMetrics } from './metrics.ts';

export interface Engine {
  name: string;
  /**
   * Classify a scenario and return per-label scores.
   * Implementations may be the embedding model, the rules engine, or a test double.
   */
  classify(scenario: EvaluationScenario): Promise<{
    scores: { label: WorkflowLabel; score: number; similarity: number }[];
    /**
     * Engine-specific confidence. When omitted it is derived from the spread
     * of the score distribution.
     */
    confidence?: number;
    latencyMs: number;
    usedFallback: boolean;
    failed: boolean;
    error?: string;
  }>;
}

export interface EvaluationRun {
  engine: string;
  records: PredictionRecord[];
  metrics: EvaluationMetrics;
  failures: ReturnType<typeof analyseFailures>;
  /** Wall-clock duration of the whole run. */
  durationMs: number;
  timestamp: string;
}

export function scenarioToInput(scenario: EvaluationScenario): {
  notes: { id: string; text: string }[];
  observations: { id: string; text: string }[];
  tasks: { id: string; text: string }[];
  encounters: { id: string; text: string }[];
} {
  return {
    notes: scenario.note ? [{ id: `${scenario.id}-note`, text: scenario.note }] : [],
    observations: (scenario.observations ?? []).map((observation, index) => ({
      id: `${scenario.id}-obs-${index}`,
      text: `${observation.label} ${observation.value} ${observation.unit}`,
    })),
    tasks: (scenario.tasks ?? []).map((task, index) => ({
      id: `${scenario.id}-task-${index}`,
      text: task,
    })),
    encounters: [],
  };
}

/**
 * Run the evaluation suite against an engine.
 *
 * The same function backs both the browser Evaluation Lab and the CLI runner,
 * so the numbers shown in the UI are produced by the same code path that the
 * command line produces.
 */
export async function runEvaluation(
  engine: Engine,
  scenarios: EvaluationScenario[] = EVALUATION_SCENARIOS,
): Promise<EvaluationRun> {
  const started = Date.now();
  const records: PredictionRecord[] = [];

  for (const scenario of scenarios) {
    const input = scenarioToInput(scenario);
    const normalized = normalizeInput(input);

    try {
      const outcome = await engine.classify(scenario);
      const scores = outcome.scores.map((score) => ({
        label: score.label,
        score: score.score,
        similarity: score.similarity,
      }));

      const predicted = selectLabel(scores);
      const confidence = outcome.confidence ?? calibrateConfidence(scores);

      const safetyChecks = runSafetyChecks({
        dataQualityWarnings: [],
        emptyInput: normalized.text.trim().length === 0,
        contradictory: isContradictory(scores),
        ruleHits: [],
        scores,
        inDomain: isInDomain(normalized.text),
        wordCount: countWords(normalized.text),
      });
      const failing = safetyChecks.filter((check) => check.status === 'fail');
      const abstained = outcome.failed || confidence < DECISION_THRESHOLD || failing.length > 0;

      records.push({
        scenarioId: scenario.id,
        category: scenario.category,
        expected: scenario.expected,
        predicted,
        abstained,
        confidence,
        scores: scores.map((score) => ({ label: score.label, score: score.score })),
        engine: engine.name,
        latencyMs: outcome.latencyMs,
        usedFallback: outcome.usedFallback,
        failed: outcome.failed,
        error: outcome.error,
        errorCategory: scenario.errorCategory,
        note: scenario.note,
      });
    } catch (error) {
      records.push({
        scenarioId: scenario.id,
        category: scenario.category,
        expected: scenario.expected,
        predicted: 'routine',
        abstained: true,
        confidence: 0,
        scores: [],
        engine: engine.name,
        latencyMs: 0,
        usedFallback: false,
        failed: true,
        error: error instanceof Error ? error.message : String(error),
        errorCategory: scenario.errorCategory,
        note: scenario.note,
      });
    }
  }

  const metrics = computeMetrics(records);
  const expectations = new Map(
    scenarios.map((scenario) => [scenario.id, scenario.expectAbstention === true]),
  );
  const failures = analyseFailures(records, expectations);

  return {
    engine: engine.name,
    records,
    metrics,
    failures,
    durationMs: Date.now() - started,
    timestamp: new Date().toISOString(),
  };
}

/**
 * The deterministic rules engine, exposed as an evaluation engine.
 * This is the control condition in the Model Lab comparison.
 */
export function createRulesEngine(): Engine {
  return {
    name: 'rules',
    async classify(scenario) {
      const started = Date.now();
      const input = scenarioToInput(scenario);
      const normalized = normalizeInput(input);
      const engineInputs = buildEngineInputs(normalized);
      const { scores } = scoreWithRules(engineInputs.rulesText);
      const rulesResult = classifyWithRules(engineInputs.rulesText);
      return {
        scores,
        confidence: rulesConfidence(engineInputs.rulesText, rulesResult.label),
        latencyMs: Date.now() - started,
        usedFallback: false,
        failed: false,
      };
    },
  };
}

/**
 * A scoring engine that returns similarity-shaped scores, used to verify the
 * metric pipeline without downloading a model.
 */
export function createStubEngine(
  name: string,
  scores: { label: WorkflowLabel; score: number }[],
): Engine {
  return {
    name,
    async classify() {
      return {
        scores: scores.map((score) => ({ ...score, similarity: score.score * 2 - 1 })),
        latencyMs: 1,
        usedFallback: false,
        failed: false,
      };
    },
  };
}

/**
 * The agreement-gated ensemble engine.
 *
 * The embedding model and the deterministic rules engine must independently
 * select the same label before the ensemble will commit. Disagreement is
 * routed to manual review.
 */
export function createEnsembleEngine(modelEngine: Engine): Engine {
  return {
    name: `${modelEngine.name} + rules (agreement-gated)`,
    async classify(scenario) {
      const started = Date.now();
      const modelOutcome = await modelEngine.classify(scenario);
      const input = scenarioToInput(scenario);
      const normalized = normalizeInput(input);
      const engineInputs = buildEngineInputs(normalized);

      const { scores: rulesScores } = scoreWithRules(engineInputs.rulesText);
      const rulesLabel = classifyWithRules(engineInputs.rulesText).label;
      const rulesConfidenceValue = rulesConfidence(engineInputs.rulesText, rulesLabel);

      // The model failed: the rules engine answers alone, and the decision is
      // marked as a fallback so the UI can say so explicitly.
      if (modelOutcome.failed) {
        return {
          scores: rulesScores,
          confidence: rulesConfidenceValue,
          latencyMs: Date.now() - started,
          usedFallback: true,
          failed: false,
        };
      }

      const modelDistribution = similaritiesToDistribution(modelOutcome.scores);
      const modelLabel =
        [...modelDistribution].sort((a, b) => b.score - a.score)[0]?.label ?? 'routine';
      const modelConfidence = calibrateConfidence(modelDistribution);

      const agreed = modelLabel === rulesLabel;
      const fused = agreed
        ? Math.min(0.99, modelConfidence * 0.5 + rulesConfidenceValue * 0.5 + AGREEMENT_BONUS)
        : 0;

      return {
        scores: LABEL_ORDER.map((label) => ({
          label,
          score: Number(
            (
              (modelDistribution.find((score) => score.label === label)?.score ?? 0) * 0.6 +
              (rulesScores.find((score) => score.label === label)?.score ?? 0) * 0.4
            ).toFixed(4),
          ),
          similarity: modelDistribution.find((score) => score.label === label)?.similarity ?? 0,
        })),
        confidence: Number(fused.toFixed(4)),
        latencyMs: Date.now() - started,
        usedFallback: false,
        failed: false,
      };
    },
  };
}

export { LABEL_DEFINITIONS, LABEL_ORDER, DECISION_THRESHOLD };
export type { EvaluationScenario };
