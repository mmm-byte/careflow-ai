'use client';

import { useCallback, useState } from 'react';
import { FlaskConical, LoaderCircle, Play, TriangleAlert } from 'lucide-react';

import { useApp } from '@/lib/app-state.tsx';
import { Card, EmptyState, LabelPill, Notice, Stat } from '@/components/ui.tsx';
import { EVALUATION_SCENARIOS } from '@/lib/eval/scenarios.ts';
import { VALIDATION_SCENARIOS } from '@/lib/eval/validation.ts';
import { runEvaluation, type EvaluationRun } from '@/lib/eval/runner.ts';
import { createBrowserEngines, createRulesOnlyEngines } from '@/lib/eval/browser-engine.ts';
import { ModelClient } from '@/lib/ai/model-client.ts';

type SuiteId = 'tuning' | 'validation';

const SUITES: { id: SuiteId; label: string; scenarios: typeof EVALUATION_SCENARIOS }[] = [
  { id: 'tuning', label: 'Tuning suite', scenarios: EVALUATION_SCENARIOS },
  { id: 'validation', label: 'Held-out validation', scenarios: VALIDATION_SCENARIOS },
];

export function EvaluationView() {
  const { model } = useApp();
  const [suiteId, setSuiteId] = useState<SuiteId>('tuning');
  const [running, setRunning] = useState(false);
  const [runs, setRuns] = useState<{ engine: string; run: EvaluationRun }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const suite = SUITES.find((entry) => entry.id === suiteId) ?? SUITES[0];

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);

    try {
      const client = new ModelClient();
      // Reuse an already-loaded model when one is available in this browser.
      const engines =
        model.status === 'ready' ? createBrowserEngines(client) : createRulesOnlyEngines();

      const results: { engine: string; run: EvaluationRun }[] = [];
      results.push({ engine: 'rules', run: await runEvaluation(engines.rules, suite.scenarios) });
      if (engines.model) {
        results.push({ engine: 'model', run: await runEvaluation(engines.model, suite.scenarios) });
        results.push({
          engine: 'ensemble',
          run: await runEvaluation(engines.ensemble!, suite.scenarios),
        });
      }

      setRuns(results);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setRuns([]);
    } finally {
      setRunning(false);
    }
  }, [suite, model.status]);

  return (
    <div className="stack">
      <Notice tone="neutral">
        <strong>Every number below is computed from a live run.</strong> Nothing is hard-coded. The
        same runner backs this page and <code className="mono">npm run evaluate</code>, so the
        browser and the command line produce the same metrics.
      </Notice>

      <Card
        title="Run the suite"
        subtitle={`${suite.scenarios.length} labeled synthetic scenarios.`}
        actions={
          <div className="row">
            <div className="tabs" role="tablist" aria-label="Evaluation suite">
              {SUITES.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  className="tab"
                  aria-selected={suiteId === entry.id}
                  onClick={() => setSuiteId(entry.id)}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={running}
              onClick={() => void run()}
            >
              {running ? <LoaderCircle className="spin" /> : <Play />}
              {running ? 'Running…' : 'Run evaluation'}
            </button>
          </div>
        }
      >
        <div className="stack stack-sm">
          <p className="prose">
            The <strong>tuning suite</strong> contains the scenarios used to choose the decision
            threshold, the similarity temperature and the label prototypes. Its numbers are
            optimistic by construction. The <strong>held-out validation suite</strong> was written
            after the architecture was fixed and never used for tuning, so it is the honest
            generalization signal.
          </p>
          {model.status !== 'ready' && (
            <Notice tone="warn">
              The embedding model is not loaded in this browser, so only the deterministic rules
              engine can be measured here. Load the model from the dashboard to compare all three
              engines. The command-line runner always has the model available.
            </Notice>
          )}
          {error && (
            <Notice tone="danger">
              <strong>The evaluation could not complete.</strong> {error}
            </Notice>
          )}
        </div>
      </Card>

      {runs.length === 0 && !running ? (
        <Card>
          <EmptyState icon={<FlaskConical />} title="No evaluation has been run in this session">
            Run the suite to compute accuracy, per-class precision and recall, macro F1, coverage,
            abstention rate, fallback rate and the latency distribution.
          </EmptyState>
        </Card>
      ) : (
        runs.map(({ engine, run: evaluation }) => {
          const metrics = evaluation.metrics;
          const wrong = evaluation.records.filter(
            (record) => !record.failed && !record.abstained && record.expected !== record.predicted,
          );
          const committed = Math.round(metrics.coverage * metrics.total);

          return (
            <Card
              key={engine}
              title={`${engine}`}
              subtitle={`${evaluation.durationMs} ms wall clock for ${metrics.total} scenarios`}
              actions={
                wrong.length === 0 ? (
                  <span className="pill pill-routine">0 incorrect recommendations</span>
                ) : (
                  <span className="pill pill-danger">
                    {wrong.length} incorrect recommendation{wrong.length === 1 ? '' : 's'}
                  </span>
                )
              }
            >
              <div className="grid grid-4" style={{ marginBottom: 18 }}>
                <Stat
                  label="Selective accuracy"
                  value={`${(metrics.selectiveAccuracy * 100).toFixed(1)}%`}
                  note={`${committed} of ${metrics.total} committed`}
                  tone="accent"
                />
                <Stat
                  label="Macro F1"
                  value={metrics.macroF1.toFixed(4)}
                  note="Mean of the per-class F1 scores"
                />
                <Stat
                  label="Coverage"
                  value={`${(metrics.coverage * 100).toFixed(1)}%`}
                  note={`${(metrics.abstentionRate * 100).toFixed(1)}% routed to review`}
                />
                <Stat
                  label="Latency p95"
                  value={`${metrics.latency.p95} ms`}
                  note={`median ${metrics.latency.median} ms · max ${metrics.latency.max} ms`}
                />
              </div>

              <div className="grid grid-2">
                <div>
                  <p className="stat-label" style={{ marginBottom: 8 }}>
                    Per-class metrics
                  </p>
                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr>
                          <th>Class</th>
                          <th className="num">Support</th>
                          <th className="num">Precision</th>
                          <th className="num">Recall</th>
                          <th className="num">F1</th>
                        </tr>
                      </thead>
                      <tbody>
                        {metrics.perClass.map((entry) => (
                          <tr key={entry.label}>
                            <td>
                              <LabelPill label={entry.label} />
                            </td>
                            <td className="num">{entry.support}</td>
                            <td className="num">{entry.precision.toFixed(3)}</td>
                            <td className="num">{entry.recall.toFixed(3)}</td>
                            <td className="num">{entry.f1.toFixed(3)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div>
                  <p className="stat-label" style={{ marginBottom: 8 }}>
                    Confusion matrix
                  </p>
                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr>
                          <th>Expected \ Predicted</th>
                          {metrics.perClass.map((entry) => (
                            <th key={entry.label} className="num">
                              {entry.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {metrics.perClass.map((expected) => (
                          <tr key={expected.label}>
                            <td>
                              <strong>{expected.label}</strong>
                            </td>
                            {metrics.perClass.map((predicted) => {
                              const cell = metrics.confusionMatrix.find(
                                (entry) =>
                                  entry.expected === expected.label &&
                                  entry.predicted === predicted.label,
                              );
                              return (
                                <td key={predicted.label} className="num">
                                  {cell?.count ?? 0}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="stat-note" style={{ marginTop: 6 }}>
                    Abstentions are excluded from the matrix and counted as missed opportunities
                    against the expected class.
                  </p>
                </div>
              </div>

              <div className="table-wrap" style={{ marginTop: 18 }}>
                <table className="data">
                  <thead>
                    <tr>
                      <th>Scenario</th>
                      <th>Category</th>
                      <th>Expected</th>
                      <th>Predicted</th>
                      <th className="num">Confidence</th>
                      <th>Outcome</th>
                    </tr>
                  </thead>
                  <tbody>
                    {evaluation.records.map((record) => (
                      <tr key={record.scenarioId}>
                        <td className="mono">{record.scenarioId}</td>
                        <td>{record.category}</td>
                        <td>
                          <LabelPill label={record.expected} />
                        </td>
                        <td>
                          {record.abstained ? (
                            <span className="pill pill-neutral">manual review</span>
                          ) : (
                            <LabelPill label={record.predicted} />
                          )}
                        </td>
                        <td className="num">{record.confidence.toFixed(3)}</td>
                        <td>
                          {record.failed ? (
                            <span className="pill pill-danger">failed</span>
                          ) : record.abstained ? (
                            <span className="pill pill-warn">abstained</span>
                          ) : record.expected === record.predicted ? (
                            <span className="pill pill-routine">correct</span>
                          ) : (
                            <span className="pill pill-danger">wrong</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {evaluation.failures.length > 0 && (
                <div style={{ marginTop: 18 }}>
                  <p className="stat-label" style={{ marginBottom: 8 }}>
                    Failure analysis ({evaluation.failures.length})
                  </p>
                  <div className="stack stack-sm">
                    {evaluation.failures.map((failure) => (
                      <div key={failure.scenarioId} className="notice notice-warn">
                        <TriangleAlert aria-hidden="true" />
                        <div style={{ minWidth: 0 }}>
                          <p style={{ fontWeight: 650 }}>
                            <span className="mono">{failure.scenarioId}</span> — expected{' '}
                            {failure.expected}, got {failure.predicted} (confidence{' '}
                            {failure.confidence.toFixed(3)})
                          </p>
                          <p style={{ marginTop: 3 }}>{failure.note}</p>
                          <p className="stat-note" style={{ marginTop: 5 }}>
                            <strong>Error category:</strong> {failure.errorCategory} ·{' '}
                            <strong>Mode:</strong> {failure.failureMode}
                          </p>
                          <p className="stat-note" style={{ marginTop: 3 }}>
                            <strong>Suggested response:</strong> {failure.response}
                          </p>
                          <details style={{ marginTop: 6 }}>
                            <summary style={{ cursor: 'pointer', fontSize: 12 }}>
                              Score breakdown
                            </summary>
                            <div style={{ marginTop: 6 }}>
                              {failure.scores.map((score) => (
                                <span
                                  key={score.label}
                                  className="pill pill-neutral mono"
                                  style={{ marginRight: 5 }}
                                >
                                  {score.label} {score.score.toFixed(3)}
                                </span>
                              ))}
                            </div>
                          </details>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          );
        })
      )}

      <Card title="Reproduce from the command line">
        <pre className="code">
          npm run evaluate npm run evaluate -- --engine=ensemble npm run evaluate --
          --suite=validation --json
        </pre>
        <p className="prose" style={{ marginTop: 10 }}>
          The command writes <span className="mono">reports/evaluation.json</span> containing every
          metric, every per-scenario record and the failure analysis for both suites.
        </p>
      </Card>
    </div>
  );
}
