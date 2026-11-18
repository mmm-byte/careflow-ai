'use client';

import {
  ArrowRight,
  Boxes,
  BrainCircuit,
  ClipboardCheck,
  Cloud,
  Database,
  GitBranch,
  Lock,
  Server,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';

import { Card, Notice } from '@/components/ui.tsx';

function FlowRow({ from, to, note }: { from: string; to: string; note?: string }) {
  return (
    <div
      className="row"
      style={{
        gap: 10,
        padding: '10px 0',
        borderBottom: '1px solid var(--line)',
        alignItems: 'flex-start',
      }}
    >
      <span style={{ fontWeight: 650, fontSize: 13, minWidth: 150 }}>{from}</span>
      <ArrowRight
        size={15}
        aria-hidden="true"
        style={{ color: 'var(--ink-subtle)', marginTop: 3 }}
      />
      <span style={{ fontSize: 13, minWidth: 150 }}>{to}</span>
      {note && (
        <span className="stat-note" style={{ flex: 1 }}>
          {note}
        </span>
      )}
    </div>
  );
}

export function ArchitectureView() {
  return (
    <div className="stack">
      <Notice tone="warn">
        <strong>Implemented versus proposed.</strong> The first section describes only what exists
        in this repository today. The second describes how a production deployment could be built.
        Nothing in the second section has been implemented, and no infrastructure has been
        provisioned.
      </Notice>

      <Card
        title="Implemented portfolio architecture"
        subtitle="Everything described here runs in this repository."
      >
        <div className="stack">
          <div>
            <p className="stat-label" style={{ marginBottom: 8 }}>
              Component architecture
            </p>
            <div className="grid grid-3">
              {[
                {
                  icon: <Boxes />,
                  name: 'FHIR layer',
                  body: 'Typed R4 adapters, structural validation, reference resolution, timeline construction and normalized domain models. The original resources are always preserved.',
                },
                {
                  icon: <BrainCircuit />,
                  name: 'AI layer',
                  body: 'Transformers.js in a Web Worker, a deterministic rules engine, a shared scoring pipeline and a typed decision schema with runtime validation.',
                },
                {
                  icon: <GitBranch />,
                  name: 'Orchestration',
                  body: 'An eleven-stage state machine that records the real duration of every operation and always stops at a human approval gate.',
                },
                {
                  icon: <Database />,
                  name: 'Evaluation',
                  body: 'Thirty tuning and twenty-two held-out labeled scenarios, a metrics engine covering precision, recall, F1, coverage and latency, and a failure-analysis model.',
                },
                {
                  icon: <ShieldCheck />,
                  name: 'Safety',
                  body: 'Content-depth, in-domain, FHIR-validity, label-separation, contradiction, clinical-scope and engine-agreement gates that can each force a manual review.',
                },
                {
                  icon: <ClipboardCheck />,
                  name: 'Audit',
                  body: 'Approve, edit or reject with a required reason, recorded with the evidence, model metadata and a synthetic FHIR Task demonstration artifact.',
                },
              ].map((component) => (
                <div className="notice" key={component.name} style={{ alignItems: 'flex-start' }}>
                  {component.icon}
                  <div>
                    <p style={{ fontWeight: 700, fontSize: 13 }}>{component.name}</p>
                    <p className="prose" style={{ marginTop: 3 }}>
                      {component.body}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="stat-label" style={{ marginBottom: 4 }}>
              Data flow
            </p>
            <FlowRow
              from="Synthetic bundle"
              to="FHIR parser"
              note="Resources are parsed verbatim; normalization produces a separate view."
            />
            <FlowRow
              from="FHIR parser"
              to="Normalizer"
              note="Encounters, observations, documents and tasks become one prefixed text blob."
            />
            <FlowRow
              from="Normalizer"
              to="Preprocessing"
              note="Encoding repair, noise stripping, abbreviation expansion and negation masking."
            />
            <FlowRow
              from="Preprocessing"
              to="Two engines"
              note="The embedding model embeds the text; the rules engine matches the wording."
            />
            <FlowRow
              from="Two engines"
              to="Agreement gate"
              note="Both must select the same label, otherwise the record routes to a human."
            />
            <FlowRow
              from="Agreement gate"
              to="Approval"
              note="A reviewer approves, edits or rejects, with a required reason."
            />
            <FlowRow
              from="Approval"
              to="Audit + telemetry"
              note="The decision and the stage timings are recorded in local storage."
            />
          </div>

          <div>
            <p className="stat-label" style={{ marginBottom: 4 }}>
              Model flow
            </p>
            <FlowRow
              from="Record text"
              to="Segments"
              note="Sentences are scored independently so an acute statement is not averaged away."
            />
            <FlowRow
              from="Segments + prototypes"
              to="Embedding"
              note="384-dimensional vectors from bge-small-en-v1.5, quantized to int8."
            />
            <FlowRow
              from="Embeddings"
              to="Max pooling"
              note="Best segment and prototype match, with a margin so a fragment cannot dominate."
            />
            <FlowRow
              from="Similarities"
              to="Softmax"
              note={`Temperature ${0.05} converts the narrow similarity band into a usable distribution.`}
            />
            <FlowRow
              from="Distribution"
              to="Confidence"
              note="Winning mass and margin are combined, then compared against the 0.75 threshold."
            />
          </div>

          <div className="grid grid-2">
            <div>
              <p className="stat-label" style={{ marginBottom: 8 }}>
                Trust boundaries
              </p>
              <div className="stack stack-sm">
                <div className="notice">
                  <Lock aria-hidden="true" />
                  <div>
                    <p style={{ fontWeight: 650, fontSize: 13 }}>Browser boundary</p>
                    <p className="prose">
                      All resident data stays in the browser. The only outbound request is for the
                      model weights, and it happens before any record is processed.
                    </p>
                  </div>
                </div>
                <div className="notice">
                  <Lock aria-hidden="true" />
                  <div>
                    <p style={{ fontWeight: 650, fontSize: 13 }}>Model boundary</p>
                    <p className="prose">
                      The embedding model produces a similarity. It never produces a clinical
                      judgement, and the rules engine is never described as AI.
                    </p>
                  </div>
                </div>
                <div className="notice">
                  <UserCheck aria-hidden="true" />
                  <div>
                    <p style={{ fontWeight: 650, fontSize: 13 }}>Human-approval boundary</p>
                    <p className="prose">
                      Nothing consequential happens without a reviewer. The orchestrator can reach a
                      proposal, never an action.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <p className="stat-label" style={{ marginBottom: 8 }}>
                Failure paths
              </p>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Failure</th>
                      <th>Behaviour</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Model download fails</td>
                      <td>
                        Explicit error state; the rules engine answers and the result is labelled as
                        a fallback.
                      </td>
                    </tr>
                    <tr>
                      <td>Worker crashes</td>
                      <td>
                        Pending requests are rejected, the model state becomes error, the workflow
                        continues.
                      </td>
                    </tr>
                    <tr>
                      <td>Engines disagree</td>
                      <td>Fused confidence is zero; the record routes to manual review.</td>
                    </tr>
                    <tr>
                      <td>Malformed JSON</td>
                      <td>
                        Parsing returns an error; the dataset view shows the failure instead of
                        empty data.
                      </td>
                    </tr>
                    <tr>
                      <td>Empty bundle</td>
                      <td>Zero residents, a validation warning, and a meaningful empty state.</td>
                    </tr>
                    <tr>
                      <td>Unresolved reference</td>
                      <td>
                        Reported as a warning and shown in the FHIR explorer; never silently
                        dropped.
                      </td>
                    </tr>
                    <tr>
                      <td>Thin or out-of-domain text</td>
                      <td>Content-depth and in-domain gates fail, forcing manual review.</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="grid grid-2">
            <div>
              <p className="stat-label" style={{ marginBottom: 8 }}>
                Privacy considerations
              </p>
              <ul className="prose" style={{ paddingLeft: 18, margin: 0 }}>
                <li>Every record in the repository is synthetic and tagged as such.</li>
                <li>
                  No resident data is transmitted. Inference runs in a Web Worker in the browser.
                </li>
                <li>
                  Telemetry and audit entries live in localStorage and can be cleared at any time.
                </li>
                <li>
                  The model weights are fetched from a public CDN, which is a supply-chain surface
                  worth pinning in production.
                </li>
                <li>
                  This is a privacy-conscious demonstration, not a HIPAA-compliant system. A real
                  deployment would need a BAA, access controls, encryption, audit retention,
                  incident procedures and workforce training.
                </li>
              </ul>
            </div>

            <div>
              <p className="stat-label" style={{ marginBottom: 8 }}>
                Scaling and cost considerations
              </p>
              <ul className="prose" style={{ paddingLeft: 18, margin: 0 }}>
                <li>
                  Browser inference moves the marginal cost of a classification to the client, so
                  serving more residents adds no inference cost to the application tier.
                </li>
                <li>
                  The 32 MB model download is the main first-visit cost. It is cached, so the cost
                  is paid once per browser.
                </li>
                <li>
                  The evaluation runner is the heaviest developer task: it loads the model once and
                  runs every scenario in a single process.
                </li>
                <li>
                  A production version would probably move evaluation to a scheduled pipeline rather
                  than run it in a user browser.
                </li>
              </ul>
            </div>
          </div>

          <div>
            <p className="stat-label" style={{ marginBottom: 8 }}>
              Known limitations of the implementation
            </p>
            <ul className="prose" style={{ paddingLeft: 18, margin: 0 }}>
              <li>
                The evaluation suite is hand-written and small. It measures behaviour on synthetic
                scenarios, not performance on real care records.
              </li>
              <li>
                The label prototypes and the rules vocabulary were written by the same author, so
                the rules engine is advantaged on the tuning suite. The held-out suite exists partly
                to limit that effect, and the numbers from both are reported separately.
              </li>
              <li>The rules vocabulary is English-only and specific to one care setting.</li>
              <li>
                There is no multi-tenant model. The synthetic bundle is a single shared dataset.
              </li>
              <li>
                The audit trail is append-only in local storage, so it is not tamper-evident. A
                production system would write to an immutable store.
              </li>
            </ul>
          </div>
        </div>
      </Card>

      <Card
        title="Proposed production architecture"
        subtitle="A design sketch for a real deployment. Nothing here has been implemented."
      >
        <div className="stack">
          <Notice tone="warn">
            The following describes how the system <em>could</em> be deployed on Azure. No Azure
            resources have been provisioned, no identities have been created and no cost has been
            incurred. It is included to show production awareness, not to imply an existing system.
          </Notice>

          <div>
            <p className="stat-label" style={{ marginBottom: 4 }}>
              Proposed component architecture
            </p>
            <FlowRow
              from="Clinical source"
              to="FHIR gateway"
              note="An API Management or FHIR server front door with schema validation."
            />
            <FlowRow
              from="FHIR gateway"
              to="Azure Health Data Services"
              note="Could hold the FHIR data, with patient identifiers pseudonymised."
            />
            <FlowRow
              from="Gateway"
              to="Container Apps / AKS"
              note="The workflow service, stateless and horizontally scalable."
            />
            <FlowRow
              from="Workflow service"
              to="Azure AI Search"
              note="Retrieval over care-plan documents and observations."
            />
            <FlowRow
              from="Workflow service"
              to="Azure OpenAI or an approved model"
              note="Only if a larger model is genuinely required, and with a documented data boundary."
            />
            <FlowRow
              from="Workflow service"
              to="Azure Cosmos DB or PostgreSQL"
              note="Audit events, written append-only, with a retention policy."
            />
            <FlowRow
              from="Workflow service"
              to="Application Insights"
              note="Metrics, traces and structured logs with PHI scrubbing."
            />
            <FlowRow
              from="Clinical staff"
              to="Microsoft Entra ID"
              note="Identity, conditional access and role-based authorisation."
            />
            <FlowRow
              from="Microsoft Entra ID"
              to="Key Vault"
              note="Managed secrets, rotation and no credentials in source control."
            />
          </div>

          <div className="grid grid-2">
            <div>
              <p className="stat-label" style={{ marginBottom: 8 }}>
                Proposed trust boundaries
              </p>
              <div className="stack stack-sm">
                <div className="notice">
                  <Server aria-hidden="true" />
                  <div>
                    <p style={{ fontWeight: 650, fontSize: 13 }}>Clinical data boundary</p>
                    <p className="prose">
                      A private network segment holding pseudonymised FHIR data, reachable only by
                      the workflow service through managed identity.
                    </p>
                  </div>
                </div>
                <div className="notice">
                  <BrainCircuit aria-hidden="true" />
                  <div>
                    <p style={{ fontWeight: 650, fontSize: 13 }}>Model boundary</p>
                    <p className="prose">
                      If inference moves server-side, only the minimum necessary text would leave
                      the clinical boundary, and every call would be logged.
                    </p>
                  </div>
                </div>
                <div className="notice">
                  <UserCheck aria-hidden="true" />
                  <div>
                    <p style={{ fontWeight: 650, fontSize: 13 }}>Clinical approval boundary</p>
                    <p className="prose">
                      A role-gated workflow where only named clinicians can approve, with the
                      decision written to an immutable store.
                    </p>
                  </div>
                </div>
                <div className="notice">
                  <Cloud aria-hidden="true" />
                  <div>
                    <p style={{ fontWeight: 650, fontSize: 13 }}>Audit boundary</p>
                    <p className="prose">
                      Audit records would be written to append-only storage with a defined retention
                      period, separate from the operational data.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <p className="stat-label" style={{ marginBottom: 8 }}>
                Proposed operational controls
              </p>
              <ul className="prose" style={{ paddingLeft: 18, margin: 0 }}>
                <li>Microsoft Entra ID with role-based authorisation for every review action.</li>
                <li>Key Vault for secrets; managed identity instead of stored credentials.</li>
                <li>Private endpoints and network rules around the clinical data tier.</li>
                <li>Encryption in transit and at rest, with key rotation.</li>
                <li>Structured logging with PHI scrubbing before anything is exported.</li>
                <li>Continuous evaluation in CI against the regression suite.</li>
                <li>A documented model change process with re-evaluation before promotion.</li>
                <li>Incident response and rollback procedures for both code and models.</li>
              </ul>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
