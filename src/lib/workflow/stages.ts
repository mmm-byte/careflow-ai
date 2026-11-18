/**
 * Workflow stage definitions.
 *
 * The orchestrator runs a fixed sequence of named stages. Each stage reports
 * its own duration, so the Agent Execution View shows real elapsed time
 * rather than an animated fiction.
 */

export const WORKFLOW_STAGES = [
  'load-resident',
  'validate-fhir',
  'retrieve-encounter',
  'retrieve-observations',
  'process-document',
  'classify',
  'check-care-plan',
  'prepare-proposed-action',
  'validate-output',
  'await-approval',
  'complete',
] as const;

export type WorkflowStageId = (typeof WORKFLOW_STAGES)[number];

export interface StageDefinition {
  id: WorkflowStageId;
  title: string;
  /** What the stage actually does, in plain language. */
  description: string;
  /** Whether the stage may end the workflow early with an abstention. */
  canAbstain: boolean;
}

export const STAGE_DEFINITIONS: Record<WorkflowStageId, StageDefinition> = {
  'load-resident': {
    id: 'load-resident',
    title: 'Load resident',
    description: 'Resolve the selected resident and collect the FHIR resources attributed to them.',
    canAbstain: false,
  },
  'validate-fhir': {
    id: 'validate-fhir',
    title: 'Validate FHIR',
    description:
      'Check the bundle and the resident resources for structural and data-quality problems.',
    canAbstain: false,
  },
  'retrieve-encounter': {
    id: 'retrieve-encounter',
    title: 'Retrieve encounters',
    description: 'Gather the encounters linked to the resident and extract their reasons.',
    canAbstain: false,
  },
  'retrieve-observations': {
    id: 'retrieve-observations',
    title: 'Retrieve observations',
    description: 'Gather the structured measurements and render them as comparable text.',
    canAbstain: false,
  },
  'process-document': {
    id: 'process-document',
    title: 'Process documents',
    description:
      'Retrieve the narrative notes and normalize the wording the classifiers will read.',
    canAbstain: false,
  },
  classify: {
    id: 'classify',
    title: 'Classify',
    description:
      'Run the embedding model and the deterministic rules engine, and compare their conclusions.',
    canAbstain: true,
  },
  'check-care-plan': {
    id: 'check-care-plan',
    title: 'Check care plan',
    description:
      'Review the open care-plan activities and tasks for outstanding administrative work.',
    canAbstain: false,
  },
  'prepare-proposed-action': {
    id: 'prepare-proposed-action',
    title: 'Prepare proposed action',
    description:
      'Turn the selected label into a proposed administrative workflow action. No clinical content is generated.',
    canAbstain: false,
  },
  'validate-output': {
    id: 'validate-output',
    title: 'Validate output',
    description:
      'Check the decision against the output schema and the safety gates before it can be shown.',
    canAbstain: true,
  },
  'await-approval': {
    id: 'await-approval',
    title: 'Await approval',
    description:
      'Present the proposal to a human reviewer. Nothing is actioned until a reviewer decides.',
    canAbstain: false,
  },
  complete: {
    id: 'complete',
    title: 'Complete',
    description: 'Record the reviewer decision and close the workflow.',
    canAbstain: false,
  },
};

export type WorkflowStageStatus =
  'pending' | 'running' | 'passed' | 'warned' | 'failed' | 'skipped';

export interface WorkflowStageResult {
  id: WorkflowStageId;
  title: string;
  status: WorkflowStageStatus;
  /** Wall-clock duration of the stage in milliseconds. */
  durationMs: number;
  /** Detail shown in the Agent Execution View. */
  detail: string;
  /** Additional structured facts about the stage. */
  data?: Record<string, string | number | boolean | null>;
}

export function stageTitle(id: WorkflowStageId): string {
  return STAGE_DEFINITIONS[id].title;
}
