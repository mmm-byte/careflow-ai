import type { ClassificationDecision, ModelMetadata } from '../ai/types.ts';
import { LABEL_DEFINITIONS } from '../ai/types.ts';
import {
  buildEngineInputs,
  countWords,
  decideWithEnsemble,
  decideWithRules,
  normalizeInput,
  type NormalizedInput,
} from '../ai/classifier.ts';
import type { Resident } from '../fhir/types.ts';
import type { DataQualityWarning } from '../fhir/types.ts';
import {
  STAGE_DEFINITIONS,
  WORKFLOW_STAGES,
  type WorkflowStageId,
  type WorkflowStageResult,
  type WorkflowStageStatus,
} from './stages.ts';

/**
 * Workflow orchestrator.
 *
 * The orchestrator is a plain, explicit state machine. It is deliberately not
 * reactive: each stage runs, records its own real duration, and hands a
 * typed result to the next stage. The Agent Execution View renders exactly
 * what happened, so the timeline is evidence rather than decoration.
 *
 * Every consequential step stops at `await-approval`. The orchestrator can
 * reach a *proposal*, never an action: only a human reviewer can complete or
 * reject the workflow.
 */

export type WorkflowStatus =
  'idle' | 'running' | 'awaiting-approval' | 'completed' | 'rejected' | 'abstained' | 'failed';

export interface ProposedAction {
  /** Stable identifier for the proposal. */
  id: string;
  /** The workflow label the proposal is based on. */
  label: keyof typeof LABEL_DEFINITIONS;
  /** The administrative action being proposed. */
  action: string;
  /** The human-readable summary shown to the reviewer. */
  summary: string;
  /** Why this action, in terms the reviewer can check. */
  rationale: string;
  /** Resource ids the proposal is grounded in. */
  sourceResourceIds: string[];
  /** True when the proposal is safe to execute without further checks. */
  ready: boolean;
}

export interface WorkflowSnapshot {
  id: string;
  residentId: string;
  residentName: string;
  status: WorkflowStatus;
  startedAt: string;
  finishedAt: string | null;
  /** Total wall-clock duration in milliseconds. */
  durationMs: number;
  stages: WorkflowStageResult[];
  decision: ClassificationDecision | null;
  proposedAction: ProposedAction | null;
  /** The normalized text the classifiers consumed. */
  normalizedInput: string | null;
  /** Warnings raised while loading the record. */
  warnings: DataQualityWarning[];
  /** Set when the workflow failed outright. */
  error: string | null;
  /** The reviewer decision, when one has been made. */
  review: ReviewDecision | null;
}

export interface ReviewDecision {
  outcome: 'approved' | 'edited' | 'rejected';
  /** The reviewer's own text, or the edited action. */
  note: string;
  /** The label the reviewer settled on. */
  finalLabel: keyof typeof LABEL_DEFINITIONS;
  decidedAt: string;
  /** Identifier of the reviewer. Always the synthetic demo reviewer. */
  reviewer: string;
}

/** The model engine used by the orchestrator, supplied by the host app. */
export interface ModelRunner {
  /**
   * Run the embedding model over the preprocessed text.
   * @returns The calibrated label scores, or an error if the model failed.
   */
  classify(
    text: string,
  ): Promise<{ scores: ClassificationDecision['scores']; metadata: ModelMetadata }>;
}

export interface OrchestratorOptions {
  resident: Resident;
  warnings: DataQualityWarning[];
  /** The embedding model. When omitted, the rules engine answers alone. */
  model?: ModelRunner;
  /** Identifier for the workflow. Defaults to a generated one. */
  workflowId?: string;
  /** Clock injection for deterministic tests. */
  now?: () => number;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Short, readable, collision-resistant workflow identifier. */
function makeWorkflowId(residentId: string, timestamp: number): string {
  const suffix = Math.abs(timestamp).toString(36).slice(-6);
  return `wf-${residentId || 'unknown'}-${suffix}`;
}

export class WorkflowOrchestrator {
  private readonly resident: Resident;

  private readonly warnings: DataQualityWarning[];

  private readonly model?: ModelRunner;

  private readonly workflowId: string;

  private readonly clock: () => number;

  private readonly startedAtMs: number;

  private snapshot: WorkflowSnapshot;

  private stages: WorkflowStageResult[] = [];

  constructor(options: OrchestratorOptions) {
    this.resident = options.resident;
    this.warnings = options.warnings;
    this.model = options.model;
    this.clock = options.now ?? (() => Date.now());
    this.startedAtMs = this.clock();
    this.workflowId = options.workflowId ?? makeWorkflowId(this.resident.id, this.startedAtMs);

    this.snapshot = {
      id: this.workflowId,
      residentId: this.resident.id,
      residentName: this.resident.name,
      status: 'idle',
      startedAt: nowIso(),
      finishedAt: null,
      durationMs: 0,
      stages: [],
      decision: null,
      proposedAction: null,
      normalizedInput: null,
      warnings: options.warnings,
      error: null,
      review: null,
    };
  }

  /** The current immutable snapshot of the workflow. */
  get state(): WorkflowSnapshot {
    return {
      ...this.snapshot,
      stages: [...this.stages],
      warnings: [...this.warnings],
    };
  }

  /**
   * Run the workflow up to the approval gate.
   *
   * The promise resolves with the snapshot when the workflow reaches
   * `awaiting-approval`, `abstained` or `failed`.
   */
  async run(): Promise<WorkflowSnapshot> {
    this.snapshot.status = 'running';
    const stageTimings: { id: WorkflowStageId; durationMs: number }[] = [];

    const runStage = async (
      id: WorkflowStageId,
      status: WorkflowStageStatus,
      detail: string,
      data?: Record<string, string | number | boolean | null>,
    ): Promise<void> => {
      const started = this.clock();
      // Yield to the event loop so the browser can paint between stages.
      await Promise.resolve();
      const durationMs = Math.max(0, this.clock() - started);
      stageTimings.push({ id, durationMs });
      this.stages = [
        ...this.stages,
        {
          id,
          title: STAGE_DEFINITIONS[id].title,
          status,
          durationMs,
          detail,
          data,
        },
      ];
      this.snapshot = { ...this.snapshot, stages: [...this.stages] };
    };

    try {
      // ---- 1. Load resident ----------------------------------------------
      await runStage(
        'load-resident',
        'passed',
        `Loaded ${this.resident.name} with ${this.resident.sourceResourceIds.length} linked resource(s).`,
        {
          residentId: this.resident.id,
          resources: this.resident.sourceResourceIds.length,
        },
      );

      // ---- 2. Validate FHIR ----------------------------------------------
      const errors = this.warnings.filter((warning) => warning.severity === 'error');
      const warningsOnly = this.warnings.filter((warning) => warning.severity === 'warning');
      await runStage(
        'validate-fhir',
        errors.length > 0 ? 'failed' : warningsOnly.length > 0 ? 'warned' : 'passed',
        errors.length > 0
          ? `${errors.length} FHIR validation error(s) block the workflow.`
          : warningsOnly.length > 0
            ? `${warningsOnly.length} FHIR validation warning(s) recorded; the workflow continued.`
            : 'The resident resources passed structural and data-quality validation.',
        { errors: errors.length, warnings: warningsOnly.length },
      );

      if (errors.length > 0) {
        await this.abstain(
          'The record failed FHIR validation, so no recommendation was attempted.',
          'validate-fhir',
        );
        return this.finish('abstained');
      }

      // ---- 3. Retrieve encounters ----------------------------------------
      const encounterText = this.resident.encounters
        .map((encounter) => encounter.reason)
        .filter((reason): reason is string => Boolean(reason));
      await runStage(
        'retrieve-encounter',
        this.resident.encounters.length > 0 ? 'passed' : 'warned',
        this.resident.encounters.length > 0
          ? `Retrieved ${this.resident.encounters.length} encounter(s) with ${encounterText.length} recorded reason(s).`
          : 'No encounters were linked to this resident.',
        { encounters: this.resident.encounters.length, reasons: encounterText.length },
      );

      // ---- 4. Retrieve observations --------------------------------------
      const observationText = this.resident.observations.map((observation) =>
        `${observation.label} ${observation.displayValue} ${observation.unit}`.trim(),
      );
      await runStage(
        'retrieve-observations',
        this.resident.observations.length > 0 ? 'passed' : 'warned',
        this.resident.observations.length > 0
          ? `Retrieved ${this.resident.observations.length} structured observation(s).`
          : 'No structured observations were linked to this resident.',
        { observations: this.resident.observations.length },
      );

      // ---- 5. Process document -------------------------------------------
      const noteText = this.resident.documents
        .map((document) => document.description)
        .filter((description) => description.length > 0);
      const normalized: NormalizedInput = normalizeInput({
        notes: this.resident.documents.map((document) => ({
          id: document.id,
          text: document.description,
        })),
        observations: this.resident.observations.map((observation, index) => ({
          id: observation.id,
          text: observationText[index] ?? '',
        })),
        tasks: this.resident.tasks.map((task) => ({ id: task.id, text: task.description })),
        encounters: this.resident.encounters
          .filter((encounter) => Boolean(encounter.reason))
          .map((encounter) => ({ id: encounter.id, text: encounter.reason ?? '' })),
      });
      this.snapshot = { ...this.snapshot, normalizedInput: normalized.text };

      const engineInputs = buildEngineInputs(normalized);
      await runStage(
        'process-document',
        noteText.length > 0 ? 'passed' : 'warned',
        noteText.length > 0
          ? `Normalized ${noteText.length} narrative note(s) and ${normalized.resourceIds.length} resource reference(s).`
          : 'No narrative notes were available; only structured data was normalized.',
        {
          notes: noteText.length,
          words: countWords(engineInputs.rulesText),
          characters: engineInputs.rulesText.length,
        },
      );

      // ---- 6. Classify ---------------------------------------------------
      const decision = await this.classify(engineInputs, normalized);
      this.snapshot = { ...this.snapshot, decision };

      const decisionStatus =
        decision.status === 'abstained' ? 'warned' : decision.usedFallback ? 'warned' : 'passed';
      await runStage('classify', decisionStatus, decision.rationale, {
        engine: decision.engine,
        label: decision.label,
        confidence: decision.confidence,
        threshold: decision.threshold,
        status: decision.status,
        usedFallback: decision.usedFallback,
      });

      // ---- 7. Check care plan -------------------------------------------
      const openTasks = this.resident.tasks.filter(
        (task) => !task.status || !['completed', 'cancelled'].includes(task.status.toLowerCase()),
      );
      await runStage(
        'check-care-plan',
        openTasks.length > 0 ? 'warned' : 'passed',
        openTasks.length > 0
          ? `${openTasks.length} open care-plan activity/activities require attention.`
          : 'No open care-plan activities were found.',
        { openTasks: openTasks.length, totalTasks: this.resident.tasks.length },
      );

      // ---- 8. Prepare proposed action ------------------------------------
      const proposedAction = this.buildProposedAction(decision, openTasks.length);
      this.snapshot = { ...this.snapshot, proposedAction };

      await runStage(
        'prepare-proposed-action',
        decision.status === 'abstained' ? 'warned' : 'passed',
        decision.status === 'abstained'
          ? 'No action was prepared because the decision was routed to manual review.'
          : proposedAction.summary,
        { label: proposedAction.label, ready: proposedAction.ready },
      );

      // ---- 9. Validate output --------------------------------------------
      const failing = decision.safetyChecks.filter((check) => check.status === 'fail');
      const outputValid =
        decision.status === 'recommended' && failing.length === 0 && Boolean(proposedAction);
      await runStage(
        'validate-output',
        outputValid ? 'passed' : 'failed',
        outputValid
          ? 'The decision passed the output schema and every safety gate.'
          : decision.status === 'abstained'
            ? 'The decision was routed to manual review and produced no executable proposal.'
            : `${failing.length} safety gate(s) failed.`,
        {
          schemaValid: true,
          failingGates: failing.length,
          safetyChecks: decision.safetyChecks.length,
        },
      );

      // ---- 10. Await approval --------------------------------------------
      await runStage(
        'await-approval',
        'passed',
        outputValid
          ? 'Waiting for a human reviewer to approve, edit or reject the proposal.'
          : 'Waiting for a human reviewer to handle the manual-review case.',
        { requiresReviewer: true },
      );
      this.snapshot.status = 'awaiting-approval';
      return this.finish('awaiting-approval');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.snapshot = { ...this.snapshot, status: 'failed', error: message };
      return this.finish('failed');
    }
  }

  /**
   * Run the two engines and combine them.
   *
   * When the model is unavailable or fails, the rules engine answers alone
   * and the decision is marked as a fallback. The failure is surfaced, never
   * swallowed.
   */
  private async classify(
    engineInputs: ReturnType<typeof buildEngineInputs>,
    normalized: NormalizedInput,
  ): Promise<ClassificationDecision> {
    const warnings = this.warnings;

    if (!this.model) {
      return decideWithRules(normalized, warnings);
    }

    try {
      const outcome = await this.model.classify(engineInputs.modelText);
      return decideWithEnsemble({
        modelScores: outcome.scores,
        model: outcome.metadata,
        normalized,
        warnings,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const decision = decideWithRules(normalized, warnings);
      return {
        ...decision,
        usedFallback: true,
        modelFailed: true,
        modelError: message,
        rationale: `The embedding model could not run (${message}). The decision below comes from the deterministic rules engine, not from model inference.`,
      };
    }
  }

  /** Build the administrative proposal from the selected label. */
  private buildProposedAction(
    decision: ClassificationDecision,
    openTaskCount: number,
  ): ProposedAction {
    const definition = LABEL_DEFINITIONS[decision.label];
    const sourceResourceIds = decision.inputResourceIds;

    const summary =
      decision.status === 'abstained'
        ? `Route ${this.resident.name} for manual review; no automated action was prepared.`
        : `${definition.title}: ${definition.proposedAction}`;

    const rationale =
      decision.status === 'abstained'
        ? `The decision was routed to manual review because ${decision.rationale}`
        : `${decision.rationale} The proposal is administrative workflow routing only.`;

    const taskNote =
      openTaskCount > 0
        ? ` ${openTaskCount} open care-plan activity/activities are already recorded for this resident.`
        : '';

    return {
      id: `${this.workflowId}-proposal`,
      label: decision.label,
      action: definition.proposedAction,
      summary: summary + taskNote,
      rationale,
      sourceResourceIds,
      ready: decision.status === 'recommended',
    };
  }

  /**
   * Record the human reviewer's decision.
   *
   * This is the only way a workflow can leave `awaiting-approval`. The
   * `complete` stage is appended here, because the workflow genuinely cannot
   * be completed until a human has decided.
   */
  review(decision: ReviewDecision): WorkflowSnapshot {
    const started = this.clock();
    this.snapshot = { ...this.snapshot, review: decision };
    this.snapshot.status = decision.outcome === 'rejected' ? 'rejected' : 'completed';

    const detail =
      decision.outcome === 'rejected'
        ? `A reviewer rejected the proposal: ${decision.note || 'no reason recorded'}.`
        : decision.outcome === 'edited'
          ? `A reviewer edited the proposal to "${LABEL_DEFINITIONS[decision.finalLabel].title}".`
          : `A reviewer approved the proposal.`;

    this.stages = [
      ...this.stages,
      {
        id: 'complete',
        title: STAGE_DEFINITIONS.complete.title,
        status: decision.outcome === 'rejected' ? 'failed' : 'passed',
        durationMs: Math.max(0, this.clock() - started),
        detail,
        data: {
          outcome: decision.outcome,
          finalLabel: decision.finalLabel,
          reviewer: decision.reviewer,
        },
      },
    ];

    return this.finish(this.snapshot.status);
  }

  /** Abort the workflow early because it cannot produce a recommendation. */
  private async abstain(detail: string, stage: WorkflowStageId): Promise<void> {
    this.stages = [
      ...this.stages,
      {
        id: stage,
        title: STAGE_DEFINITIONS[stage].title,
        status: 'failed',
        durationMs: 0,
        detail,
      },
    ];
    this.snapshot = { ...this.snapshot, stages: [...this.stages] };
  }

  /** Finalise the snapshot with the total duration. */
  private finish(status: WorkflowStatus): WorkflowSnapshot {
    this.snapshot = {
      ...this.snapshot,
      status,
      finishedAt: nowIso(),
      durationMs: Math.max(0, this.clock() - this.startedAtMs),
      stages: [...this.stages],
    };
    return this.state;
  }
}

export { WORKFLOW_STAGES, STAGE_DEFINITIONS };
export type { WorkflowStageId, WorkflowStageResult, WorkflowStageStatus };
