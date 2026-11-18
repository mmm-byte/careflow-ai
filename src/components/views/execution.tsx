'use client';

import { useApp } from '@/lib/app-state.tsx';
import {
  Card,
  EmptyState,
  KeyValue,
  LabelPill,
  Notice,
  StageStatusIcon,
} from '@/components/ui.tsx';
import type { ViewId } from '@/lib/navigation.ts';

export function ExecutionView({ onNavigate }: { onNavigate: (view: ViewId) => void }) {
  const { workflow, workflowRunning } = useApp();

  if (!workflow) {
    return (
      <Card>
        <EmptyState title="No workflow has been run yet">
          Run CareFlow from the dashboard or the resident workspace. The orchestrator records the
          real duration of every stage it executes.
        </EmptyState>
      </Card>
    );
  }

  const failed = workflow.stages.filter((stage) => stage.status === 'failed');
  const warned = workflow.stages.filter((stage) => stage.status === 'warned');

  return (
    <div className="stack">
      <div className="grid grid-4">
        <div className="stat">
          <div className="stat-label">Workflow id</div>
          <div className="mono" style={{ marginTop: 6, fontSize: 12, wordBreak: 'break-all' }}>
            {workflow.id}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Status</div>
          <div className="stat-value" style={{ fontSize: 20 }}>
            {workflow.status}
          </div>
          <div className="stat-note">{workflow.stages.length} stages recorded</div>
        </div>
        <div className="stat stat-accent">
          <div className="stat-label">Total duration</div>
          <div className="stat-value">{workflow.durationMs} ms</div>
          <div className="stat-note">Wall clock across every stage</div>
        </div>
        <div className="stat">
          <div className="stat-label">Decision</div>
          <div style={{ marginTop: 8 }}>
            {workflow.decision ? (
              <LabelPill label={workflow.decision.label}>
                {workflow.decision.status === 'abstained'
                  ? 'Manual review'
                  : `${Math.round(workflow.decision.confidence * 100)}% confidence`}
              </LabelPill>
            ) : (
              <span className="pill pill-neutral">No decision</span>
            )}
          </div>
        </div>
      </div>

      {workflowRunning && (
        <Notice>
          The workflow is still running. Stages appear as the orchestrator completes them, so the
          timings below are real measurements rather than an animation.
        </Notice>
      )}

      {failed.length > 0 && (
        <Notice tone="danger">
          <strong>
            {failed.length} stage{failed.length === 1 ? '' : 's'} failed.
          </strong>{' '}
          {failed.map((stage) => stage.title).join(', ')}. The workflow stopped before producing a
          recommendation.
        </Notice>
      )}

      <div className="grid grid-sidebar">
        <Card
          title="Stage timeline"
          subtitle="Each row is an operation the orchestrator actually performed."
        >
          <div className="stages">
            {workflow.stages.map((stage) => (
              <div className={`stage ${stage.status}`} key={stage.id}>
                <span className="stage-icon">
                  <StageStatusIcon status={stage.status} />
                </span>
                <div style={{ minWidth: 0 }}>
                  <p className="stage-name">{stage.title}</p>
                  <p className="stage-detail">{stage.detail}</p>
                </div>
                <span className="stage-time">{stage.durationMs} ms</span>
              </div>
            ))}
          </div>
        </Card>

        <div className="stack">
          <Card title="Workflow summary">
            <KeyValue
              items={[
                { label: 'Resident', value: workflow.residentName },
                { label: 'Identifier', value: workflow.residentId },
                { label: 'Started', value: workflow.startedAt },
                { label: 'Finished', value: workflow.finishedAt ?? 'Still running' },
                { label: 'Stages', value: `${workflow.stages.length} executed` },
                {
                  label: 'Warnings',
                  value: `${workflow.warnings.length} data-quality message(s)`,
                },
                {
                  label: 'Review',
                  value: workflow.review
                    ? `${workflow.review.outcome} by ${workflow.review.reviewer}`
                    : 'Awaiting a human decision',
                },
              ]}
            />
          </Card>

          {workflow.proposedAction && (
            <Card title="Proposed action" subtitle="Administrative workflow routing only.">
              <div className="stack stack-sm">
                <LabelPill label={workflow.proposedAction.label}>
                  {workflow.proposedAction.ready ? 'Ready for review' : 'Manual review required'}
                </LabelPill>
                <p style={{ fontWeight: 650 }}>{workflow.proposedAction.action}</p>
                <p className="prose">{workflow.proposedAction.summary}</p>
                <div>
                  <p className="stat-label" style={{ marginBottom: 5 }}>
                    Grounded in
                  </p>
                  <div className="row">
                    {workflow.proposedAction.sourceResourceIds.map((id) => (
                      <span key={id} className="pill pill-neutral mono">
                        {id}
                      </span>
                    ))}
                  </div>
                </div>
                {workflow.proposedAction.ready && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ alignSelf: 'flex-start' }}
                    onClick={() => onNavigate('approval')}
                  >
                    Go to review and approval
                  </button>
                )}
              </div>
            </Card>
          )}

          {warned.length > 0 && (
            <Card title="Stages that raised a warning">
              <div className="stack stack-sm">
                {warned.map((stage) => (
                  <div key={stage.id} className="notice notice-warn">
                    <div>
                      <strong>{stage.title}</strong>
                      <div style={{ marginTop: 2 }}>{stage.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
