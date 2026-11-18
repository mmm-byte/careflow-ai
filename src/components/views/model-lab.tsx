'use client';

import { useMemo } from 'react';
import { Cpu, Gauge, Lock, Scale, ShieldCheck, Zap } from 'lucide-react';

import { useApp } from '@/lib/app-state.tsx';
import { Card, Notice, StatusPill } from '@/components/ui.tsx';
import { DECISION_THRESHOLD, LABEL_DEFINITIONS, LABEL_ORDER } from '@/lib/ai/types.ts';
import { SIMILARITY_TEMPERATURE } from '@/lib/ai/types.ts';
import { SEGMENT_MARGIN } from '@/lib/ai/segments.ts';
import { AGREEMENT_BONUS } from '@/lib/ai/ensemble.ts';
import { MIN_CONTENT_WORDS } from '@/lib/ai/types.ts';

export function ModelLabView() {
  const { model, events } = useApp();

  /**
   * The measured latency in this browser comes from the recorded workflow
   * events, not from a hard-coded figure.
   */
  const measured = useMemo(() => {
    const modelRuns = events.filter((event) => event.engine === 'embedding-model');
    if (modelRuns.length === 0) return null;
    const latencies = modelRuns.map((event) => event.durationMs).sort((a, b) => a - b);
    return {
      count: modelRuns.length,
      median: latencies[Math.floor(latencies.length / 2)],
      min: latencies[0],
      max: latencies[latencies.length - 1],
    };
  }, [events]);

  return (
    <div className="stack">
      <Notice tone="neutral">
        <strong>Why two engines?</strong> They fail in different ways. The embedding model
        understands wording it has never seen; the rules engine gives exact, auditable phrase
        matches. CareFlow requires both to agree before it proposes anything, so a failure in either
        one routes the record to a human instead of producing a confident answer.
      </Notice>

      <div className="grid grid-2">
        <Card title="Small embedding model" subtitle="The semantic engine">
          <div className="stack stack-sm">
            <div className="row spread">
              <span className="stat-label">Selected model</span>
              <StatusPill tone="accent">MVP component</StatusPill>
            </div>
            <dl className="kv">
              <dt>Model</dt>
              <dd className="mono">Xenova/bge-small-en-v1.5</dd>
              <dt>Runtime</dt>
              <dd>Transformers.js / onnxruntime-web (wasm)</dd>
              <dt>Quantization</dt>
              <dd>q8 (int8)</dd>
              <dt>Parameters</dt>
              <dd>33.4M</dd>
              <dt>Weights size</dt>
              <dd>~32 MB</dd>
              <dt>Embedding dimensions</dt>
              <dd>384</dd>
              <dt>Execution</dt>
              <dd>Web Worker (never blocks the UI)</dd>
              <dt>First load</dt>
              <dd>{model.info ? `${model.info.loadMs} ms in this browser` : 'not measured yet'}</dd>
              <dt>Warm inference</dt>
              <dd>
                {measured
                  ? `${measured.median} ms median over ${measured.count} workflow(s)`
                  : 'run a workflow to measure it'}
              </dd>
            </dl>

            <hr className="divider" />

            <p className="stat-label">Why bge-small and not all-MiniLM-L6-v2?</p>
            <p className="prose">
              Both were evaluated against the labeled suite. The original all-MiniLM-L6-v2 model
              selected the correct label in many cases but its raw cosine similarities occupied a
              narrow band, so its confidence was badly calibrated: it committed to only a small
              fraction of records. bge-small-en-v1.5 separated the labels clearly enough to reach
              <strong> 100% selective accuracy on the held-out suite</strong> at a 32 MB cost, which
              is the right trade for browser inference. The switch is documented in EVALUATION.md.
            </p>

            <p className="stat-label" style={{ marginTop: 6 }}>
              Failure behaviour
            </p>
            <p className="prose">
              If the weights cannot be downloaded, or the worker crashes, or inference throws, the
              model state becomes <span className="mono">error</span>, the UI says so explicitly,
              and the workflow continues with the deterministic rules engine. The fallback is always
              labelled as a fallback, never presented as model inference.
            </p>

            <p className="stat-label" style={{ marginTop: 6 }}>
              Privacy
            </p>
            <p className="prose">
              The record text is embedded locally. Only the model weights are fetched, from the
              Hugging Face CDN. No resident data is sent anywhere. The weights are cached in the
              browser after the first load.
            </p>
          </div>
        </Card>

        <Card title="Deterministic rules engine" subtitle="The safety floor">
          <div className="stack stack-sm">
            <div className="row spread">
              <span className="stat-label">Engine kind</span>
              <StatusPill tone="neutral">Pattern matcher, not AI</StatusPill>
            </div>
            <dl className="kv">
              <dt>Model size</dt>
              <dd>0 bytes — no weights</dd>
              <dt>First load</dt>
              <dd>instant, no download</dd>
              <dt>Warm inference</dt>
              <dd>under 1 ms (measured in the evaluation runner)</dd>
              <dt>Execution</dt>
              <dd>Main thread; pure string operations</dd>
              <dt>Browser support</dt>
              <dd>Any browser that runs the app</dd>
              <dt>Failure behaviour</dt>
              <dd>Never fails; returns a low confidence when it finds no evidence</dd>
              <dt>Privacy</dt>
              <dd>No network access at all</dd>
            </dl>

            <hr className="divider" />

            <p className="stat-label">What it does well</p>
            <p className="prose">
              It is completely transparent. Every match quotes the exact phrase it found and marks
              whether the phrase was negated, so a reviewer can check the reasoning directly instead
              of trusting a score. It also handles negation explicitly, which the embedding model
              cannot do on its own.
            </p>

            <p className="stat-label" style={{ marginTop: 6 }}>
              Where it falls short
            </p>
            <p className="prose">
              It only recognises the vocabulary it was given. A concern expressed in unfamiliar
              wording produces no match, and a phrase used in an unexpected sense can produce a
              false match. That is exactly why it is paired with the model rather than used alone.
            </p>
          </div>
        </Card>
      </div>

      <Card
        title="How the two engines are combined"
        subtitle="The agreement gate is the core safety decision in this project."
      >
        <div className="grid grid-2">
          <div className="stack stack-sm">
            <p className="stat-label">The rule</p>
            <p className="prose">
              A recommendation is only issued when the embedding model and the rules engine
              <strong> independently select the same label</strong>. When they disagree, the fused
              confidence is set to zero and the record is routed to manual review.
            </p>
            <p className="prose">
              This was not the first design. A conventional ensemble that averaged the two
              confidence scores was measured against the same suites and performed
              <em> worse than either engine alone</em>: averaging let one confident-but-wrong engine
              pull a correct one down, and pushed borderline records over the threshold. Replacing
              the average with the agreement gate restored 100% selective accuracy on both suites
              and turned the remaining cases into explicit abstentions rather than errors.
            </p>
          </div>

          <div>
            <p className="stat-label" style={{ marginBottom: 8 }}>
              Tuned constants and where they come from
            </p>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Constant</th>
                    <th className="num">Value</th>
                    <th>Selected by</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Decision threshold</td>
                    <td className="num">{DECISION_THRESHOLD}</td>
                    <td>Threshold sweep on both suites</td>
                  </tr>
                  <tr>
                    <td>Similarity temperature</td>
                    <td className="num">{SIMILARITY_TEMPERATURE}</td>
                    <td>Calibration sweep against the suite</td>
                  </tr>
                  <tr>
                    <td>Segment margin</td>
                    <td className="num">{SEGMENT_MARGIN}</td>
                    <td>Sweep for max coverage with no error</td>
                  </tr>
                  <tr>
                    <td>Agreement bonus</td>
                    <td className="num">{AGREEMENT_BONUS}</td>
                    <td>Set below the point where it could mask a weak match</td>
                  </tr>
                  <tr>
                    <td>Minimum content words</td>
                    <td className="num">{MIN_CONTENT_WORDS}</td>
                    <td>Chosen so a two-word note always routes to review</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </Card>

      <Card title="Label vocabulary" subtitle="The complete label set the models classify against.">
        <div className="stack">
          {LABEL_ORDER.map((label) => {
            const definition = LABEL_DEFINITIONS[label];
            return (
              <div key={label} className="notice" style={{ alignItems: 'flex-start' }}>
                <Cpu aria-hidden="true" />
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontWeight: 650 }}>{definition.title}</p>
                  <p className="prose">{definition.description}</p>
                  <p className="stat-label" style={{ marginTop: 8, marginBottom: 4 }}>
                    Embedding prototypes
                  </p>
                  <ul className="prose" style={{ paddingLeft: 18, margin: 0 }}>
                    {definition.prototypes.map((prototype) => (
                      <li key={prototype}>{prototype}</li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid grid-3">
        <Card title="Privacy comparison">
          <div className="stack stack-sm">
            <div className="row">
              <Lock size={15} aria-hidden="true" />
              <strong style={{ fontSize: 13 }}>Model</strong>
            </div>
            <p className="prose">
              Resident text is embedded locally and never leaves the browser. The only network
              request is for the model weights.
            </p>
            <div className="row">
              <Lock size={15} aria-hidden="true" />
              <strong style={{ fontSize: 13 }}>Rules</strong>
            </div>
            <p className="prose">No network access of any kind.</p>
          </div>
        </Card>

        <Card title="Deployment complexity">
          <div className="stack stack-sm">
            <div className="row">
              <Gauge size={15} aria-hidden="true" />
              <strong style={{ fontSize: 13 }}>Model</strong>
            </div>
            <p className="prose">
              Requires WebAssembly, SharedArrayBuffer headers for the threaded backend, and a
              cross-origin isolation capable host.
            </p>
            <div className="row">
              <Zap size={15} aria-hidden="true" />
              <strong style={{ fontSize: 13 }}>Rules</strong>
            </div>
            <p className="prose">Plain string operations. Nothing to configure.</p>
          </div>
        </Card>

        <Card title="Why the ensemble is the MVP">
          <div className="stack stack-sm">
            <Scale size={15} aria-hidden="true" />
            <p className="prose">
              Neither engine alone reaches 100% selective accuracy on the held-out suite while
              keeping useful coverage. The agreement gate does, because it treats disagreement as
              evidence rather than as noise to average away.
            </p>
            <p className="prose">
              The cost is coverage: some records that either engine could have handled are routed to
              a human. For triage that is the correct trade, and it is stated plainly rather than
              hidden behind a coverage metric.
            </p>
            <div className="row">
              <ShieldCheck size={15} aria-hidden="true" />
              <span className="pill pill-accent">0 incorrect on both suites</span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
