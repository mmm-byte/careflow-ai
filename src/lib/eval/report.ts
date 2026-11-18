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
 * The comparison below separates the two kinds of information:
 *
 *  - **Decision behaviour** - which label was predicted, whether the system
 *    abstained, whether the rules fallback fired, whether the run failed.
 *    These are discrete and must match exactly. A change here is a real change
 *    in the behaviour a reviewer would see.
 *  - **Numeric outputs** - confidence and label scores. These are compared
 *    with a tolerance, because the same quantized model can differ in the last
 *    bits between CPU architectures (a GitHub x86-64 runner versus an
 *    Apple-silicon laptop). The tolerance is far below the size of any
 *    deliberate change to the calibration.
 *  - **Timing** - ignored entirely. Wall-clock numbers are environment
 *    dependent and are not part of the behaviour contract.
 *
 * The result is a gate that fails on a genuine behavioural regression and
 * stays quiet when only the clock moved.
 */
import type { EvaluationMetrics } from './metrics.ts';
import type { WorkflowLabel } from '../ai/types.ts';

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
 * Tolerance for numeric comparison.
 *
 * Scores and confidences are rounded to four decimal places when they are
 * produced, so a genuine change is visible at the third or fourth decimal.
 * A tolerance of 1e-3 absorbs cross-architecture floating-point noise while
 * still catching any real shift in the calibration.
 */
export const NUMERIC_TOLERANCE = 1e-3;

export interface ReportDifference {
  /** Dotted path to the value that differs, e.g. `tuning/rules/records/routine-01/predicted`. */
  path: string;
  /** What the committed report says. */
  expected: string;
  /** What the fresh run produced. */
  actual: string;
}

function numbersEqual(a: number, b: number, tolerance = NUMERIC_TOLERANCE): boolean {
  if (Number.isNaN(a) && Number.isNaN(b)) return true;
  return Math.abs(a - b) <= tolerance;
}

function formatValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * Compare the behaviour recorded by two reports.
 *
 * Returns an empty array when the two runs behaved identically.
 */
export function compareReports(
  committed: EvaluationReport,
  fresh: EvaluationReport,
): ReportDifference[] {
  const differences: ReportDifference[] = [];

  const push = (path: string, expected: unknown, actual: unknown) => {
    differences.push({ path, expected: formatValue(expected), actual: formatValue(actual) });
  };

  const committedSuites = committed.suites ?? [];
  const freshSuites = fresh.suites ?? [];

  if (committedSuites.length !== freshSuites.length) {
    push('suites/length', committedSuites.length, freshSuites.length);
    return differences;
  }

  for (let suiteIndex = 0; suiteIndex < committedSuites.length; suiteIndex += 1) {
    const expectedSuite = committedSuites[suiteIndex];
    const actualSuite = freshSuites[suiteIndex];
    const suitePath = expectedSuite.suite ?? `suites[${suiteIndex}]`;

    if (expectedSuite.suite !== actualSuite.suite) {
      push(`${suitePath}/suite`, expectedSuite.suite, actualSuite.suite);
      continue;
    }

    if (expectedSuite.scenarioCount !== actualSuite.scenarioCount) {
      push(`${suitePath}/scenarioCount`, expectedSuite.scenarioCount, actualSuite.scenarioCount);
    }

    const expectedRuns = expectedSuite.runs ?? [];
    const actualRuns = actualSuite.runs ?? [];

    if (expectedRuns.length !== actualRuns.length) {
      push(`${suitePath}.runs.length`, expectedRuns.length, actualRuns.length);
      continue;
    }

    for (let runIndex = 0; runIndex < expectedRuns.length; runIndex += 1) {
      const expectedRun = expectedRuns[runIndex];
      const actualRun = actualRuns[runIndex];
      const runPath = `${suitePath}/runs/${expectedRun.engine}`;

      if (expectedRun.engine !== actualRun.engine) {
        push(`${runPath}/engine`, expectedRun.engine, actualRun.engine);
        continue;
      }

      compareRun(expectedRun, actualRun, runPath, push);
    }
  }

  return differences;
}

function compareRun(
  expectedRun: ReportRun,
  actualRun: ReportRun,
  runPath: string,
  push: (path: string, expected: unknown, actual: unknown) => void,
): void {
  const expectedRecords = expectedRun.records ?? [];
  const actualRecords = actualRun.records ?? [];

  if (expectedRecords.length !== actualRecords.length) {
    push(`${runPath}/records.length`, expectedRecords.length, actualRecords.length);
    return;
  }

  for (let index = 0; index < expectedRecords.length; index += 1) {
    const expectedRecord = expectedRecords[index];
    const actualRecord = actualRecords[index];
    const recordPath = `${runPath}/records/${expectedRecord.scenarioId}`;

    if (expectedRecord.scenarioId !== actualRecord.scenarioId) {
      push(`${recordPath}/scenarioId`, expectedRecord.scenarioId, actualRecord.scenarioId);
      continue;
    }

    // Discrete decision behaviour: these must match exactly.
    if (expectedRecord.predicted !== actualRecord.predicted) {
      push(`${recordPath}/predicted`, expectedRecord.predicted, actualRecord.predicted);
    }
    if (expectedRecord.expected !== actualRecord.expected) {
      push(`${recordPath}/expected`, expectedRecord.expected, actualRecord.expected);
    }
    if (expectedRecord.abstained !== actualRecord.abstained) {
      push(`${recordPath}/abstained`, expectedRecord.abstained, actualRecord.abstained);
    }
    if (expectedRecord.usedFallback !== actualRecord.usedFallback) {
      push(`${recordPath}/usedFallback`, expectedRecord.usedFallback, actualRecord.usedFallback);
    }
    if (expectedRecord.failed !== actualRecord.failed) {
      push(`${recordPath}/failed`, expectedRecord.failed, actualRecord.failed);
    }

    // Numeric outputs: compared with a tolerance for cross-platform noise.
    if (!numbersEqual(expectedRecord.confidence, actualRecord.confidence)) {
      push(`${recordPath}/confidence`, expectedRecord.confidence, actualRecord.confidence);
    }

    const expectedScores = expectedRecord.scores ?? [];
    const actualScores = actualRecord.scores ?? [];
    for (let scoreIndex = 0; scoreIndex < expectedScores.length; scoreIndex += 1) {
      const expectedScore = expectedScores[scoreIndex];
      const actualScore = actualScores[scoreIndex];
      if (!expectedScore || !actualScore) continue;
      if (expectedScore.label !== actualScore.label) {
        push(`${recordPath}/scores/${scoreIndex}/label`, expectedScore.label, actualScore.label);
      } else if (!numbersEqual(expectedScore.score, actualScore.score)) {
        push(`${recordPath}/scores/${expectedScore.label}`, expectedScore.score, actualScore.score);
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
    push(`${runPath}/failures`, expectedFailures.join(', '), actualFailures.join(', '));
  }
}

function compareMetrics(
  expectedMetrics: EvaluationMetrics,
  actualMetrics: EvaluationMetrics,
  path: string,
  push: (path: string, expected: unknown, actual: unknown) => void,
): void {
  const discrete = [
    'total',
    'completed',
    'failed',
    'coverage',
    'abstentionRate',
    'fallbackRate',
  ] as const;

  for (const key of discrete) {
    if (expectedMetrics[key] !== actualMetrics[key]) {
      push(`${path}/${key}`, expectedMetrics[key], actualMetrics[key]);
    }
  }

  const numeric = ['accuracy', 'selectiveAccuracy', 'macroF1'] as const;
  for (const key of numeric) {
    if (!numbersEqual(expectedMetrics[key], actualMetrics[key])) {
      push(`${path}/${key}`, expectedMetrics[key], actualMetrics[key]);
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
        `support ${expectedClass.support}, tp ${expectedClass.truePositives}, fp ${expectedClass.falsePositives}, fn ${expectedClass.falseNegatives}`,
        `support ${actualClass.support}, tp ${actualClass.truePositives}, fp ${actualClass.falsePositives}, fn ${actualClass.falseNegatives}`,
      );
    }
    if (!numbersEqual(expectedClass.f1, actualClass.f1)) {
      push(`${classPath}/f1`, expectedClass.f1, actualClass.f1);
    }
  }

  for (let index = 0; index < expectedMetrics.confusionMatrix.length; index += 1) {
    const expectedCell = expectedMetrics.confusionMatrix[index];
    const actualCell = actualMetrics.confusionMatrix[index];
    if (!expectedCell || !actualCell) continue;
    if (expectedCell.count !== actualCell.count) {
      push(
        `${path}/confusionMatrix/${expectedCell.expected}->${expectedCell.predicted}`,
        expectedCell.count,
        actualCell.count,
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
