/**
 * Reproducible evaluation runner.
 *
 *   npm run evaluate                    # every engine, tuning and held-out suites
 *   npm run evaluate -- --engine=model  # embedding model only
 *   npm run evaluate -- --engine=rules  # deterministic rules only
 *   npm run evaluate -- --suite=validation
 *   npm run evaluate -- --json          # machine-readable output
 *
 * Writes a report to `reports/evaluation.json` and prints a summary table.
 *
 * Two suites are run:
 *
 *  - **tuning** (`src/lib/eval/scenarios.ts`) - the scenarios used to choose
 *    the decision threshold, the similarity temperature and the prototypes.
 *    These numbers are optimistic by construction and are reported as such.
 *  - **held-out** (`src/lib/eval/validation.ts`) - written after the
 *    architecture was fixed and never used for tuning. These are the numbers
 *    that say whether the system actually generalizes.
 *
 * With `--out=<path>` the report is written somewhere other than the
 * committed `reports/evaluation.json`. CI uses this to produce a fresh report
 * for comparison without touching the committed artefact.
 *
 * The regression gate that compares a fresh run against the committed report
 * lives in `scripts/compare-evaluation.ts`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createEnsembleEngine, createRulesEngine, runEvaluation } from '../src/lib/eval/runner.ts';
import { EVALUATION_SUITES } from '../src/lib/eval/suites.ts';
import { createNodeModelEngine } from './node-model-engine.ts';

const here = dirname(fileURLToPath(import.meta.url));
const reportPath = resolve(here, '..', 'reports', 'evaluation.json');

const args = process.argv.slice(2);
const engineArg = args.find((arg) => arg.startsWith('--engine='))?.split('=')[1] ?? 'all';
const suiteArg = args.find((arg) => arg.startsWith('--suite='))?.split('=')[1] ?? 'all';
const asJson = args.includes('--json');
const outArg = args.find((arg) => arg.startsWith('--out='))?.split('=')[1];

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function pad(value: string, width: number): string {
  return value.padEnd(width);
}

function padStart(value: string, width: number): string {
  return value.padStart(width);
}

const selectedSuites =
  suiteArg === 'all'
    ? EVALUATION_SUITES
    : EVALUATION_SUITES.filter((suite) => suite.id === suiteArg || suite.id === 'tuning');

if (selectedSuites.length === 0) {
  process.stderr.write('Unknown suite. Use --suite=tuning|validation|all.\n');
  process.exit(1);
}

const suiteRuns: {
  suite: (typeof EVALUATION_SUITES)[number];
  runs: Awaited<ReturnType<typeof runEvaluation>>[];
}[] = [];

/**
 * Lazily create the model engine so the rules-only run never downloads it.
 */
let modelEnginePromise: Promise<Awaited<ReturnType<typeof createNodeModelEngine>> | null> | null =
  null;

async function getModelEngine() {
  modelEnginePromise ??= (async () => {
    process.stderr.write('Loading the embedding model (first run downloads the weights)...\n');
    try {
      const created = await createNodeModelEngine();
      process.stderr.write(`Model ready in ${created.warmupMs} ms (${created.modelId}).\n`);
      return created;
    } catch (error) {
      process.stderr.write(
        `Model engine unavailable: ${error instanceof Error ? error.message : String(error)}\n` +
          'The model engine requires network access to the Hugging Face hub on first run.\n',
      );
      return null;
    }
  })();
  return modelEnginePromise;
}

for (const suite of selectedSuites) {
  const runs: Awaited<ReturnType<typeof runEvaluation>>[] = [];

  if (engineArg === 'all' || engineArg === 'rules') {
    runs.push(await runEvaluation(createRulesEngine(), suite.scenarios));
  }

  if (engineArg === 'all' || engineArg === 'model' || engineArg === 'ensemble') {
    const model = await getModelEngine();
    if (model) {
      runs.push(await runEvaluation(model.engine, suite.scenarios));
      if (engineArg === 'all' || engineArg === 'ensemble') {
        runs.push(await runEvaluation(createEnsembleEngine(model.engine), suite.scenarios));
      }
    }
  }

  if (runs.length === 0) {
    process.stderr.write('No engine was run. Use --engine=model|rules|all.\n');
    process.exit(1);
  }

  suiteRuns.push({ suite, runs });
}

const report = {
  generatedAt: new Date().toISOString(),
  suites: suiteRuns.map(({ suite, runs }) => ({
    suite: suite.id,
    title: suite.title,
    scenarioCount: suite.scenarios.length,
    runs: runs.map((run) => ({
      engine: run.engine,
      durationMs: run.durationMs,
      metrics: run.metrics,
      failures: run.failures,
      records: run.records,
    })),
  })),
};

const outputPath = outArg ? resolve(here, '..', outArg) : reportPath;
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log('');
  console.log('CareFlow AI - reproducible evaluation');
  console.log(`Report written to ${outputPath}`);

  for (const { suite, runs } of suiteRuns) {
    console.log('');
    console.log(`##### ${suite.title} - ${suite.scenarios.length} scenarios #####`);

    for (const run of runs) {
      const { metrics } = run;
      const wrong = run.records.filter(
        (record) => !record.failed && !record.abstained && record.expected !== record.predicted,
      ).length;

      console.log('');
      console.log(`=== ${run.engine} ===`);
      console.log(`  total scenarios     ${metrics.total}`);
      console.log(`  committed           ${Math.round(metrics.coverage * metrics.total)}`);
      console.log(
        `  correct             ${Math.round(metrics.selectiveAccuracy * Math.round(metrics.coverage * metrics.total))}`,
      );
      console.log(`  WRONG               ${wrong}`);
      console.log(`  selective accuracy  ${percent(metrics.selectiveAccuracy)}`);
      console.log(`  macro F1            ${metrics.macroF1.toFixed(4)}`);
      console.log(`  coverage            ${percent(metrics.coverage)}`);
      console.log(`  abstention rate     ${percent(metrics.abstentionRate)}`);
      console.log(`  fallback rate       ${percent(metrics.fallbackRate)}`);
      console.log(`  failed runs         ${metrics.failed}`);
      console.log(
        `  latency ms          median ${metrics.latency.median}, p95 ${metrics.latency.p95}, max ${metrics.latency.max}`,
      );

      console.log('');
      console.log(
        `  ${pad('class', 12)}${padStart('support', 9)}${padStart('prec', 8)}${padStart('recall', 8)}${padStart('F1', 8)}`,
      );
      for (const metricsForClass of metrics.perClass) {
        console.log(
          `  ${pad(metricsForClass.label, 12)}${padStart(String(metricsForClass.support), 9)}` +
            `${padStart(metricsForClass.precision.toFixed(3), 8)}${padStart(metricsForClass.recall.toFixed(3), 8)}` +
            `${padStart(metricsForClass.f1.toFixed(3), 8)}`,
        );
      }

      console.log('');
      console.log('  Confusion matrix (rows = expected, columns = predicted)');
      const labels = metrics.perClass.map((entry) => entry.label);
      console.log(`  ${pad('', 12)}${labels.map((label) => padStart(label, 12)).join('')}`);
      for (const expected of labels) {
        const row = metrics.confusionMatrix
          .filter((cell) => cell.expected === expected)
          .map((cell) => padStart(String(cell.count), 12))
          .join('');
        console.log(`  ${pad(expected, 12)}${row}`);
      }

      if (run.failures.length > 0) {
        console.log('');
        console.log(`  Failure analysis (${run.failures.length})`);
        for (const failure of run.failures) {
          console.log(
            `    ${failure.scenarioId}: expected ${failure.expected}, got ${failure.predicted} ` +
              `(conf ${failure.confidence.toFixed(3)}) - ${failure.failureMode}`,
          );
          console.log(`      ${failure.response}`);
        }
      } else {
        console.log('');
        console.log('  Failure analysis: no failures recorded.');
      }
    }
  }
}
