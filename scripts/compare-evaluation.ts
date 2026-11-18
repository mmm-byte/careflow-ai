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
 * The comparison separates the two kinds of information:
 *
 *  - **Decision behaviour** - the predicted label, whether the system
 *    abstained, whether the rules fallback fired, whether the run failed.
 *    These are discrete and must match exactly. This is the part of the
 *    contract a reviewer actually experiences.
 *  - **Numeric outputs** - confidence and label scores, compared with a
 *    tolerance, because the same quantized model can differ in the last bits
 *    between CPU architectures.
 *  - **Timing** - ignored entirely. Wall-clock numbers are environment
 *    dependent and are not part of the behaviour contract.
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

if (differences.length > 0) {
  process.stderr.write(
    `\n::error::the evaluation behaviour changed in ${differences.length} place(s).\n` +
      'A fresh run no longer matches the committed report. If this change is ' +
      'intentional, run "npm run evaluate" and commit the updated report.\n\n',
  );
  for (const difference of differences.slice(0, 50)) {
    process.stderr.write(
      `  ${difference.path}\n    committed: ${difference.expected}\n    fresh:     ${difference.actual}\n`,
    );
  }
  if (differences.length > 50) {
    process.stderr.write(`  ... and ${differences.length - 50} more\n`);
  }
  process.exit(1);
}

process.stdout.write(
  'The evaluation behaviour matches the committed report.\n' +
    '(Timing fields are ignored: they legitimately differ on every run.)\n',
);
