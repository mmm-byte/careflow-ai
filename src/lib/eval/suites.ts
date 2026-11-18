/**
 * The evaluation suites, defined once and shared by every consumer.
 *
 * The CLI runner, the in-browser Evaluation Lab and the CI regression gate all
 * need the same list of suites with the same scenarios in the same order.
 * Defining them in one place means a scenario added here is picked up by all
 * three, and the CI gate can compare a freshly generated report against the
 * committed one without the two sides drifting apart.
 */
import type { EvaluationScenario } from './scenarios.ts';
import { EVALUATION_SCENARIOS } from './scenarios.ts';
import { VALIDATION_SCENARIOS } from './validation.ts';

export type SuiteId = 'tuning' | 'validation';

export interface SuiteSpec {
  id: SuiteId;
  title: string;
  scenarios: EvaluationScenario[];
}

export const EVALUATION_SUITES: SuiteSpec[] = [
  {
    id: 'tuning',
    title: 'Tuning suite (used to choose the threshold and prototypes)',
    scenarios: EVALUATION_SCENARIOS,
  },
  {
    id: 'validation',
    title: 'Held-out validation suite (never used for tuning)',
    scenarios: VALIDATION_SCENARIOS,
  },
];

export function findSuite(id: string): SuiteSpec | undefined {
  return EVALUATION_SUITES.find((suite) => suite.id === id);
}
