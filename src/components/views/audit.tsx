'use client';

import { useState } from 'react';
import { ScrollText, Trash2 } from 'lucide-react';

import { useApp } from '@/lib/app-state.tsx';
import { Card, EmptyState, KeyValue, LabelPill, Notice } from '@/components/ui.tsx';
import type { WorkflowLabel } from '@/lib/ai/types.ts';

export function AuditView() {
  const { auditEntries, resetAudit } = useApp();
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="stack">
      <Notice tone="neutral">
        <strong>Append-only demonstration audit trail.</strong> Each entry records the proposal, the
        evidence behind it, the model metadata, the reviewer&apos;s decision and the reason they
        gave. Entries are stored locally in this browser and are never transmitted.
      </Notice>

      <Card
        title="Reviewer decisions"
        subtitle={`${auditEntries.length} recorded entr${auditEntries.length === 1 ? 'y' : 'ies'}.`}
        actions={
          auditEntries.length > 0 ? (
            <button type="button" className="btn btn-sm" onClick={resetAudit}>
              <Trash2 /> Clear trail
            </button>
          ) : null
        }
      >
        {auditEntries.length === 0 ? (
          <EmptyState icon={<ScrollText />} title="No decisions recorded yet">
            Approve, edit or reject a proposal in the review view and the decision will appear here.
          </EmptyState>
        ) : (
          <div className="stack">
            {auditEntries.map((entry) => {
              const open = expanded === entry.id;
              return (
                <div key={entry.id} className="card" style={{ borderRadius: 12 }}>
                  <div className="card-head">
                    <div>
                      <div className="row">
                        <span style={{ fontWeight: 700 }}>{entry.residentName}</span>
                        <span
                          className={`pill pill-${
                            entry.outcome === 'approved'
                              ? 'routine'
                              : entry.outcome === 'edited'
                                ? 'warn'
                                : 'danger'
                          }`}
                        >
                          {entry.outcome}
                        </span>
                        {entry.proposedLabel !== entry.finalLabel && (
                          <span className="pill pill-neutral">
                            proposed {entry.proposedLabel} → {entry.finalLabel}
                          </span>
                        )}
                        {entry.usedFallback && <span className="pill pill-warn">fallback</span>}
                      </div>
                      <p className="card-sub" style={{ marginTop: 4 }}>
                        <span className="mono">{entry.workflowId}</span> ·{' '}
                        {new Date(entry.timestamp).toLocaleString()} · {entry.reviewer}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm"
                      aria-expanded={open}
                      onClick={() => setExpanded(open ? null : entry.id)}
                    >
                      {open ? 'Hide detail' : 'Show detail'}
                    </button>
                  </div>

                  <div className="card-body">
                    <p className="prose">
                      <strong>Reason:</strong> {entry.note || 'No reason recorded.'}
                    </p>

                    {open && (
                      <div className="stack" style={{ marginTop: 14 }}>
                        <KeyValue
                          items={[
                            { label: 'Proposed label', value: entry.proposedLabel },
                            { label: 'Final label', value: entry.finalLabel },
                            { label: 'Engine', value: entry.engine },
                            {
                              label: 'Confidence',
                              value: `${Math.round(entry.confidence * 100)}%`,
                            },
                            { label: 'Decided at', value: entry.timestamp },
                            { label: 'Reviewer', value: entry.reviewer },
                          ]}
                        />

                        <div>
                          <p className="stat-label" style={{ marginBottom: 5 }}>
                            System rationale
                          </p>
                          <p className="prose">{entry.rationale}</p>
                        </div>

                        {entry.artifact && (
                          <div>
                            <p className="stat-label" style={{ marginBottom: 5 }}>
                              Synthetic FHIR artifact produced by this decision
                            </p>
                            <pre className="code">{JSON.stringify(entry.artifact, null, 2)}</pre>
                            <Notice tone="warn">
                              This is a demonstration artifact stored in your browser. CareFlow did
                              not and cannot write to a real electronic health record.
                            </Notice>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {auditEntries.length > 0 && (
        <Card title="All recorded labels" subtitle="A quick roll-up of what reviewers decided.">
          <div className="row">
            {Object.entries(
              auditEntries.reduce<Record<string, number>>((counts, entry) => {
                counts[entry.finalLabel] = (counts[entry.finalLabel] ?? 0) + 1;
                return counts;
              }, {}),
            ).map(([label, count]) => (
              <LabelPill key={label} label={label as WorkflowLabel}>
                {count}
              </LabelPill>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
