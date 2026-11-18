import type { WorkflowLabel } from '../ai/types.ts';
import { LABEL_ORDER } from '../ai/types.ts';

export interface PredictionRecord {
  scenarioId: string;
  category: string;
  expected: WorkflowLabel;
  predicted: WorkflowLabel;
  /** True when the system withheld a recommendation and routed to manual review. */
  abstained: boolean;
  confidence: number;
  scores: { label: WorkflowLabel; score: number }[];
  /** Which engine produced the prediction. */
  engine: string;
  latencyMs: number;
  /** True when the model path failed and the rules engine produced the result. */
  usedFallback: boolean;
  /** True when the run itself failed (exception, malformed input). */
  failed: boolean;
  error?: string;
  errorCategory?: string;
  note: string;
}

export interface ClassMetrics {
  label: WorkflowLabel;
  support: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface ConfusionCell {
  expected: WorkflowLabel;
  predicted: WorkflowLabel;
  count: number;
}

export interface LatencyDistribution {
  count: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  p95: number;
}

export interface EvaluationMetrics {
  total: number;
  /** Scenarios that produced a usable prediction. */
  completed: number;
  failed: number;
  /** Accuracy over scenarios that produced a prediction. */
  accuracy: number;
  /**
   * Accuracy over scenarios where the system committed to a label
   * (abstentions excluded). This is the metric that reflects the quality of
   * the decisions a reviewer actually receives.
   */
  selectiveAccuracy: number;
  macroF1: number;
  perClass: ClassMetrics[];
  confusionMatrix: ConfusionCell[];
  /** Share of scenarios where the system made a recommendation. */
  coverage: number;
  /** Share of scenarios routed to manual review. */
  abstentionRate: number;
  /** Share of runs that fell back from the model to the rules engine. */
  fallbackRate: number;
  latency: LatencyDistribution;
  byCategory: {
    category: string;
    total: number;
    correct: number;
    abstained: number;
  }[];
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(4));
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

export function computeMetrics(records: PredictionRecord[]): EvaluationMetrics {
  const completed = records.filter((record) => !record.failed);
  const failed = records.length - completed.length;

  /**
   * Per-class metrics are computed over *committed* predictions only.
   *
   * An abstention is not a correct answer: the system declined to route the
   * record, so it cannot also be counted as a correct classification of the
   * expected label. Counting abstentions as errors in the confusion matrix
   * keeps the table honest about how often the system declines to act.
   */
  const perClass: ClassMetrics[] = LABEL_ORDER.map((label) => {
    let truePositives = 0;
    let falsePositives = 0;
    let falseNegatives = 0;
    let support = 0;

    for (const record of completed) {
      const expectedMatch = record.expected === label;
      // An abstention is neither a true positive nor a false positive; it is
      // a missed opportunity, counted as a false negative for the expected class.
      if (record.abstained) {
        if (expectedMatch) falseNegatives += 1;
        continue;
      }
      const predictedMatch = record.predicted === label;
      if (expectedMatch) support += 1;
      if (expectedMatch && predictedMatch) truePositives += 1;
      else if (!expectedMatch && predictedMatch) falsePositives += 1;
      else if (expectedMatch && !predictedMatch) falseNegatives += 1;
    }

    const precision = ratio(truePositives, truePositives + falsePositives);
    const recall = ratio(truePositives, truePositives + falseNegatives);
    const f1 =
      precision + recall === 0 ? 0 : round((2 * precision * recall) / (precision + recall));

    return { label, support, truePositives, falsePositives, falseNegatives, precision, recall, f1 };
  });

  const correct = completed.filter(
    (record) => !record.abstained && record.expected === record.predicted,
  ).length;
  const committed = completed.filter((record) => !record.abstained);
  const committedCorrect = committed.filter(
    (record) => record.expected === record.predicted,
  ).length;
  const accuracy = ratio(correct, completed.length);
  const selectiveAccuracy = ratio(committedCorrect, committed.length);

  const macroF1 = round(
    perClass.reduce((sum, metrics) => sum + metrics.f1, 0) / (perClass.length || 1),
  );

  const confusionMatrix: ConfusionCell[] = [];
  for (const expected of LABEL_ORDER) {
    for (const predicted of LABEL_ORDER) {
      const count = completed.filter(
        (record) =>
          !record.abstained && record.expected === expected && record.predicted === predicted,
      ).length;
      confusionMatrix.push({ expected, predicted, count });
    }
  }

  const abstained = completed.filter((record) => record.abstained).length;
  const fallbacks = records.filter((record) => record.usedFallback).length;

  const latencies = records
    .filter((record) => !record.failed)
    .map((record) => record.latencyMs)
    .sort((a, b) => a - b);
  const latency: LatencyDistribution = latencies.length
    ? {
        count: latencies.length,
        min: latencies[0],
        max: latencies[latencies.length - 1],
        mean: round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length),
        median: latencies[Math.floor(latencies.length / 2)],
        p95: latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))],
      }
    : { count: 0, min: 0, max: 0, mean: 0, median: 0, p95: 0 };

  const categories = [...new Set(records.map((record) => record.category))].sort();
  const byCategory = categories.map((category) => {
    const subset = records.filter((record) => record.category === category);
    const usable = subset.filter((record) => !record.failed);
    return {
      category,
      total: subset.length,
      correct: usable.filter((record) => !record.abstained && record.expected === record.predicted)
        .length,
      abstained: usable.filter((record) => record.abstained).length,
    };
  });

  return {
    total: records.length,
    completed: completed.length,
    failed,
    accuracy,
    selectiveAccuracy,
    macroF1,
    perClass,
    confusionMatrix,
    coverage: ratio(committed.length, records.length),
    abstentionRate: ratio(abstained, records.length),
    fallbackRate: ratio(fallbacks, records.length),
    latency,
    byCategory,
  };
}

export interface FailureAnalysisEntry {
  scenarioId: string;
  category: string;
  expected: WorkflowLabel;
  predicted: WorkflowLabel;
  confidence: number;
  scores: { label: WorkflowLabel; score: number }[];
  note: string;
  /** What the scenario was designed to probe. */
  errorCategory: string;
  /** What actually went wrong in this run. */
  failureMode: string;
  /** Suggested engineering response for this failure mode. */
  response: string;
}

/**
 * A scenario is treated as a failure when the prediction is wrong, when the
 * scenario should have abstained but did not, or when the system abstained on
 * a scenario where it was expected to be decisive.
 */
export function analyseFailures(
  records: PredictionRecord[],
  expectations: Map<string, boolean>,
): FailureAnalysisEntry[] {
  const responses: Record<string, string> = {
    'low-information':
      'Require a minimum content signal before classification; route thin notes to manual review.',
    'missing-data':
      'Block classification when no usable resource content exists and ask the reviewer to complete the record.',
    'out-of-distribution':
      'Add an in-domain relevance check before classification and abstain on non-care content.',
    'contradictory-evidence':
      'Surface the conflicting signals in the Decision Inspector and require reviewer arbitration.',
    'wrong-label': 'Review the prototype wording and add the scenario to the regression suite.',
    'unexpected-abstention':
      'Lower the abstention threshold for high-signal scenarios and re-check calibration.',
    'unexpected-recommendation':
      'Tighten the abstention threshold so low-signal scenarios route to manual review.',
    'run-failure':
      'Investigate the engine error; the rules fallback should have covered this case.',
  };

  const failures: FailureAnalysisEntry[] = [];
  for (const record of records) {
    const expectedAbstention = expectations.get(record.scenarioId) ?? false;
    let failureMode: string | null = null;

    if (record.failed) {
      failureMode = 'run-failure';
    } else if (expectedAbstention) {
      // The scenario's contract is "route this to a human". Abstaining is the
      // correct outcome, so only a confident recommendation is a failure.
      if (!record.abstained) failureMode = 'unexpected-recommendation';
    } else if (record.abstained) {
      failureMode = 'unexpected-abstention';
    } else if (record.expected !== record.predicted) {
      failureMode = 'wrong-label';
    }

    if (!failureMode) continue;

    failures.push({
      scenarioId: record.scenarioId,
      category: record.category,
      expected: record.expected,
      predicted: record.predicted,
      confidence: record.confidence,
      scores: record.scores,
      note: record.note,
      errorCategory: record.errorCategory ?? record.category,
      failureMode,
      response: responses[failureMode] ?? responses['wrong-label'],
    });
  }

  return failures;
}
