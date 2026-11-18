'use client';

import { Activity, RotateCcw, Trash2 } from 'lucide-react';

import { useApp } from '@/lib/app-state.tsx';
import { Card, EmptyState, LabelPill, Notice, Stat } from '@/components/ui.tsx';
import { summariseEvents } from '@/lib/observability/recorder.ts';
import type { WorkflowLabel } from '@/lib/ai/types.ts';

export function ObservabilityView() {
  const { events, resetObservability } = useApp();
  const summary = summariseEvents(events);

  const stageMeans = [...summary.meanStageDurations].sort(
    (a, b) => summary.meanStageDurations.indexOf(a) - summary.meanStageDurations.indexOf(b),
  );

  return (
    <div className="stack">
      <Notice tone="neutral">
        <strong>Locally stored demonstration telemetry.</strong> These events are written to this
        browser&apos;s <span className="mono">localStorage</span> when you run a workflow. Nothing
        is sent to a server, and clearing your browser data removes them.
      </Notice>

      <div className="grid grid-4">
        <Stat label="Workflow runs" value={summary.totalRuns} note="Recorded in this browser" />
        <Stat
          label="Completed"
          value={summary.completed}
          note="A reviewer approved or edited"
          tone="routine"
        />
        <Stat
          label="Abstained"
          value={summary.abstained}
          note="Routed to manual review"
          tone="followup"
        />
        <Stat
          label="Model fallbacks"
          value={summary.fallbacks}
          note="Rules engine answered instead"
          tone={summary.fallbacks > 0 ? 'priority' : undefined}
        />
      </div>

      <div className="grid grid-sidebar">
        <Card
          title="Mean stage duration"
          subtitle="Averaged across every recorded run of each stage."
          actions={
            <button
              type="button"
              className="btn btn-sm"
              onClick={resetObservability}
              disabled={events.length === 0}
            >
              <Trash2 /> Reset telemetry
            </button>
          }
        >
          {stageMeans.length === 0 ? (
            <EmptyState icon={<Activity />} title="No stage timings yet">
              Run a workflow to record real stage durations.
            </EmptyState>
          ) : (
            <div className="stack stack-sm">
              {stageMeans.map((stage) => (
                <div key={stage.id}>
                  <div className="row spread">
                    <span className="score-label">{stage.title}</span>
                    <span className="score-value">{stage.meanMs} ms</span>
                  </div>
                  <div className="meter" style={{ marginTop: 4 }}>
                    <div
                      className="meter-fill"
                      style={{
                        width: `${Math.min(100, (stage.meanMs / Math.max(1, summary.meanDurationMs)) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
              <hr className="divider" />
              <div className="row spread">
                <span className="stat-label">Mean total workflow duration</span>
                <span className="score-value">{summary.meanDurationMs} ms</span>
              </div>
            </div>
          )}
        </Card>

        <Card
          title="Recorded events"
          subtitle={`${events.length} event(s), newest first.`}
          actions={
            events.length > 0 ? (
              <button type="button" className="btn btn-sm" onClick={resetObservability}>
                <RotateCcw /> Reset
              </button>
            ) : null
          }
        >
          {events.length === 0 ? (
            <EmptyState icon={<Activity />} title="Nothing recorded yet">
              Events appear here as soon as you run a workflow.
            </EmptyState>
          ) : (
            <div className="stack">
              {events.map((event) => (
                <div key={event.id} className="notice" style={{ alignItems: 'flex-start' }}>
                  <Activity aria-hidden="true" />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="row spread">
                      <span style={{ fontWeight: 650 }}>{event.residentName}</span>
                      <LabelPill label={event.label as WorkflowLabel} />
                    </div>
                    <p className="stat-note" style={{ marginTop: 3 }}>
                      <span className="mono">{event.workflowId}</span> ·{' '}
                      {new Date(event.timestamp).toLocaleString()}
                    </p>
                    <div className="row" style={{ marginTop: 6 }}>
                      <span className="pill pill-neutral">engine: {event.engine}</span>
                      <span className="pill pill-neutral">
                        confidence: {Math.round(event.confidence * 100)}%
                      </span>
                      <span className="pill pill-neutral">{event.durationMs} ms total</span>
                      <span className="pill pill-neutral">{event.stageCount} stages</span>
                      {event.usedFallback && <span className="pill pill-warn">fallback used</span>}
                      {event.reviewOutcome && (
                        <span className="pill pill-accent">review: {event.reviewOutcome}</span>
                      )}
                    </div>
                    <details style={{ marginTop: 8 }}>
                      <summary style={{ cursor: 'pointer', fontSize: 12 }}>
                        Per-stage durations
                      </summary>
                      <div className="table-wrap" style={{ marginTop: 8 }}>
                        <table className="data">
                          <thead>
                            <tr>
                              <th>Stage</th>
                              <th>Status</th>
                              <th className="num">Duration</th>
                            </tr>
                          </thead>
                          <tbody>
                            {event.stageDurations.map((stage) => (
                              <tr key={stage.id}>
                                <td>{stage.title}</td>
                                <td>{stage.status}</td>
                                <td className="num">{stage.durationMs} ms</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
