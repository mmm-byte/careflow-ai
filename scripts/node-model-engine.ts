/**
 * Node-side embedding model engine for reproducible offline evaluation.
 *
 * Uses the same Transformers.js model, prototypes and calibration as the
 * browser, so the CLI evaluation and the in-browser Evaluation Lab measure the
 * same system. The only difference is the execution runtime (onnxruntime-node
 * versus onnxruntime-web).
 */
import type { WorkflowLabel } from '../src/lib/ai/types.ts';
import { LABEL_DEFINITIONS, LABEL_ORDER } from '../src/lib/ai/types.ts';
import type { Engine } from '../src/lib/eval/runner.ts';
import { scenarioToInput } from '../src/lib/eval/runner.ts';
import { normalizeInput, buildEngineInputs } from '../src/lib/ai/classifier.ts';
import {
  buildEmbeddingBatch,
  calibrate,
  groupPrototypeVectors,
  scoreAgainstPrototypes,
} from '../src/lib/ai/scoring.ts';

type Extractor = (
  inputs: string[],
  options: { pooling: 'mean'; normalize: boolean },
) => Promise<{ tolist: () => number[][] }>;

/**
 * The quantization levels accepted by Transformers.js.
 *
 * The list is narrowed locally rather than imported so the runtime type does
 * not change with the Transformers.js version.
 */
export const DATATYPES = [
  'q8',
  'auto',
  'fp32',
  'fp16',
  'int8',
  'uint8',
  'q4',
  'bnb4',
  'q4f16',
] as const;

export type ModelDatatype = (typeof DATATYPES)[number];

export interface NodeModelEngineOptions {
  modelId?: string;
  dtype?: ModelDatatype;
}

export interface NodeModelEngine {
  engine: Engine;
  /** Milliseconds from process start to a warm model. */
  warmupMs: number;
  /** Milliseconds spent downloading and initialising the model. */
  loadMs: number;
  modelId: string;
}

export async function createNodeModelEngine(
  options: NodeModelEngineOptions = {},
): Promise<NodeModelEngine> {
  const modelId = options.modelId ?? 'Xenova/bge-small-en-v1.5';
  const dtype = options.dtype ?? 'q8';

  const { pipeline, env } = await import('@huggingface/transformers');
  env.allowLocalModels = false;

  const loadStarted = Date.now();
  const extractor = (await pipeline('feature-extraction', modelId, {
    dtype,
  })) as unknown as Extractor;
  const loadMs = Date.now() - loadStarted;

  // Warm the model so the first scored scenario is not penalised by lazy init.
  await extractor(['warmup'], { pooling: 'mean', normalize: true });
  const warmupMs = Date.now() - loadStarted;

  const engine: Engine = {
    name: `embedding-model (${modelId}, ${dtype})`,
    async classify(scenario) {
      const started = Date.now();
      try {
        const input = scenarioToInput(scenario);
        const normalized = normalizeInput(input);
        // The model sees the same preprocessed text the browser worker sees.
        const engineInputs = buildEngineInputs(normalized);

        // Segment the record so an acute statement anywhere in it can be
        // detected on its own, rather than being averaged away by the
        // reassuring statements around it. The scoring pipeline is shared
        // with the browser worker, so both produce identical numbers.
        const prototypes = Object.fromEntries(
          LABEL_ORDER.map((label) => [label, LABEL_DEFINITIONS[label].prototypes]),
        ) as Record<WorkflowLabel, string[]>;

        const { batch, segments, prototypeCounts } = buildEmbeddingBatch(
          engineInputs.modelText,
          prototypes,
          LABEL_ORDER,
        );
        const outputs = await extractor(batch, {
          pooling: 'mean',
          normalize: true,
        });
        const vectors = outputs.tolist();
        const segmentVectors = vectors.slice(0, segments.length);
        const prototypeVectors = groupPrototypeVectors(vectors, segments.length, prototypeCounts);

        const rawScores = scoreAgainstPrototypes({
          prototypes,
          labelOrder: LABEL_ORDER,
          segmentVectors,
          prototypeVectors,
        });

        // Apply the same softmax calibration the browser uses, so both
        // environments produce identical scores for identical input.
        const { distribution, confidence } = calibrate(rawScores);

        return {
          scores: distribution,
          confidence,
          latencyMs: Date.now() - started,
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

  return { engine, warmupMs, loadMs, modelId };
}
