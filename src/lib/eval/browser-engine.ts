'use client';

import type { WorkflowLabel } from '../ai/types.ts';
import { LABEL_DEFINITIONS, LABEL_ORDER } from '../ai/types.ts';
import { ModelClient } from '../ai/model-client.ts';
import type { Engine } from './runner.ts';
import { createEnsembleEngine, createRulesEngine } from './runner.ts';
import type { EvaluationScenario } from './scenarios.ts';

/**
 * Browser-side evaluation engines.
 *
 * The Evaluation Lab runs the same code path as the command-line runner, so
 * the numbers a reviewer sees in the browser are produced by the same
 * functions that produce `reports/evaluation.json`.
 *
 * The rules engine runs instantly. The embedding model has to be downloaded
 * first, so the lab reports clearly whether the model-backed comparison was
 * actually run or whether the model was unavailable.
 */

export interface BrowserEngineSet {
  /** The deterministic rules engine. Always available. */
  rules: Engine;
  /** The embedding model engine, or null when the model is not loaded. */
  model: Engine | null;
  /** The agreement-gated ensemble, or null when the model is not loaded. */
  ensemble: Engine | null;
  /** True when the model-backed engines are available. */
  modelAvailable: boolean;
  /** The reason the model is unavailable, when it is. */
  modelUnavailableReason: string | null;
}

/** Build the rules-only engine set. */
export function createRulesOnlyEngines(): BrowserEngineSet {
  const rules = createRulesEngine();
  return {
    rules,
    model: null,
    ensemble: null,
    modelAvailable: false,
    modelUnavailableReason:
      'The embedding model has not been loaded in this browser. Load it from the dashboard to compare all three engines.',
  };
}

/**
 * Build the full engine set, using an already-loaded model client.
 *
 * The client is shared with the main workflow so the model is downloaded once
 * per session rather than once per evaluation run.
 */
export function createBrowserEngines(client: ModelClient): BrowserEngineSet {
  const rules = createRulesEngine();

  const model: Engine = {
    name: `embedding-model (${client.info?.modelId ?? 'browser'}, ${client.info?.dtype ?? 'q8'})`,
    async classify(scenario: EvaluationScenario) {
      const started = Date.now();
      try {
        const normalized = await buildScenarioText(scenario);
        const outcome = await client.classify(
          normalized,
          Object.fromEntries(
            LABEL_ORDER.map((label) => [label, LABEL_DEFINITIONS[label].prototypes]),
          ) as Record<WorkflowLabel, string[]>,
          LABEL_ORDER,
        );
        return {
          scores: outcome.scores,
          confidence: outcome.confidence,
          latencyMs: outcome.latencyMs,
          usedFallback: false,
          failed: false,
        };
      } catch (error) {
        return {
          scores: [],
          latencyMs: Date.now() - started,
          usedFallback: false,
          failed: true,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };

  return {
    rules,
    model,
    ensemble: createEnsembleEngine(model),
    modelAvailable: true,
    modelUnavailableReason: null,
  };
}

/**
 * Build the model input for a scenario.
 *
 * This mirrors `scenarioToInput` plus `buildEngineInputs` from the runner,
 * so the browser embeds exactly the text the command line embeds.
 */
async function buildScenarioText(scenario: EvaluationScenario): Promise<string> {
  const { normalizeInput, buildEngineInputs } = await import('../ai/classifier.ts');
  const { scenarioToInput } = await import('./runner.ts');
  const normalized = normalizeInput(scenarioToInput(scenario));
  return buildEngineInputs(normalized).modelText;
}
