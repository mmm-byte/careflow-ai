'use client';

import type {
  ClassifyResultMessage,
  ErrorMessage,
  LoadProgressMessage,
  ReadyMessage,
  WorkerOutbound,
} from './model.worker.ts';
import type { LabelScore, WorkflowLabel } from './types.ts';

export type ModelStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ModelProgress {
  status: string;
  progress: number;
  file?: string;
}

export interface ModelReadyInfo {
  modelId: string;
  dtype: string;
  parameters: string;
  modelSize: string;
  dimensions: number | null;
  loadMs: number;
  coldStartMs: number | null;
  engineDetail: string;
}

export interface ModelClientEvents {
  onStatus?: (status: ModelStatus, detail?: string) => void;
  onProgress?: (progress: ModelProgress) => void;
  onReady?: (info: ModelReadyInfo) => void;
  onError?: (message: string) => void;
}

export interface ClassifyOutcome {
  scores: LabelScore[];
  /** Calibrated confidence reported by the engine. */
  confidence: number;
  latencyMs: number;
  warm: boolean;
  coldStartMs: number | null;
  dimensions: number | null;
}

/**
 * Thin, typed wrapper around the model worker.
 *
 * Responsibilities:
 *  - own the worker lifecycle (load once, reuse, dispose on demand)
 *  - translate worker messages into typed callbacks
 *  - expose cancellation so a superseded request cannot resolve late
 */
export class ModelClient {
  private worker: Worker | null = null;

  private ready = false;

  private loading: Promise<ModelReadyInfo> | null = null;

  private readyInfo: ModelReadyInfo | null = null;

  private pending = new Map<
    string,
    { resolve: (value: ClassifyOutcome) => void; reject: (reason: Error) => void }
  >();

  private sequence = 0;

  constructor(private readonly events: ModelClientEvents = {}) {}

  get isReady(): boolean {
    return this.ready;
  }

  get info(): ModelReadyInfo | null {
    return this.readyInfo;
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./model.worker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (event: MessageEvent<WorkerOutbound>) => {
      this.handleMessage(event.data);
    });
    worker.addEventListener('error', (event: ErrorEvent) => {
      const message = event.message || 'The model worker stopped unexpectedly.';
      this.ready = false;
      this.loading = null;
      this.rejectAllPending(message);
      this.events.onStatus?.('error', message);
      this.events.onError?.(message);
    });
    this.worker = worker;
    return worker;
  }

  private handleMessage(message: WorkerOutbound): void {
    if (message.type === 'progress') {
      this.events.onProgress?.({
        status: message.status,
        progress: message.progress,
        file: message.file,
      });
      return;
    }
    if (message.type === 'ready') {
      const info: ModelReadyInfo = {
        modelId: message.modelId,
        dtype: message.dtype,
        parameters: message.parameters,
        modelSize: message.modelSize,
        dimensions: message.dimensions,
        loadMs: message.loadMs,
        coldStartMs: message.coldStartMs,
        engineDetail: message.engineDetail,
      };
      this.ready = true;
      this.readyInfo = info;
      this.events.onStatus?.('ready');
      this.events.onReady?.(info);
      return;
    }
    if (message.type === 'result') {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      pending.resolve({
        scores: message.scores,
        confidence: message.confidence,
        latencyMs: message.latencyMs,
        warm: message.warm,
        coldStartMs: message.coldStartMs,
        dimensions: message.dimensions,
      });
      return;
    }
    if (message.type === 'error') {
      const errorMessage = message.message;
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (pending) {
          this.pending.delete(message.id);
          pending.reject(new Error(errorMessage));
          return;
        }
      }
      this.ready = false;
      this.loading = null;
      this.events.onStatus?.('error', errorMessage);
      this.events.onError?.(errorMessage);
    }
  }

  private rejectAllPending(message: string): void {
    for (const pending of this.pending.values()) {
      pending.reject(new Error(message));
    }
    this.pending.clear();
  }

  /** Download and initialise the model. Safe to call repeatedly. */
  async load(): Promise<ModelReadyInfo> {
    if (this.ready && this.readyInfo) return this.readyInfo;
    if (this.loading) return this.loading;

    this.events.onStatus?.('loading');
    this.loading = new Promise<ModelReadyInfo>((resolve, reject) => {
      const worker = this.ensureWorker();
      const onMessage = (event: MessageEvent<WorkerOutbound>): void => {
        const message = event.data;
        if (message.type === 'ready') {
          worker.removeEventListener('message', onMessage);
          resolve({
            modelId: message.modelId,
            dtype: message.dtype,
            parameters: message.parameters,
            modelSize: message.modelSize,
            dimensions: message.dimensions,
            loadMs: message.loadMs,
            coldStartMs: message.coldStartMs,
            engineDetail: message.engineDetail,
          });
        } else if (message.type === 'error') {
          worker.removeEventListener('message', onMessage);
          reject(new Error(message.message));
        }
      };
      worker.addEventListener('message', onMessage);
      worker.postMessage({ type: 'load' });
    });

    try {
      const info = await this.loading;
      this.loading = null;
      return info;
    } catch (error) {
      this.loading = null;
      throw error;
    }
  }

  /** Classify text against the supplied prototypes. */
  async classify(
    text: string,
    prototypes: Record<WorkflowLabel, string[]>,
    labelOrder: WorkflowLabel[],
  ): Promise<ClassifyOutcome> {
    await this.load();
    const worker = this.ensureWorker();
    const id = `c${(this.sequence += 1)}`;
    return new Promise<ClassifyOutcome>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ type: 'classify', id, text, prototypes, labelOrder });
    });
  }

  /** Cancel any in-flight classification requests. */
  cancelPending(): void {
    this.rejectAllPending('The request was superseded.');
  }

  /** Terminate the worker and release the model. */
  dispose(): void {
    this.cancelPending();
    this.worker?.postMessage({ type: 'dispose' });
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
    this.loading = null;
    this.readyInfo = null;
  }
}

export type { ClassifyResultMessage, ErrorMessage, LoadProgressMessage, ReadyMessage };
