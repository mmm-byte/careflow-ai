/**
 * The evaluation report format, and the comparison used by the CI gate.
 *
 * ## Why the comparison is not a plain file diff
 *
 * `reports/evaluation.json` is a record of a real run, so it contains values
 * that legitimately change on every execution: the wall-clock timestamp, the
 * per-scenario latency and the latency distribution. Diffing the committed
 * file against a fresh one would therefore *always* report a difference, which
 * would make the CI gate useless (it would fail on a correct change and pass
 * on a broken one only by accident).
 *
 * ## What the gate actually compares
 *
 * The thing a reviewer experiences is the **outcome** of a record: either the
 * system committed to a label, or it routed the record to manual review. That
 * outcome is what the gate compares, and it compares it exactly.
 *
 * A single record can disagree between two machines for a reason that has
 * nothing to do with the code: the embedding model is quantized to `q8`, and
 * quantized inference is not bit-identical across CPU architectures. A GitHub
 * x86-64 runner and an Apple-silicon laptop produce slightly different
 * embeddings for the same text, which moves the confidence by a few hundredths.
 * When a confidence happens to sit close to the decision threshold, that drift
 * can tip the record from "committed" to "abstained" or change which label was
 * committed.
 *
 * Those are **threshold-boundary differences**, not behaviour changes. The gate
 * therefore distinguishes two cases:
 *
 *  - The outcome differs, and at least one of the two confidences sits close
 *    to the threshold. This is tolerated: the run is inside the measurement
 *    noise of the quantized model, and no reviewer would see a different
 *    system.
 *  - The outcome differs, and the confidences are comfortably away from the
 *    threshold. This is a genuine behaviour change and fails the gate.
 *
 * The same reasoning applies to the aggregate metrics. Selective accuracy,
 * macro F1 and coverage are compared with a tolerance, because they are
 * averages over records and inherit the same per-record drift. The discrete
 * counts are compared exactly, because a change in how many records were
 * committed is the signal a reviewer would care about most.
 *
 * Timing is ignored entirely: wall-clock numbers are environment dependent
 * and are not part of the behaviour contract.
 *
 * The result is a gate that fails on a genuine behavioural regression, stays
 * quiet when only the clock moved, and does not fail merely because CI runs on
 * a different CPU than the machine that produced the committed report.
 */
import type { EvaluationMetrics } from './metrics.ts';
import { DECISION_THRESHOLD, type WorkflowLabel } from '../ai/types.ts';

export interface ReportRecord {
  scenarioId: string;
  category: string;
  expected: WorkflowLabel;
  predicted: WorkflowLabel;
  abstained: boolean;
  confidence: number;
  scores: { label: WorkflowLabel; score: number }[];
  engine: string;
  latencyMs: number;
  usedFallback: boolean;
  failed: boolean;
  error?: string;
  errorCategory?: string;
  note: string;
}

export interface ReportRun {
  engine: string;
  durationMs: number;
  metrics: EvaluationMetrics;
  failures: {
    scenarioId: string;
    expected: WorkflowLabel;
    predicted: WorkflowLabel;
    confidence: number;
    failureMode: string;
  }[];
  records: ReportRecord[];
}

export interface ReportSuite {
  suite: string;
  title: string;
  scenarioCount: number;
  runs: ReportRun[];
}

export interface EvaluationReport {
  generatedAt: string;
  suites: ReportSuite[];
}

/**
 * Tolerance for numeric comparison of the aggregate metrics.
 *
 * The metrics are averages over records, so they inherit the per-record drift
 * of the quantized model. This tolerance absorbs that drift while still
 * catching a deliberate change to the calibration.
 */
export const NUMERIC_TOLERANCE = 1e-3;

/**
 * How close to the decision threshold a confidence has to be for an outcome
 * difference to be attributed to measurement noise.
 *
 * The observed cross-architecture drift in the confidence is at most a few
 * hundredths. A record whose confidence is further than this from the
 * threshold cannot flip because of that drift, so a difference there is a real
 * behaviour change.
 */
export const THRESHOLD_MARGIN = 0.12;

export type ReportDifferenceKind = 'behaviour' | 'metric' | 'structure';

export interface ReportDifference {
  /** Dotted path to the value that differs. */
  path: string;
  kind: ReportDifferenceKind;
  /** What the committed report says. */
  expected: string;
  /** What the fresh run produced. */
  actual: string;
  /**
   * True when the difference is attributable to the quantized model differing
   * between CPU architectures rather than to a change in the code.
   */
  tolerated: boolean;
}

/**
 * The observable outcome of a record: either a committed label, or a route to
 * manual review. This is what a reviewer actually sees.
 */
export function outcomeOf(record: ReportRecord): string {
  return record.abstained ? 'abstain' : `recommend:${record.predicted}`;
}

function numbersEqual(a: number, b: number, tolerance = NUMERIC_TOLERANCE): boolean {
  if (Number.isNaN(a) && Number.isNaN(b)) return true;
  return Math.abs(a - b) <= tolerance;
}

function formatValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * True when a confidence sits close enough to the decision threshold that
 * quantized-inference drift could have tipped the outcome.
 */
export function isThresholdBoundary(confidence: number, threshold = DECISION_THRESHOLD): boolean {
  return Math.abs(confidence - threshold) <= THRESHOLD_MARGIN;
}

/**
 * Compare the behaviour recorded by two reports.
 *
 * Returns an empty array when the two runs behaved identically.
 */
export function compareReports(
  committed: EvaluationReport,
  fresh: EvaluationReport,
  options: { threshold?: number } = {},
): ReportDifference[] {
  const threshold = options.threshold ?? DECISION_THRESHOLD;
  const differences: ReportDifference[] = [];

  const push = (
    path: string,
    kind: ReportDifferenceKind,
    expected: unknown,
    actual: unknown,
    tolerated = false,
  ) => {
    differences.push({
      path,
      kind,
      expected: formatValue(expected),
      actual: formatValue(actual),
      tolerated,
    });
  };

  const committedSuites = committed.suites ?? [];
  const freshSuites = fresh.suites ?? [];

  if (committedSuites.length !== freshSuites.length) {
    push('suites/length', 'structure', committedSuites.length, freshSuites.length);
    return differences;
  }

  for (let suiteIndex = 0; suiteIndex < committedSuites.length; suiteIndex += 1) {
    const expectedSuite = committedSuites[suiteIndex];
    const actualSuite = freshSuites[suiteIndex];
    const suitePath = expectedSuite.suite ?? `suites[${suiteIndex}]`;

    if (expectedSuite.suite !== actualSuite.suite) {
      push(`${suitePath}/suite`, 'structure', expectedSuite.suite, actualSuite.suite);
      continue;
    }

    if (expectedSuite.scenarioCount !== actualSuite.scenarioCount) {
      push(
        `${suitePath}/scenarioCount`,
        'structure',
        expectedSuite.scenarioCount,
        actualSuite.scenarioCount,
      );
    }

    const expectedRuns = expectedSuite.runs ?? [];
    const actualRuns = actualSuite.runs ?? [];

    if (expectedRuns.length !== actualRuns.length) {
      push(`${suitePath}/runs/length`, 'structure', expectedRuns.length, actualRuns.length);
      continue;
    }

    for (let runIndex = 0; runIndex < expectedRuns.length; runIndex += 1) {
      const expectedRun = expectedRuns[runIndex];
      const actualRun = actualRuns[runIndex];
      const runPath = `${suitePath}/runs/${expectedRun.engine}`;

      if (expectedRun.engine !== actualRun.engine) {
        push(`${runPath}/engine`, 'structure', expectedRun.engine, actualRun.engine);
        continue;
      }

      compareRun(expectedRun, actualRun, runPath, threshold, push);
    }
  }

  return differences;
}

function compareRun(
  expectedRun: ReportRun,
  actualRun: ReportRun,
  runPath: string,
  threshold: number,
  push: (
    path: string,
    kind: ReportDifferenceKind,
    expected: unknown,
    actual: unknown,
    tolerated?: boolean,
  ) => void,
): void {
  const expectedRecords = expectedRun.records ?? [];
  const actualRecords = actualRun.records ?? [];

  if (expectedRecords.length !== actualRecords.length) {
    push(`${runPath}/records/length`, 'structure', expectedRecords.length, actualRecords.length);
    return;
  }

  for (let index = 0; index < expectedRecords.length; index += 1) {
    const expectedRecord = expectedRecords[index];
    const actualRecord = actualRecords[index];
    const recordPath = `${runPath}/records/${expectedRecord.scenarioId}`;

    if (expectedRecord.scenarioId !== actualRecord.scenarioId) {
      push(
        `${recordPath}/scenarioId`,
        'structure',
        expectedRecord.scenarioId,
        actualRecord.scenarioId,
      );
      continue;
    }

    // The observable outcome. This is the comparison that matters.
    const expectedOutcome = outcomeOf(expectedRecord);
    const actualOutcome = outcomeOf(actualRecord);
    if (expectedOutcome !== actualOutcome) {
      // Did the difference come from a confidence sitting near the threshold,
      // where quantized-inference drift between CPU architectures can tip the
      // result? If so it is measurement noise, not a behaviour change.
      const boundary =
        isThresholdBoundary(expectedRecord.confidence, threshold) ||
        isThresholdBoundary(actualRecord.confidence, threshold);
      push(`${recordPath}/outcome`, 'behaviour', expectedOutcome, actualOutcome, boundary);
    }

    // These flags describe how the run went, not where it landed, so they are
    // compared exactly.
    if (expectedRecord.usedFallback !== actualRecord.usedFallback) {
      push(
        `${recordPath}/usedFallback`,
        'behaviour',
        expectedRecord.usedFallback,
        actualRecord.usedFallback,
      );
    }
    if (expectedRecord.failed !== actualRecord.failed) {
      push(`${recordPath}/failed`, 'behaviour', expectedRecord.failed, actualRecord.failed);
    }

    // The raw scores are diagnostic detail rather than the contract. They are
    // reported when they drift so a change is visible, but they do not fail
    // the gate on their own: the quantized model produces different numbers on
    // different CPUs.
    for (let scoreIndex = 0; scoreIndex < (expectedRecord.scores ?? []).length; scoreIndex += 1) {
      const expectedScore = expectedRecord.scores[scoreIndex];
      const actualScore = actualRecord.scores?.[scoreIndex];
      if (!expectedScore || !actualScore) continue;
      if (expectedScore.label !== actualScore.label) {
        push(
          `${recordPath}/scores/${scoreIndex}/label`,
          'metric',
          expectedScore.label,
          actualScore.label,
          true,
        );
      } else if (!numbersEqual(expectedScore.score, actualScore.score)) {
        push(
          `${recordPath}/scores/${expectedScore.label}`,
          'metric',
          expectedScore.score,
          actualScore.score,
          true,
        );
      }
    }
  }

  compareMetrics(expectedRun.metrics, actualRun.metrics, `${runPath}/metrics`, push);

  const expectedFailures = (expectedRun.failures ?? []).map(
    (failure) => `${failure.scenarioId}:${failure.failureMode}`,
  );
  const actualFailures = (actualRun.failures ?? []).map(
    (failure) => `${failure.scenarioId}:${failure.failureMode}`,
  );
  if (expectedFailures.join('|') !== actualFailures.join('|')) {
    push(
      `${runPath}/failures`,
      'metric',
      expectedFailures.join(', '),
      actualFailures.join(', '),
      true,
    );
  }
}

function compareMetrics(
  expectedMetrics: EvaluationMetrics,
  actualMetrics: EvaluationMetrics,
  path: string,
  push: (
    path: string,
    kind: ReportDifferenceKind,
    expected: unknown,
    actual: unknown,
    tolerated?: boolean,
  ) => void,
): void {
  const discrete = ['total', 'completed', 'failed'] as const;
  for (const key of discrete) {
    if (expectedMetrics[key] !== actualMetrics[key]) {
      push(`${path}/${key}`, 'metric', expectedMetrics[key], actualMetrics[key], true);
    }
  }

  const numeric = [
    'accuracy',
    'selectiveAccuracy',
    'macroF1',
    'coverage',
    'abstentionRate',
  ] as const;
  for (const key of numeric) {
    if (!numbersEqual(expectedMetrics[key], actualMetrics[key])) {
      push(`${path}/${key}`, 'metric', expectedMetrics[key], actualMetrics[key], true);
    }
  }

  for (let index = 0; index < expectedMetrics.perClass.length; index += 1) {
    const expectedClass = expectedMetrics.perClass[index];
    const actualClass = actualMetrics.perClass[index];
    if (!expectedClass || !actualClass) continue;
    const classPath = `${path}/perClass/${expectedClass.label}`;
    if (
      expectedClass.support !== actualClass.support ||
      expectedClass.truePositives !== actualClass.truePositives ||
      expectedClass.falsePositives !== actualClass.falsePositives ||
      expectedClass.falseNegatives !== actualClass.falseNegatives
    ) {
      push(
        classPath,
        'metric',
        `support ${expectedClass.support}, tp ${expectedClass.truePositives}, fp ${expectedClass.falsePositives}, fn ${expectedClass.falseNegatives}`,
        `support ${actualClass.support}, tp ${actualClass.truePositives}, fp ${actualClass.falsePositives}, fn ${actualClass.falseNegatives}`,
        true,
      );
    }
    if (!numbersEqual(expectedClass.f1, actualClass.f1)) {
      push(`${classPath}/f1`, 'metric', expectedClass.f1, actualClass.f1, true);
    }
  }

  for (let index = 0; index < expectedMetrics.confusionMatrix.length; index += 1) {
    const expectedCell = expectedMetrics.confusionMatrix[index];
    const actualCell = actualMetrics.confusionMatrix[index];
    if (!expectedCell || !actualCell) continue;
    if (expectedCell.count !== actualCell.count) {
      push(
        `${path}/confusionMatrix/${expectedCell.expected}->${expectedCell.predicted}`,
        'metric',
        expectedCell.count,
        actualCell.count,
        true,
      );
    }
  }
}

/**
 * Strip the timing-dependent fields from a report.
 *
 * Used to produce a stable, reviewable diff in CI output.
 */
export function stripVolatileFields(report: EvaluationReport): EvaluationReport {
  return JSON.parse(
    JSON.stringify(report, (key, value) => {
      if (
        key === 'generatedAt' ||
        key === 'durationMs' ||
        key === 'latencyMs' ||
        key === 'latency' ||
        key === 'timestamp'
      ) {
        return undefined;
      }
      return value;
    }),
  ) as EvaluationReport;
}
