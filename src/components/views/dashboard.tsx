'use client';

import { useMemo } from 'react';
import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  Cpu,
  Database,
  LoaderCircle,
  Play,
  Users,
} from 'lucide-react';

import { useApp, classifyResidentWithRules } from '@/lib/app-state.tsx';
import { Card, EmptyState, LabelPill, Notice, Stat } from '@/components/ui.tsx';
import type { ViewId } from '@/lib/navigation.ts';
import type { WorkflowLabel } from '@/lib/ai/types.ts';

export function DashboardView({ onNavigate }: { onNavigate: (view: ViewId) => void }) {
  const {
    datasetStatus,
    datasetError,
    parseResult,
    residents,
    selectedResident,
    selectResident,
    model,
    loadModel,
    runWorkflow,
    workflowRunning,
    events,
    auditEntries,
  } = useApp();

  /**
   * The queue breakdown is computed locally with the deterministic rules
   * engine so the dashboard is useful the moment the dataset loads, without
   * waiting for a 32 MB model download. The label is explicit about which
   * engine produced it.
   */
  const queue = useMemo(() => {
    const counts: Record<WorkflowLabel, number> = { priority: 0, 'follow-up': 0, routine: 0 };
    let lowConfidence = 0;
    for (const resident of residents) {
      const result = classifyResidentWithRules(resident);
      counts[result.label] += 1;
      if (result.confidence < 0.75) lowConfidence += 1;
    }
    return { counts, lowConfidence };
  }, [residents]);

  const resourceCount = parseResult?.resources.length ?? 0;
  const warningCount = parseResult?.warnings.length ?? 0;
  const synthetic = parseResult
    ? parseResult.warnings.filter((w) => w.code === 'bundle.synthetic')
    : [];

  const awaitingReview = events.filter((event) => event.status === 'awaiting-approval').length;

  return (
    <div className="stack">
      {datasetStatus === 'error' && (
        <Notice tone="danger">
          <strong>The synthetic dataset could not be loaded.</strong> {datasetError}
        </Notice>
      )}

      <div className="grid grid-4">
        <Stat
          label="Residents awaiting review"
          value={residents.length}
          note={`${queue.counts.priority + queue.counts['follow-up']} need a workflow decision`}
          icon={<Users />}
        />
        <Stat
          label="Priority review"
          value={queue.counts.priority}
          note="Computed by the rules engine"
          tone="priority"
          icon={<AlertTriangle />}
        />
        <Stat
          label="Follow-up"
          value={queue.counts['follow-up']}
          note="Computed by the rules engine"
          tone="followup"
        />
        <Stat
          label="Routine"
          value={queue.counts.routine}
          note="Computed by the rules engine"
          tone="routine"
          icon={<CheckCircle2 />}
        />
      </div>

      <div className="grid grid-sidebar">
        <div className="stack">
          <Card
            title="Model status"
            subtitle="The embedding model runs in your browser. Nothing is sent to a server."
          >
            <div className="stack stack-sm">
              <div className="row spread">
                <span className="stat-label">Browser inference</span>
                <span
                  className={`pill pill-${
                    model.status === 'ready'
                      ? 'routine'
                      : model.status === 'error'
                        ? 'danger'
                        : model.status === 'loading'
                          ? 'warn'
                          : 'neutral'
                  }`}
                >
                  {model.status === 'loading' && <LoaderCircle className="spin" size={12} />}
                  {model.status}
                </span>
              </div>

              {model.status === 'idle' && (
                <>
                  <p className="prose">
                    The model has not been downloaded yet. Loading it fetches roughly 32 MB of
                    quantized weights into your browser cache; the deterministic rules engine can
                    answer without it.
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary btn-block"
                    onClick={() => void loadModel()}
                  >
                    <BrainCircuit /> Load browser model
                  </button>
                </>
              )}

              {model.status === 'loading' && (
                <>
                  <div className="progress-track">
                    <div
                      className="progress-fill"
                      style={{ width: `${Math.max(4, Math.round(model.progress * 100))}%` }}
                    />
                  </div>
                  <p className="prose">
                    {model.progressFile
                      ? `Fetching ${model.progressFile.split('/').pop()}`
                      : 'Fetching model weights'}
                    {' · '}
                    {Math.round(model.progress * 100)}%
                  </p>
                </>
              )}

              {model.status === 'ready' && model.info && (
                <dl className="kv">
                  <dt>Model</dt>
                  <dd className="mono">{model.info.modelId}</dd>
                  <dt>Quantization</dt>
                  <dd>{model.info.dtype}</dd>
                  <dt>Parameters</dt>
                  <dd>{model.info.parameters}</dd>
                  <dt>Weights size</dt>
                  <dd>{model.info.modelSize}</dd>
                  <dt>Load time</dt>
                  <dd>{model.info.loadMs} ms</dd>
                </dl>
              )}

              {model.status === 'error' && (
                <Notice tone="warn">
                  <strong>The model could not be loaded.</strong>
                  <div className="mono" style={{ marginTop: 4 }}>
                    {model.detail}
                  </div>
                  <div style={{ marginTop: 8 }}>
                    The deterministic rules engine still answers every request. The workflow labels
                    its output as a fallback so the distinction is never hidden.
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm"
                    style={{ marginTop: 10 }}
                    onClick={() => void loadModel()}
                  >
                    Retry model load
                  </button>
                </Notice>
              )}
            </div>
          </Card>

          <Card title="Dataset status">
            <dl className="kv">
              <dt>State</dt>
              <dd>{datasetStatus}</dd>
              <dt>Residents</dt>
              <dd>{residents.length}</dd>
              <dt>FHIR resources</dt>
              <dd>{resourceCount}</dd>
              <dt>Validation messages</dt>
              <dd>{warningCount}</dd>
              <dt>Provenance</dt>
              <dd>
                {synthetic.length > 0 ? (
                  <span className="pill pill-accent">Tagged SYNTHETIC</span>
                ) : (
                  'Synthetic marker present in every note'
                )}
              </dd>
            </dl>
          </Card>
        </div>

        <div className="stack">
          <Card
            title="Resident queue"
            subtitle="Select a resident to open the workspace and run the workflow."
            actions={
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!selectedResident || workflowRunning}
                onClick={() => void runWorkflow()}
              >
                {workflowRunning ? <LoaderCircle className="spin" /> : <Play />}
                {workflowRunning ? 'Running…' : 'Run CareFlow'}
              </button>
            }
          >
            {residents.length === 0 ? (
              <EmptyState icon={<Database />} title="No residents loaded">
                The synthetic bundle is still loading or failed to parse.
              </EmptyState>
            ) : (
              <div className="resident-list">
                {residents.map((resident) => {
                  const result = classifyResidentWithRules(resident);
                  return (
                    <button
                      type="button"
                      key={resident.id}
                      className="resident-item"
                      aria-pressed={selectedResident?.id === resident.id}
                      onClick={() => {
                        selectResident(resident.id);
                        onNavigate('residents');
                      }}
                    >
                      <span className="avatar" aria-hidden="true">
                        {resident.name
                          .split(' ')
                          .map((part) => part[0])
                          .slice(0, 2)
                          .join('')}
                      </span>
                      <span style={{ minWidth: 0, flex: 1 }}>
                        <span className="row spread">
                          <span className="resident-name">{resident.name}</span>
                          <LabelPill label={result.label} />
                        </span>
                        <span className="resident-meta">
                          {resident.ageYears !== null ? `${resident.ageYears} yrs` : 'age unknown'}{' '}
                          · {resident.encounters.length} encounters · {resident.observations.length}{' '}
                          observations · {resident.tasks.length} open tasks
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </Card>

          <Card
            title="Recent workflow runs"
            subtitle="Recorded in this browser's local storage. Nothing leaves your device."
            actions={
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => onNavigate('observability')}
              >
                Open observability
              </button>
            }
          >
            {events.length === 0 ? (
              <EmptyState icon={<Cpu />} title="No workflow has run yet">
                Run CareFlow on a resident and the real stage timings will appear here.
              </EmptyState>
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Resident</th>
                      <th>Label</th>
                      <th>Engine</th>
                      <th className="num">Confidence</th>
                      <th className="num">Duration</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.slice(0, 6).map((event) => (
                      <tr key={event.id}>
                        <td>{event.residentName}</td>
                        <td>
                          <LabelPill label={event.label as WorkflowLabel} />
                        </td>
                        <td>{event.engine}</td>
                        <td className="num">{Math.round(event.confidence * 100)}%</td>
                        <td className="num">{event.durationMs} ms</td>
                        <td>{event.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <div className="grid grid-3">
            <Stat
              label="Awaiting review"
              value={awaitingReview}
              note="Workflows stopped at the human gate"
              icon={<ClipboardIcon />}
            />
            <Stat
              label="Low confidence"
              value={queue.lowConfidence}
              note={`Below the ${0.75} decision threshold`}
              icon={<AlertTriangle />}
            />
            <Stat
              label="Audit decisions"
              value={auditEntries.length}
              note="Recorded reviewer outcomes"
              icon={<CheckCircle2 />}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function ClipboardIcon() {
  return <Cpu />;
}
