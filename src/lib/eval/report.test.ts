import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compareReports,
  isThresholdBoundary,
  NUMERIC_TOLERANCE,
  THRESHOLD_MARGIN,
} from './report.ts';
import type { EvaluationReport, ReportSuite } from './report.ts';

interface Overrides {
  confidence?: number;
  predicted?: 'priority' | 'follow-up' | 'routine';
  abstained?: boolean;
  usedFallback?: boolean;
  failed?: boolean;
  score?: number;
  latencyMs?: number;
  generatedAt?: string;
  durationMs?: number;
  omitFailures?: boolean;
  selectiveAccuracy?: number;
  macroF1?: number;
  coverage?: number;
}

function makeReport(overrides: Overrides = {}): EvaluationReport {
  const confidence = overrides.confidence ?? 0.9;
  const predicted = overrides.predicted ?? 'routine';
  const abstained = overrides.abstained ?? false;
  const coverage = overrides.coverage ?? (abstained ? 0 : 1);
  const selectiveAccuracy = overrides.selectiveAccuracy ?? (abstained ? 0 : 1);

  const suite: ReportSuite = {
    suite: 'tuning',
    title: 'Tuning suite',
    scenarioCount: 1,
    runs: [
      {
        engine: 'rules',
        durationMs: overrides.durationMs ?? 10,
        metrics: {
          total: 1,
          completed: 1,
          failed: overrides.failed ? 1 : 0,
          accuracy: selectiveAccuracy,
          selectiveAccuracy,
          macroF1: overrides.macroF1 ?? 1,
          perClass: [
            {
              label: 'priority',
              support: 0,
              truePositives: 0,
              falsePositives: 0,
              falseNegatives: 0,
              precision: 0,
              recall: 0,
              f1: 0,
            },
            {
              label: 'follow-up',
              support: 0,
              truePositives: 0,
              falsePositives: 0,
              falseNegatives: 0,
              precision: 0,
              recall: 0,
              f1: 0,
            },
            {
              label: 'routine',
              support: 1,
              truePositives: 1,
              falsePositives: 0,
              falseNegatives: 0,
              precision: 1,
              recall: 1,
              f1: 1,
            },
          ],
          confusionMatrix: [
            { expected: 'priority', predicted: 'priority', count: 0 },
            { expected: 'priority', predicted: 'follow-up', count: 0 },
            { expected: 'priority', predicted: 'routine', count: 0 },
            { expected: 'follow-up', predicted: 'priority', count: 0 },
            { expected: 'follow-up', predicted: 'follow-up', count: 0 },
            { expected: 'follow-up', predicted: 'routine', count: 0 },
            { expected: 'routine', predicted: 'priority', count: 0 },
            { expected: 'routine', predicted: 'follow-up', count: 0 },
            { expected: 'routine', predicted: 'routine', count: 1 },
          ],
          coverage,
          abstentionRate: abstained ? 1 : 0,
          fallbackRate: overrides.usedFallback ? 1 : 0,
          latency: {
            count: 1,
            min: overrides.latencyMs ?? 1,
            max: overrides.latencyMs ?? 1,
            mean: overrides.latencyMs ?? 1,
            median: overrides.latencyMs ?? 1,
            p95: overrides.latencyMs ?? 1,
          },
          byCategory: [{ category: 'routine', total: 1, correct: 1, abstained: 0 }],
        },
        failures: overrides.omitFailures
          ? []
          : [
              {
                scenarioId: 'x-1',
                expected: 'routine',
                predicted,
                confidence,
                failureMode: 'unexpected-abstention',
              },
            ],
        records: [
          {
            scenarioId: 'x-1',
            category: 'routine',
            expected: 'routine',
            predicted,
            abstained,
            confidence,
            scores: [
              { label: 'priority', score: 0 },
              { label: 'follow-up', score: 0 },
              { label: 'routine', score: overrides.score ?? 1 },
            ],
            engine: 'rules',
            latencyMs: overrides.latencyMs ?? 1,
            usedFallback: overrides.usedFallback ?? false,
            failed: overrides.failed ?? false,
            note: 'Synthetic note.',
          },
        ],
      },
    ],
  };

  return {
    generatedAt: overrides.generatedAt ?? '2026-01-01T00:00:00.000Z',
    suites: [suite],
  };
}

/** Differences that the gate treats as a real behaviour change. */
function fatal(differences: ReturnType<typeof compareReports>): typeof differences {
  return differences.filter((difference) => !difference.tolerated);
}

test('two identical reports produce no differences', () => {
  assert.deepEqual(compareReports(makeReport(), makeReport()), []);
});

test('the generation timestamp is ignored', () => {
  const differences = compareReports(
    makeReport({ generatedAt: '2026-01-01T00:00:00.000Z' }),
    makeReport({ generatedAt: '2027-06-06T12:34:56.789Z' }),
  );
  assert.deepEqual(differences, []);
});

test('latency fields are ignored', () => {
  const differences = compareReports(
    makeReport({ latencyMs: 1, durationMs: 10 }),
    makeReport({ latencyMs: 999, durationMs: 5000 }),
  );
  assert.deepEqual(differences, []);
});

test('a committed label that changes far from the threshold fails the gate', () => {
  const differences = compareReports(
    makeReport({ predicted: 'routine', confidence: 0.95 }),
    makeReport({ predicted: 'priority', confidence: 0.95 }),
  );
  const failures = fatal(differences);
  assert.equal(failures.length, 1);
  assert.match(failures[0]!.path, /outcome$/);
  assert.equal(failures[0]!.expected, 'recommend:routine');
  assert.equal(failures[0]!.actual, 'recommend:priority');
});

test('an abstention that changes far from the threshold fails the gate', () => {
  const differences = compareReports(
    makeReport({ abstained: false, confidence: 0.95 }),
    makeReport({ abstained: true, confidence: 0.95 }),
  );
  const failures = fatal(differences);
  assert.equal(failures.length, 1);
  assert.match(failures[0]!.path, /outcome$/);
});

test('an outcome change near the threshold is tolerated as model drift', () => {
  // 0.7564 and 0.7436 are both close to the 0.75 threshold, so a quantized
  // model that differs slightly between CPUs can tip the outcome.
  const differences = compareReports(
    makeReport({ abstained: false, confidence: 0.7564 }),
    makeReport({ abstained: true, confidence: 0.7436 }),
  );
  assert.equal(fatal(differences).length, 0);
  assert.ok(differences.length > 0, 'the difference should still be reported');
  assert.ok(differences.every((difference) => difference.tolerated));
});

test('a changed fallback flag always fails the gate', () => {
  const differences = compareReports(
    makeReport({ usedFallback: false }),
    makeReport({ usedFallback: true }),
  );
  assert.equal(fatal(differences).length, 1);
});

test('a changed failure flag always fails the gate', () => {
  const differences = compareReports(makeReport({ failed: false }), makeReport({ failed: true }));
  assert.equal(fatal(differences).length, 1);
});

test('a score drift is reported but does not fail the gate', () => {
  const differences = compareReports(makeReport({ score: 1 }), makeReport({ score: 0.5 }));
  assert.ok(differences.length > 0);
  assert.equal(fatal(differences).length, 0);
});

test('a changed aggregate metric is reported but does not fail the gate', () => {
  const differences = compareReports(
    makeReport({ selectiveAccuracy: 1, macroF1: 1, coverage: 1 }),
    makeReport({ selectiveAccuracy: 0.5, macroF1: 0.5, coverage: 0.5 }),
  );
  assert.ok(differences.length > 0);
  assert.equal(fatal(differences).length, 0);
});

test('a missing suite is a structural failure', () => {
  const committed = makeReport();
  const fresh = makeReport();
  fresh.suites = [];
  const differences = compareReports(committed, fresh);
  assert.equal(fatal(differences).length, 1);
  assert.match(differences[0]!.path, /suites\/length/);
});

test('a renamed engine is a structural failure', () => {
  const committed = makeReport();
  const fresh = makeReport();
  fresh.suites[0]!.runs[0]!.engine = 'embedding-model';
  const differences = compareReports(committed, fresh);
  assert.equal(fatal(differences).length, 1);
  assert.ok(differences.some((difference) => difference.path.endsWith('/engine')));
});

test('a changed suite identifier is a structural failure', () => {
  const committed = makeReport();
  const fresh = makeReport();
  fresh.suites[0]!.suite = 'validation';
  const differences = compareReports(committed, fresh);
  assert.equal(fatal(differences).length, 1);
  assert.ok(differences.some((difference) => difference.path.endsWith('/suite')));
});

test('a changed scenario count is a structural failure', () => {
  const committed = makeReport();
  const fresh = makeReport();
  fresh.suites[0]!.scenarioCount = 99;
  const differences = compareReports(committed, fresh);
  assert.equal(fatal(differences).length, 1);
});

test('the threshold boundary rule matches the intended margin', () => {
  assert.equal(isThresholdBoundary(0.75), true);
  assert.equal(isThresholdBoundary(0.75 + THRESHOLD_MARGIN), true);
  assert.equal(isThresholdBoundary(0.75 + THRESHOLD_MARGIN + 0.01), false);
  assert.equal(isThresholdBoundary(0.75 - THRESHOLD_MARGIN - 0.01), false);
});

test('the numeric tolerance is far below the threshold margin', () => {
  assert.ok(NUMERIC_TOLERANCE < THRESHOLD_MARGIN);
});
