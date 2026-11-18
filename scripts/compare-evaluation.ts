/**
 * The evaluation regression gate.
 *
 *   npm run evaluate:check
 *
 * Compares a freshly generated report against the committed one and fails when
 * the *behaviour* changed. This is the gate that stops a change to the AI
 * layer from silently moving the measured behaviour.
 *
 * Why this is not a `git diff`
 * ---------------------------
 *
 * The committed report records a real run, so it contains values that change
 * on every execution: the generation timestamp, the per-scenario latency and
 * the latency distribution. A plain file diff would therefore always report a
 * difference. A gate that always fails is not a gate.
 *
 * What counts as a failure
 * ------------------------
 *
 * A failure is a difference in the **outcome** of a record - the system
 * committed to a different label, or committed instead of routing to manual
 * review - that cannot be explained by the quantized model behaving slightly
 * differently on a different CPU. See `src/lib/eval/report.ts` for the full
 * reasoning and the threshold-boundary rule.
 *
 * Differences that are only in the diagnostic detail (the raw scores, the
 * aggregate averages, the failure analysis) are reported but do not fail the
 * gate, because they are the same measurements seen from a slightly different
 * arithmetic.
 *
 * The default fresh report path matches the one the CI workflow writes.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compareReports } from '../src/lib/eval/report.ts';
import type { EvaluationReport } from '../src/lib/eval/report.ts';

const here = resolve(fileURLToPath(import.meta.url), '..');

function readReport(path: string, label: string): EvaluationReport {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as EvaluationReport;
  } catch (error) {
    process.stderr.write(
      `::error::could not read the ${label} report at ${path}: ` +
        `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }
}

const args = process.argv.slice(2);
const committedPath = resolve(
  here,
  '..',
  args.find((arg) => arg.startsWith('--committed='))?.split('=')[1] ?? 'reports/evaluation.json',
);
const freshPath = resolve(
  here,
  '..',
  args.find((arg) => arg.startsWith('--fresh='))?.split('=')[1] ?? 'reports/evaluation.fresh.json',
);

const committed = readReport(committedPath, 'committed');
const fresh = readReport(freshPath, 'fresh');

const differences = compareReports(committed, fresh);

// A difference that is not tolerated is a real behaviour change.
const failures = differences.filter((difference) => !difference.tolerated);
const tolerated = differences.filter((difference) => difference.tolerated);

if (failures.length > 0) {
  process.stderr.write(
    `\n::error::the evaluation behaviour changed in ${failures.length} place(s).\n` +
      'A fresh run no longer matches the committed report. If this change is ' +
      'intentional, run "npm run evaluate" and commit the updated report.\n\n',
  );
  for (const difference of failures.slice(0, 50)) {
    process.stderr.write(
      `  ${difference.path}\n    committed: ${difference.expected}\n    fresh:     ${difference.actual}\n`,
    );
  }
  if (failures.length > 50) {
    process.stderr.write(`  ... and ${failures.length - 50} more\n`);
  }
  process.exit(1);
}

if (tolerated.length > 0) {
  process.stdout.write(
    `The evaluation behaviour matches the committed report.\n` +
      `${tolerated.length} measurement difference(s) were observed and attributed to ` +
      'quantized-model drift between CPU architectures; they are reported below and did not ' +
      'change any decision that a reviewer would see.\n\n',
  );
  for (const difference of tolerated.slice(0, 20)) {
    process.stdout.write(`  ${difference.path}: ${difference.expected} -> ${difference.actual}\n`);
  }
  if (tolerated.length > 20) {
    process.stdout.write(`  ... and ${tolerated.length - 20} more\n`);
  }
} else {
  process.stdout.write(
    'The evaluation behaviour matches the committed report.\n' +
      '(Timing fields are ignored: they legitimately differ on every run.)\n',
  );
}
