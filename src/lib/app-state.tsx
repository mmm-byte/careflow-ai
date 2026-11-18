'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import type { ClassificationDecision, ModelMetadata, WorkflowLabel } from '@/lib/ai/types.ts';
import { LABEL_DEFINITIONS, LABEL_ORDER } from '@/lib/ai/types.ts';
import { ModelClient, type ModelStatus } from '@/lib/ai/model-client.ts';
import { buildEngineInputs, normalizeInput } from '@/lib/ai/classifier.ts';
import { classifyWithRules, rulesConfidence } from '@/lib/ai/rules.ts';
import { parseBundleJson, type ParseResult } from '@/lib/fhir/parser.ts';
import type { Resident } from '@/lib/fhir/types.ts';
import {
  WorkflowOrchestrator,
  type ReviewDecision,
  type WorkflowSnapshot,
} from '@/lib/workflow/orchestrator.ts';
import {
  clearEvents,
  readEvents,
  recordSnapshot,
  type WorkflowEvent,
} from '@/lib/observability/recorder.ts';
import {
  clearAuditEntries,
  readAuditEntries,
  recordAuditEntry,
  type AuditEntry,
} from '@/lib/audit/trail.ts';

/**
 * Application state.
 *
 * One provider holds the dataset, the model lifecycle and the current
 * workflow. Every view reads from this single source, so the dashboard
 * counts, the agent execution view and the audit trail can never disagree
 * about what happened.
 */

export type DatasetStatus = 'loading' | 'ready' | 'error';

export interface ModelState {
  status: ModelStatus;
  detail: string | null;
  progress: number;
  progressFile: string | null;
  info: {
    modelId: string;
    dtype: string;
    parameters: string;
    modelSize: string;
    dimensions: number | null;
    loadMs: number;
    coldStartMs: number | null;
    engineDetail: string;
  } | null;
}

export interface AppState {
  datasetStatus: DatasetStatus;
  datasetError: string | null;
  parseResult: ParseResult | null;
  residents: Resident[];
  selectedResidentId: string | null;
  model: ModelState;
  workflow: WorkflowSnapshot | null;
  workflowRunning: boolean;
  events: WorkflowEvent[];
  auditEntries: AuditEntry[];
  selectedResident: Resident | null;
  selectResident: (id: string) => void;
  loadModel: () => Promise<void>;
  runWorkflow: () => Promise<void>;
  submitReview: (decision: ReviewDecision) => void;
  resetObservability: () => void;
  resetAudit: () => void;
  disposeModel: () => void;
}

const AppContext = createContext<AppState | null>(null);

const INITIAL_MODEL: ModelState = {
  status: 'idle',
  detail: null,
  progress: 0,
  progressFile: null,
  info: null,
};

export function AppProvider({ children }: { children: ReactNode }) {
  const [datasetStatus, setDatasetStatus] = useState<DatasetStatus>('loading');
  const [datasetError, setDatasetError] = useState<string | null>(null);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [selectedResidentId, setSelectedResidentId] = useState<string | null>(null);
  const [model, setModel] = useState<ModelState>(INITIAL_MODEL);
  const [workflow, setWorkflow] = useState<WorkflowSnapshot | null>(null);
  const [workflowRunning, setWorkflowRunning] = useState(false);
  const [events, setEvents] = useState<WorkflowEvent[]>([]);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);

  const clientRef = useRef<ModelClient | null>(null);
  const orchestratorRef = useRef<WorkflowOrchestrator | null>(null);

  /* ---------------- dataset ---------------- */

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        const response = await fetch('/data/fhir-bundle.json');
        if (!response.ok) {
          throw new Error(`The dataset request failed with status ${response.status}.`);
        }
        const json: unknown = await response.json();
        const { result, error } = parseBundleJson(JSON.stringify(json));
        if (cancelled) return;

        if (!result || error) {
          setDatasetStatus('error');
          setDatasetError(error ?? 'The dataset could not be parsed.');
          return;
        }

        setParseResult(result);
        setDatasetStatus('ready');
        setSelectedResidentId(result.residents[0]?.id ?? null);
      } catch (error) {
        if (cancelled) return;
        setDatasetStatus('error');
        setDatasetError(error instanceof Error ? error.message : String(error));
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ---------------- local telemetry ---------------- */

  useEffect(() => {
    setEvents(readEvents());
    setAuditEntries(readAuditEntries());
  }, []);

  /* ---------------- model lifecycle ---------------- */

  const ensureClient = useCallback((): ModelClient => {
    if (clientRef.current) return clientRef.current;

    const client = new ModelClient({
      onStatus: (status, detail) => {
        setModel((current) => ({ ...current, status, detail: detail ?? current.detail }));
      },
      onProgress: (progress) => {
        setModel((current) => ({
          ...current,
          status: 'loading',
          progress: progress.progress,
          progressFile: progress.file ?? null,
        }));
      },
      onReady: (info) => {
        setModel((current) => ({
          ...current,
          status: 'ready',
          detail: null,
          progress: 1,
          info,
        }));
      },
      onError: (message) => {
        setModel((current) => ({ ...current, status: 'error', detail: message }));
      },
    });

    clientRef.current = client;
    return client;
  }, []);

  const loadModel = useCallback(async () => {
    const client = ensureClient();
    try {
      await client.load();
    } catch (error) {
      setModel((current) => ({
        ...current,
        status: 'error',
        detail: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [ensureClient]);

  const disposeModel = useCallback(() => {
    clientRef.current?.dispose();
    clientRef.current = null;
    setModel(INITIAL_MODEL);
  }, []);

  /* ---------------- workflow ---------------- */

  const selectedResident = useMemo(
    () => parseResult?.residents.find((resident) => resident.id === selectedResidentId) ?? null,
    [parseResult, selectedResidentId],
  );

  const runWorkflow = useCallback(async () => {
    if (!selectedResident || !parseResult || workflowRunning) return;

    setWorkflowRunning(true);
    setWorkflow(null);

    const client = clientRef.current;
    // The model is only used when a client exists and has finished loading.
    const modelRunner =
      client && client.isReady
        ? {
            async classify(text: string) {
              const outcome = await client.classify(
                text,
                Object.fromEntries(
                  LABEL_ORDER.map((label) => [label, LABEL_DEFINITIONS[label].prototypes]),
                ) as Record<WorkflowLabel, string[]>,
                LABEL_ORDER,
              );
              const metadata: ModelMetadata = {
                modelId: client.info?.modelId ?? 'unknown',
                engine: 'embedding-model',
                engineDetail: client.info?.engineDetail ?? 'transformers.js',
                dtype: client.info?.dtype ?? 'q8',
                parameters: client.info?.parameters ?? 'unknown',
                modelSize: client.info?.modelSize ?? 'unknown',
                dimensions: outcome.dimensions ?? client.info?.dimensions ?? null,
                latencyMs: outcome.latencyMs,
                coldStartMs: outcome.coldStartMs,
                warm: outcome.warm,
              };
              return { scores: outcome.scores, metadata };
            },
          }
        : undefined;

    const orchestrator = new WorkflowOrchestrator({
      resident: selectedResident,
      warnings: parseResult.warnings.filter(
        (warning) =>
          warning.resourceId === selectedResident.id ||
          selectedResident.sourceResourceIds.includes(warning.resourceId ?? ''),
      ),
      model: modelRunner,
    });

    try {
      const snapshot = await orchestrator.run();
      orchestratorRef.current = orchestrator;
      setWorkflow(snapshot);
      setEvents(recordSnapshot(snapshot));
    } finally {
      setWorkflowRunning(false);
    }
  }, [selectedResident, parseResult, workflowRunning]);

  const submitReview = useCallback((decision: ReviewDecision) => {
    const orchestrator = orchestratorRef.current;
    if (!orchestrator) return;

    // The orchestrator owns the review transition, so the UI cannot drift
    // from the state machine that the tests exercise.
    const reviewed = orchestrator.review(decision);
    setWorkflow(reviewed);

    const entry = recordAuditEntry(reviewed, decision);
    setAuditEntries((currentEntries) => [entry, ...currentEntries]);
    setEvents(recordSnapshot(reviewed));
  }, []);

  const resetObservability = useCallback(() => {
    clearEvents();
    setEvents([]);
  }, []);

  const resetAudit = useCallback(() => {
    clearAuditEntries();
    setAuditEntries([]);
  }, []);

  const value = useMemo<AppState>(
    () => ({
      datasetStatus,
      datasetError,
      parseResult,
      residents: parseResult?.residents ?? [],
      selectedResidentId,
      model,
      workflow,
      workflowRunning,
      events,
      auditEntries,
      selectedResident,
      selectResident: setSelectedResidentId,
      loadModel,
      runWorkflow,
      submitReview,
      resetObservability,
      resetAudit,
      disposeModel,
    }),
    [
      datasetStatus,
      datasetError,
      parseResult,
      model,
      workflow,
      workflowRunning,
      events,
      auditEntries,
      selectedResident,
      selectedResidentId,
      loadModel,
      runWorkflow,
      submitReview,
      resetObservability,
      resetAudit,
      disposeModel,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside an AppProvider.');
  return context;
}

/* ------------------------------------------------------------------ */
/* Derived helpers used across views                                  */
/* ------------------------------------------------------------------ */

/**
 * Classify a resident locally with the deterministic rules engine.
 *
 * The dashboard uses this to show a computed queue breakdown without
 * requiring the model to be downloaded. The value is explicitly labelled as
 * coming from the rules engine.
 */
export function classifyResidentWithRules(resident: Resident): {
  label: WorkflowLabel;
  confidence: number;
  decision: ClassificationDecision | null;
} {
  const normalized = normalizeInput({
    notes: resident.documents.map((document) => ({
      id: document.id,
      text: document.description,
    })),
    observations: resident.observations.map((observation) => ({
      id: observation.id,
      text: `${observation.label} ${observation.displayValue} ${observation.unit}`,
    })),
    tasks: resident.tasks.map((task) => ({ id: task.id, text: task.description })),
    encounters: resident.encounters
      .filter((encounter) => Boolean(encounter.reason))
      .map((encounter) => ({ id: encounter.id, text: encounter.reason ?? '' })),
  });

  const engineInputs = buildEngineInputs(normalized);
  const rulesResult = classifyWithRules(engineInputs.rulesText);
  const confidence = rulesConfidence(engineInputs.rulesText, rulesResult.label);

  return { label: rulesResult.label, confidence, decision: null };
}
