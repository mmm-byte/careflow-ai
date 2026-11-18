'use client';

import { useState } from 'react';
import { Activity, ChevronDown, ChevronRight, FileCode2 } from 'lucide-react';

import { useApp } from '@/lib/app-state.tsx';
import {
  Card,
  EmptyState,
  KeyValue,
  LabelPill,
  Notice,
  SafetyCheckRow,
  ScoreRow,
  StatusPill,
} from '@/components/ui.tsx';
import { LABEL_DEFINITIONS, LABEL_ORDER, type WorkflowLabel } from '@/lib/ai/types.ts';
import { findRuleHits } from '@/lib/ai/rules.ts';
import { resourceHash } from '@/lib/navigation.ts';

export function InspectorView() {
  const { workflow } = useApp();
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({ normalized: true });

  if (!workflow?.decision) {
    return (
      <Card>
        <EmptyState icon={<Activity />} title="No decision to inspect">
          Run CareFlow on a resident. The inspector then shows the exact input, every label score,
          the safety gates and the model metadata behind the decision.
        </EmptyState>
      </Card>
    );
  }

  const decision = workflow.decision;
  const rulesHits = decision.normalizedInput ? findRuleHits(decision.normalizedInput) : [];

  const toggle = (key: string) =>
    setOpenSections((current) => ({ ...current, [key]: !current[key] }));

  return (
    <div className="stack">
      <div className="grid grid-4">
        <div className="stat">
          <div className="stat-label">Outcome</div>
          <div style={{ marginTop: 8 }}>
            <LabelPill label={decision.label}>
              {decision.status === 'abstained' ? 'Routed to manual review' : 'Recommended'}
            </LabelPill>
          </div>
        </div>
        <div className="stat stat-accent">
          <div className="stat-label">Confidence</div>
          <div className="stat-value">{Math.round(decision.confidence * 100)}%</div>
          <div className="stat-note">Threshold {Math.round(decision.threshold * 100)}%</div>
        </div>
        <div className="stat">
          <div className="stat-label">Engine</div>
          <div className="stat-value" style={{ fontSize: 18 }}>
            {decision.engine}
          </div>
          <div className="stat-note">
            {decision.usedFallback ? 'Fallback to the rules engine' : 'Embedding model'}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Inference latency</div>
          <div className="stat-value">{decision.model.latencyMs} ms</div>
          <div className="stat-note">
            {decision.model.warm ? 'Warm model' : 'Cold start'}
            {decision.model.coldStartMs !== null ? ` · load ${decision.model.coldStartMs} ms` : ''}
          </div>
        </div>
      </div>

      {decision.usedFallback && (
        <Notice tone="warn">
          <strong>This decision did not come from model inference.</strong>{' '}
          {decision.modelError
            ? `The model failed (${decision.modelError}) and the deterministic rules engine answered instead.`
            : 'The rules engine answered instead of the model.'}{' '}
          The rules engine is a transparent pattern matcher, not a learned model, and the UI says so
          wherever this result appears.
        </Notice>
      )}

      <div className="grid grid-sidebar">
        <div className="stack">
          <Card title="Label scores" subtitle="Every label, with the score the engine produced.">
            {LABEL_ORDER.map((label) => {
              const score = decision.scores.find((entry) => entry.label === label);
              const selected = decision.label === label;
              return (
                <ScoreRow
                  key={label}
                  label={label}
                  score={score?.score ?? 0}
                  detail={`cosine ${(score?.similarity ?? 0).toFixed(3)}${
                    selected ? ' · selected' : ''
                  }`}
                  selected={selected}
                />
              );
            })}
            <hr className="divider" style={{ margin: '10px 0' }} />
            <p className="prose">
              Similarity is a cosine distance between the record text and a label prototype. It is
              <strong> not a clinical probability</strong>. The confidence figure above is a
              calibrated score derived from the distribution across the three labels, and it is
              still only a signal for a human reviewer.
            </p>
          </Card>

          <Card title="Model metadata">
            <KeyValue
              items={[
                { label: 'Model', value: <span className="mono">{decision.model.modelId}</span> },
                { label: 'Engine', value: decision.model.engineDetail },
                { label: 'Quantization', value: decision.model.dtype },
                { label: 'Parameters', value: decision.model.parameters },
                { label: 'Weights size', value: decision.model.modelSize },
                {
                  label: 'Dimensions',
                  value: decision.model.dimensions ?? 'not reported',
                },
                { label: 'Cold start', value: `${decision.model.coldStartMs ?? 0} ms` },
                { label: 'Warm inference', value: `${decision.model.latencyMs} ms` },
              ]}
            />
          </Card>
        </div>

        <div className="stack">
          <Card title="Rationale" subtitle="The user-facing explanation, not internal reasoning.">
            <p className="prose">{decision.rationale}</p>
            <div style={{ marginTop: 14 }}>
              <p className="stat-label" style={{ marginBottom: 6 }}>
                Label definitions
              </p>
              {LABEL_ORDER.map((label) => (
                <p key={label} className="prose" style={{ marginBottom: 6 }}>
                  <strong>{LABEL_DEFINITIONS[label].title}</strong> —{' '}
                  {LABEL_DEFINITIONS[label].description}
                </p>
              ))}
            </div>
          </Card>

          <Card title="Safety gates" bodyless>
            <div className="card-body">
              <div className="check-list">
                {decision.safetyChecks.map((check) => (
                  <SafetyCheckRow
                    key={check.id}
                    status={check.status}
                    title={check.title}
                    detail={check.detail}
                  />
                ))}
              </div>
            </div>
          </Card>

          <Card title="Retrieved evidence" subtitle="Each item resolves to a FHIR resource.">
            {decision.evidence.length === 0 ? (
              <EmptyState title="No evidence was linked">
                The record produced no attributable resources.
              </EmptyState>
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Resource</th>
                      <th>Id</th>
                      <th>Kind</th>
                      <th>Excerpt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {decision.evidence.map((item) => (
                      <tr key={`${item.resourceType}-${item.resourceId}`}>
                        <td>
                          {/* Every evidence item links to the FHIR resource that
                              supported it, so the reviewer can check the source. */}
                          <a
                            className="link"
                            href={resourceHash(item.resourceType, item.resourceId)}
                            title={`Open ${item.resourceType}/${item.resourceId} in the FHIR explorer`}
                          >
                            {item.resourceType}
                          </a>
                        </td>
                        <td className="mono">{item.resourceId}</td>
                        <td>{item.label}</td>
                        <td style={{ maxWidth: 320 }}>{item.excerpt}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card
            title="Model input"
            actions={
              <button
                type="button"
                className="btn btn-sm"
                aria-expanded={openSections.normalized ?? false}
                onClick={() => toggle('normalized')}
              >
                {openSections.normalized ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                {openSections.normalized ? 'Hide' : 'Show'} normalized text
              </button>
            }
          >
            <div className="row spread">
              <p className="stat-note">
                {decision.inputResourceIds.length} resource id(s) contributed to the input.
              </p>
            </div>
            {openSections.normalized && (
              <>
                <p className="stat-label" style={{ marginTop: 12, marginBottom: 6 }}>
                  Normalized text the classifiers read
                </p>
                <pre className="code">{decision.normalizedInput || '(empty)'}</pre>
                <p className="stat-note" style={{ marginTop: 8 }}>
                  The text is prefixed with the resource it came from, so every fragment can be
                  traced back to a FHIR resource.
                </p>
              </>
            )}
          </Card>

          {rulesHits.length > 0 && (
            <Card
              title="Deterministic rule hits"
              subtitle="The phrase-level evidence the rules engine matched, with negation marked."
              actions={
                <span className="pill pill-neutral">
                  <FileCode2 size={12} /> {rulesHits.length} hit(s)
                </span>
              }
            >
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Label</th>
                      <th>Matched phrase</th>
                      <th>Negated</th>
                      <th>Context</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rulesHits.map((hit, index) => (
                      <tr key={`${hit.label}-${hit.phrase}-${index}`}>
                        <td>
                          <LabelPill label={hit.label as WorkflowLabel} />
                        </td>
                        <td className="mono">{hit.phrase}</td>
                        <td>
                          {hit.negated ? (
                            <StatusPill tone="warn">Negated</StatusPill>
                          ) : (
                            <StatusPill tone="routine">Active</StatusPill>
                          )}
                        </td>
                        <td style={{ maxWidth: 320 }}>{hit.context}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <Card title="Human review status">
            <KeyValue
              items={[
                {
                  label: 'Status',
                  value: workflow.review
                    ? `${workflow.review.outcome} by ${workflow.review.reviewer}`
                    : 'Awaiting a human decision',
                },
                {
                  label: 'Final label',
                  value: workflow.review ? workflow.review.finalLabel : 'not yet decided',
                },
                { label: 'Reason', value: workflow.review?.note || 'not yet recorded' },
                { label: 'Decided at', value: workflow.review?.decidedAt ?? '—' },
              ]}
            />
          </Card>

          <Card title="Limitations of this decision">
            <ul className="prose" style={{ paddingLeft: 18, margin: 0 }}>
              <li>
                The label describes <strong>administrative workflow routing</strong>. It is not a
                diagnosis, a severity assessment, or a treatment recommendation.
              </li>
              <li>
                Similarity to a prototype is not a calibrated probability of patient risk, and the
                confidence figure is not comparable across clinical populations.
              </li>
              <li>
                The rules engine matches fixed phrases. It will miss a concern expressed in
                unfamiliar wording and can be fooled by a phrase used in an unusual sense.
              </li>
              <li>
                The evaluation suite is synthetic and small. It measures behaviour on hand-written
                scenarios, not performance on real care records.
              </li>
              <li>Every result requires a human decision before anything happens.</li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
