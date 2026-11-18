'use client';

import { useState } from 'react';
import { Check, Edit3, ShieldAlert, X } from 'lucide-react';

import { useApp } from '@/lib/app-state.tsx';
import { Card, EmptyState, LabelPill, Notice } from '@/components/ui.tsx';
import { LABEL_DEFINITIONS, WORKFLOW_LABELS, type WorkflowLabel } from '@/lib/ai/types.ts';
import type { ReviewDecision } from '@/lib/workflow/orchestrator.ts';

const REVIEWER = 'Demo reviewer (synthetic session)';

export function ApprovalView() {
  const { workflow, submitReview } = useApp();
  const [note, setNote] = useState('');
  const [editedLabel, setEditedLabel] = useState<WorkflowLabel | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!workflow) {
    return (
      <Card>
        <EmptyState title="No proposal is awaiting review">
          Run CareFlow on a resident to produce a proposal that needs a human decision.
        </EmptyState>
      </Card>
    );
  }

  if (workflow.review) {
    return (
      <div className="stack">
        <Notice tone={workflow.review.outcome === 'rejected' ? 'warn' : 'neutral'}>
          This workflow was already decided: <strong>{workflow.review.outcome}</strong> by{' '}
          {workflow.review.reviewer} at {workflow.review.decidedAt}. Run the workflow again to
          produce a new proposal.
        </Notice>
        <Card title="Recorded decision">
          <div className="stack stack-sm">
            <LabelPill label={workflow.review.finalLabel} />
            <p className="prose">{workflow.review.note || 'No reason was recorded.'}</p>
          </div>
        </Card>
      </div>
    );
  }

  if (!workflow.proposedAction) {
    return (
      <Card>
        <EmptyState icon={<ShieldAlert />} title="No proposal was prepared">
          The workflow could not produce a proposal. Inspect the agent execution view for the stage
          that stopped it.
        </EmptyState>
      </Card>
    );
  }

  const proposal = workflow.proposedAction;
  const finalLabel = editedLabel ?? proposal.label;

  const submit = (outcome: ReviewDecision['outcome']) => {
    if (outcome !== 'approved' && note.trim().length === 0) {
      setError('A reason is required when you edit or reject a proposal.');
      return;
    }
    setError(null);

    const decision: ReviewDecision = {
      outcome,
      note: note.trim() || 'Approved as proposed.',
      finalLabel,
      decidedAt: new Date().toISOString(),
      reviewer: REVIEWER,
    };

    submitReview(decision);
    setNote('');
    setEditedLabel(null);
  };

  return (
    <div className="stack">
      <Notice tone="warn">
        <strong>Human approval is required.</strong> CareFlow never executes anything on its own.
        Your decision, the reason you give and the evidence behind it are written to the audit trail
        as a synthetic demonstration artifact.
      </Notice>

      <div className="grid grid-sidebar">
        <Card title="Proposal">
          <div className="stack stack-sm">
            <LabelPill label={proposal.label}>
              {proposal.ready ? 'Recommended action' : 'Manual review required'}
            </LabelPill>
            <p style={{ fontWeight: 650, fontSize: 15 }}>{proposal.action}</p>
            <p className="prose">{proposal.summary}</p>
            <hr className="divider" />
            <div>
              <p className="stat-label" style={{ marginBottom: 5 }}>
                Grounded in {proposal.sourceResourceIds.length} resource(s)
              </p>
              <div className="row">
                {proposal.sourceResourceIds.map((id) => (
                  <span key={id} className="pill pill-neutral mono">
                    {id}
                  </span>
                ))}
              </div>
            </div>
            {workflow.decision && (
              <>
                <hr className="divider" />
                <p className="stat-label" style={{ marginBottom: 5 }}>
                  System confidence
                </p>
                <div className="row">
                  <span className="pill pill-accent">
                    {Math.round(workflow.decision.confidence * 100)}% confidence
                  </span>
                  <span className="pill pill-neutral">
                    {workflow.decision.engine}
                    {workflow.decision.usedFallback ? ' (fallback)' : ''}
                  </span>
                </div>
              </>
            )}
          </div>
        </Card>

        <Card
          title="Your decision"
          subtitle="Approve, edit or reject. A reason is required for edits and rejections."
        >
          <div className="stack">
            <div className="field">
              <label className="field-label" htmlFor="review-label">
                Final workflow label
              </label>
              <select
                id="review-label"
                className="select"
                value={finalLabel}
                onChange={(event) => setEditedLabel(event.target.value as WorkflowLabel)}
              >
                {WORKFLOW_LABELS.map((label) => (
                  <option key={label} value={label}>
                    {LABEL_DEFINITIONS[label].title} — {LABEL_DEFINITIONS[label].description}
                  </option>
                ))}
              </select>
              <p className="field-hint">
                Change this only if the system proposed the wrong administrative route. The original
                proposal and your override are both recorded.
              </p>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="review-note">
                Reason
              </label>
              <textarea
                id="review-note"
                className="textarea"
                value={note}
                placeholder="Why is this the right administrative action?"
                onChange={(event) => {
                  setNote(event.target.value);
                  if (error) setError(null);
                }}
              />
              <p className="field-hint">
                Stored verbatim in the audit trail alongside the decision and the evidence.
              </p>
            </div>

            {error && <Notice tone="danger">{error}</Notice>}

            <div className="row">
              <button
                type="button"
                className="btn btn-primary"
                disabled={!proposal.ready}
                onClick={() => submit('approved')}
              >
                <Check /> Approve
              </button>
              <button
                type="button"
                className="btn"
                disabled={!proposal.ready}
                onClick={() => submit('edited')}
              >
                <Edit3 /> Save edit
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={!proposal.ready}
                onClick={() => submit('rejected')}
              >
                <X /> Reject
              </button>
            </div>

            {!proposal.ready && (
              <Notice tone="warn">
                This record was routed to manual review because the system did not have enough
                confidence to propose an action. The buttons are disabled so the workflow cannot be
                completed with an unsupported recommendation. Review the record directly and record
                the outcome after the underlying data has been corrected.
              </Notice>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
