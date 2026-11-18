import test from 'node:test';
import assert from 'node:assert/strict';

import { compareReports, NUMERIC_TOLERANCE } from './report.ts';
import type { EvaluationReport, ReportSuite } from './report.ts';

function makeReport(
  overrides: {
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
  } = {},
): EvaluationReport {
  const confidence = overrides.confidence ?? 0.9;
  const predicted = overrides.predicted ?? 'routine';
  const abstained = overrides.abstained ?? false;

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
          accuracy: 1,
          selectiveAccuracy: 1,
          macroF1: 1,
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
          coverage: abstained ? 0 : 1,
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

test('two identical reports produce no differences', () => {
  const differences = compareReports(makeReport(), makeReport());
  assert.deepEqual(differences, []);
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

test('a changed predicted label is reported', () => {
  const differences = compareReports(
    makeReport({ predicted: 'routine' }),
    makeReport({ predicted: 'priority' }),
  );
  assert.equal(differences.length, 1);
  assert.match(differences[0]!.path, /predicted$/);
  assert.equal(differences[0]!.expected, 'routine');
  assert.equal(differences[0]!.actual, 'priority');
});

test('a changed abstention decision is reported', () => {
  const differences = compareReports(
    makeReport({ abstained: false }),
    makeReport({ abstained: true }),
  );
  assert.ok(differences.some((difference) => difference.path.endsWith('/abstained')));
});

test('a changed fallback flag is reported', () => {
  const differences = compareReports(
    makeReport({ usedFallback: false }),
    makeReport({ usedFallback: true }),
  );
  assert.ok(differences.some((difference) => difference.path.endsWith('/usedFallback')));
});

test('a changed failure flag is reported', () => {
  const differences = compareReports(makeReport({ failed: false }), makeReport({ failed: true }));
  assert.ok(differences.some((difference) => difference.path.endsWith('/failed')));
});

test('a confidence change beyond the tolerance is reported', () => {
  const differences = compareReports(
    makeReport({ confidence: 0.9 }),
    makeReport({ confidence: 0.9 - NUMERIC_TOLERANCE * 10 }),
  );
  assert.ok(differences.some((difference) => difference.path.endsWith('/confidence')));
});

test('a confidence change within the tolerance is ignored', () => {
  const differences = compareReports(
    makeReport({ confidence: 0.9 }),
    makeReport({ confidence: 0.9 - NUMERIC_TOLERANCE / 2 }),
  );
  assert.deepEqual(differences, []);
});

test('a changed label score beyond the tolerance is reported', () => {
  const differences = compareReports(makeReport({ score: 1 }), makeReport({ score: 0.5 }));
  assert.ok(differences.some((difference) => difference.path.endsWith('/scores/routine')));
});

test('a changed failure analysis is reported', () => {
  const differences = compareReports(
    makeReport({ omitFailures: false }),
    makeReport({ omitFailures: true }),
  );
  assert.ok(differences.some((difference) => difference.path.endsWith('/failures')));
});

test('a missing suite is reported', () => {
  const committed = makeReport();
  const fresh = makeReport();
  fresh.suites = [];
  const differences = compareReports(committed, fresh);
  assert.ok(differences.length > 0);
  assert.match(differences[0]!.path, /suites\/length/);
});

test('a renamed engine is reported', () => {
  const committed = makeReport();
  const fresh = makeReport();
  fresh.suites[0]!.runs[0]!.engine = 'embedding-model';
  const differences = compareReports(committed, fresh);
  assert.ok(differences.some((difference) => difference.path.endsWith('/engine')));
});

test('a changed suite identifier is reported', () => {
  const committed = makeReport();
  const fresh = makeReport();
  fresh.suites[0]!.suite = 'validation';
  const differences = compareReports(committed, fresh);
  assert.ok(differences.some((difference) => difference.path.endsWith('/suite')));
});
