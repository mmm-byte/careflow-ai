/// <reference lib="webworker" />

/**
 * Model worker.
 *
 * All embedding inference runs here so a slow model download or a large
 * inference pass never blocks the main thread or freezes the interface.
 *
 * Protocol (request/response over `postMessage`):
 *   -> { type: 'load' }                              <- { type: 'progress' | 'ready' | 'error' }
 *   -> { type: 'classify', id, text, prototypes }    <- { type: 'result', id, ... } | { type: 'error', id }
 *   -> { type: 'dispose' }
 */

import type { LabelScore, WorkflowLabel } from './types.ts';
import {
  buildEmbeddingBatch,
  calibrate,
  groupPrototypeVectors,
  scoreAgainstPrototypes,
} from './scoring.ts';

export interface LoadProgressMessage {
  type: 'progress';
  status: string;
  progress: number;
  file?: string;
}

export interface ReadyMessage {
  type: 'ready';
  modelId: string;
  dtype: string;
  parameters: string;
  modelSize: string;
  dimensions: number | null;
  loadMs: number;
  coldStartMs: number | null;
  engineDetail: string;
}

export interface ClassifyRequest {
  type: 'classify';
  id: string;
  /**
   * Text to embed. The caller has already applied the shared preprocessing
   * pipeline (`buildEngineInputs`), so the worker embeds exactly what it is
   * given. Keeping preprocessing in one place is what guarantees the browser
   * and the Node evaluation runner produce identical scores.
   */
  text: string;
  /** One or more prototypes per label; the best match wins for that label. */
  prototypes: Record<string, string[]>;
  labelOrder: string[];
}

export interface ClassifyResultMessage {
  type: 'result';
  id: string;
  scores: LabelScore[];
  /** Calibrated confidence for the winning label. */
  confidence: number;
  latencyMs: number;
  warm: boolean;
  coldStartMs: number | null;
  dimensions: number | null;
}

export interface ErrorMessage {
  type: 'error';
  id?: string;
  message: string;
}

export type WorkerOutbound =
  LoadProgressMessage | ReadyMessage | ClassifyResultMessage | ErrorMessage;

type Extractor = (
  inputs: string[],
  options: { pooling: 'mean'; normalize: boolean },
) => Promise<{ tolist: () => number[][]; dims?: number[] }>;

let extractorPromise: Promise<Extractor> | null = null;
let coldStartMs: number | null = null;
let modelId = '';
let dtype: 'q8' | 'auto' | 'fp32' | 'fp16' | 'int8' | 'uint8' = 'q8';
let dimensions: number | null = null;

async function loadExtractor(report: (message: LoadProgressMessage) => void): Promise<Extractor> {
  const { pipeline, env } = await import('@huggingface/transformers');

  env.allowLocalModels = false;
  env.useBrowserCache = true;

  const started = Date.now();
  modelId = 'Xenova/bge-small-en-v1.5';
  dtype = 'q8';

  const extractor = (await pipeline('feature-extraction', modelId, {
    dtype,
    progress_callback: (progress: { status?: string; progress?: number; file?: string }) => {
      const status = progress.status ?? 'progress';
      report({
        type: 'progress',
        status,
        progress: typeof progress.progress === 'number' ? progress.progress : 0,
        file: progress.file,
      });
    },
  })) as unknown as Extractor;

  coldStartMs = Date.now() - started;

  // Probe dimensionality once so the UI can report it.
  const probe = await extractor(['dimension probe'], { pooling: 'mean', normalize: true });
  dimensions = probe.dims?.[probe.dims.length - 1] ?? probe.tolist()[0]?.length ?? null;

  return extractor;
}

async function ensureExtractor(report: (message: LoadProgressMessage) => void): Promise<Extractor> {
  extractorPromise ??= loadExtractor(report);
  try {
    return await extractorPromise;
  } catch (error) {
    // Allow a retry after a failed load.
    extractorPromise = null;
    throw error;
  }
}

self.addEventListener('message', (event: MessageEvent) => {
  const data = event.data as { type: 'load' } | ClassifyRequest | { type: 'dispose' };

  if (data.type === 'load') {
    const report = (message: LoadProgressMessage) => self.postMessage(message);
    ensureExtractor(report)
      .then(() => {
        self.postMessage({
          type: 'ready',
          modelId,
          dtype,
          parameters: '33.4M',
          modelSize: '~32 MB (int8)',
          dimensions,
          loadMs: coldStartMs ?? 0,
          coldStartMs,
          engineDetail: 'transformers.js (onnxruntime-web, wasm)',
        } satisfies ReadyMessage);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        self.postMessage({ type: 'error', message } satisfies ErrorMessage);
      });
    return;
  }

  if (data.type === 'classify') {
    const report = (message: LoadProgressMessage) => self.postMessage(message);
    ensureExtractor(report)
      .then(async (extractor) => {
        const started = Date.now();
        const labelOrder = data.labelOrder as WorkflowLabel[];
        const prototypes = data.prototypes as Record<WorkflowLabel, string[]>;
        // The scoring pipeline is shared with the Node evaluation runner so
        // the browser and the command line produce identical numbers.
        const { batch, segments, prototypeCounts } = buildEmbeddingBatch(
          data.text,
          prototypes,
          labelOrder,
        );
        const output = await extractor(batch, { pooling: 'mean', normalize: true });
        const vectors = output.tolist();

        const segmentVectors = vectors.slice(0, segments.length);
        const prototypeVectors = groupPrototypeVectors(vectors, segments.length, prototypeCounts);

        const rawScores = scoreAgainstPrototypes({
          prototypes,
          labelOrder,
          segmentVectors,
          prototypeVectors,
        });

        const { distribution, confidence } = calibrate(rawScores);

        self.postMessage({
          type: 'result',
          id: data.id,
          scores: distribution,
          confidence,
          latencyMs: Date.now() - started,
          warm: true,
          coldStartMs,
          dimensions,
        } satisfies ClassifyResultMessage);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        self.postMessage({ type: 'error', id: data.id, message } satisfies ErrorMessage);
      });
    return;
  }

  if (data.type === 'dispose') {
    extractorPromise = null;
    coldStartMs = null;
  }
});
