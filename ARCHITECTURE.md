# Architecture

> **DEMO · SYNTHETIC DATA · NOT FOR CLINICAL USE**

This document describes what is **actually implemented** in this repository, layer by layer, with the
data contracts between them. Proposed production changes are called out explicitly and are not
implemented.

---

## Contents

- [Design principles](#design-principles)
- [System overview](#system-overview)
- [Layer map](#layer-map)
- [FHIR layer](#fhir-layer)
- [AI layer](#ai-layer)
- [Evaluation layer](#evaluation-layer)
- [Workflow layer](#workflow-layer)
- [Observability layer](#observability-layer)
- [Audit layer](#audit-layer)
- [UI layer](#ui-layer)
- [State model](#state-model)
- [Data contracts](#data-contracts)
- [Storage](#storage)
- [Extension points](#extension-points)
- [Production architecture (not implemented)](#production-architecture-not-implemented)

---

## Design principles

1. **The human is the decision point.** The system produces proposals, never actions. This is
   enforced by the state machine, not by UI convention.
2. **Deterministic and learned components stay separate.** The rules engine is never described as
   AI, and the model is never described as rules.
3. **Measured, not asserted.** Every number in the UI and docs comes from a computed run.
4. **One code path for scoring.** The browser and the Node evaluation runner share the scoring
   pipeline, so they cannot drift.
5. **Fail closed.** Low confidence, malformed data, disagreement and out-of-domain input all route
   to manual review. The safe path is always the slow path.
6. **Nothing leaves the browser.** No resident data is transmitted anywhere.

## System overview

```
                     ┌──────────────────────────────┐
                     │ public/data/fhir-bundle.json  │
                     │ (static synthetic FHIR R4)    │
                     └──────────────┬───────────────┘
                                    │
                    ┌───────────────▼───────────────┐
                    │ fhir/parser.ts                │
                    │  → ParseResult                 │
                    └───────────────┬───────────────┘
                                    │
                    ┌───────────────▼───────────────┐
                    │ fhir/validation.ts            │
                    │  → warnings, errors, provenance│
                    └───────────────┬───────────────┘
                                    │
                    ┌───────────────▼───────────────┐
                    │ fhir/references.ts             │
                    │  → graph, resolution, timeline │
                    └───────────────┬───────────────┘
                                    │
                    ┌───────────────▼───────────────┐
                    │ Resident (normalized record)  │
                    └───────────────┬───────────────┘
                                    │
                    ┌───────────────▼───────────────┐
                    │ ai/preprocess.ts              │
                    │  → rulesText + modelText       │
                    └──────┬─────────────────┬──────┘
                           │                 │
              ┌────────────▼──────┐   ┌──────▼────────────────┐
              │ ai/rules.ts       │   │ ai/model.worker.ts    │
              │ deterministic     │   │ Transformers.js       │
              │ phrase matching   │   │ Web Worker, bge-small │
              └────────────┬──────┘   └──────┬────────────────┘
                           │                 │
                    ┌──────▼─────────────────▼──────┐
                    │ ai/ensemble.ts                │
                    │ agreement-gated fusion         │
                    └──────────────┬─────────────────┘
                                   │
                    ┌──────────────▼─────────────────┐
                    │ ai/classifier.ts               │
                    │ decideWithEnsemble + safety    │
                    └──────────────┬─────────────────┘
                                   │
                    ┌──────────────▼─────────────────┐
                    │ workflow/orchestrator.ts       │
                    │ 11 stages, approval barrier    │
                    └──────────────┬─────────────────┘
                                   │
                    ┌──────────────▼─────────────────┐
                    │ Review (human)                 │
                    └──────────────┬─────────────────┘
                                   │
                    ┌──────────────▼─────────────────┐
                    │ audit/trail.ts                 │
                    │ audit entry + FHIR Task        │
                    └────────────────────────────────┘
```

## Layer map

| Layer         | Directory                | Public surface                                                                                     | Depends on                           |
| ------------- | ------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------ |
| FHIR          | `src/lib/fhir/`          | `parseBundle`, `validateBundle`, `buildResourceGraph`, `buildTimeline`                             | —                                    |
| AI            | `src/lib/ai/`            | `buildEngineInputs`, `decideWithRules`, `decideWithModel`, `decideWithEnsemble`, `runSafetyChecks` | `fhir/types`                         |
| Evaluation    | `src/lib/eval/`          | `runEvaluation`, `computeMetrics`, `analyseFailures`                                               | `ai/*`                               |
| Workflow      | `src/lib/workflow/`      | `WorkflowOrchestrator`                                                                             | `ai/*`, `fhir/types`                 |
| Observability | `src/lib/observability/` | `recordSnapshot`, `readEvents`, `summariseEvents`                                                  | `workflow/orchestrator` (types only) |
| Audit         | `src/lib/audit/`         | `recordAuditEntry`, `buildTaskArtifact`                                                            | `workflow/orchestrator` (types only) |
| UI            | `src/components/`        | `AppShell`, 11 views                                                                               | all of the above                     |

Dependencies point strictly downward. The observability and audit modules import only **types** from
the workflow layer, never its behaviour — so telemetry cannot influence the workflow it observes.

## FHIR layer

### Files

| File            | Responsibility                                                                |
| --------------- | ----------------------------------------------------------------------------- |
| `types.ts`      | FHIR R4 TypeScript types for the supported resource subset                    |
| `parser.ts`     | Bundle parsing, patient extraction, encounter/observation/document extraction |
| `validation.ts` | Resource-level and bundle-level validation, provenance detection              |
| `references.ts` | Reference extraction, resource graph, timeline construction                   |

### Resource support

| Resource            | Parsed | Notes                                                          |
| ------------------- | ------ | -------------------------------------------------------------- |
| `Patient`           | Yes    | Name, gender, birthDate, address, identifiers                  |
| `Encounter`         | Yes    | Subject resolved via `subject` **and** `participant.actor`     |
| `Observation`       | Yes    | Code, value, unit, reference range, interpretation             |
| `DocumentReference` | Yes    | Narrative text extracted from `content[].attachment` or `text` |
| `Appointment`       | Yes    | Participant actor resolved via `participant.actor`             |
| `CarePlan`          | Yes    | Activities with status                                         |
| `Task`              | Yes    | Open work items                                                |
| `Organization`      | Yes    | Directory resource — excluded from data-quality warnings       |
| `Practitioner`      | Yes    | Directory resource — excluded from data-quality warnings       |
| `Provenance`        | Yes    | Synthetic-data marker detected and surfaced                    |

### Encounter subject resolution

FHIR R4 allows an encounter's patient to be identified two ways. Real bundles predominantly use:

```json
{ "resourceType": "Encounter", "subject": { "reference": "Patient/p-1001" } }
```

but R4 also permits, and many producers emit:

```json
{
  "resourceType": "Encounter",
  "participant": [{ "actor": { "reference": "Patient/p-1001" } }]
}
```

The parser handles **both**. Supporting only `subject` was a real defect caught during dataset
generation — the encounter silently failed to attach to a resident.

### Validation

`validateBundle` produces two severity levels:

- **errors** — missing `resourceType`, missing `id`, malformed required fields. An error blocks the
  workflow before classification.
- **warnings** — unresolved references, unsupported resource types (informational), empty content.

`Organization` and `Practitioner` are recognised as directory resources. Treating them as
data-quality problems generated noise on every bundle, so they are validated but not warned on.

### Synthetic provenance

`Provenance` resources in the bundle are detected and the synthetic-data marker is reported so the
UI can display it. The generator tags every resource it emits so the marker survives regeneration.

### Reference graph

`buildResourceGraph` produces:

- `index` — `Map<"ResourceType/id", resource>`
- `inbound` — `Map<targetKey, ResourceReference[]>` — who points at this resource
- `outbound` — `Map<sourceKey, ResourceReference[]>` — what this resource points at

Each `ResourceReference` carries `reference`, `targetType`, `targetId`, `resolved`, `field`,
`display` and `from`, so the FHIR explorer can render a navigable graph without re-deriving
anything.

**The bundle self-reference.** A `Provenance` resource targets the bundle that contains it
(`Bundle/synthetic`). The bundle is not an entry in itself, so that reference cannot resolve
against the resource index. `buildResourceGraph(resources, bundleId)` takes the bundle id and
resolves it against that, which is why the generated dataset reports **0 unresolved references**
rather than one.

### Timeline

`buildTimeline(resident)` merges encounters, observations, documents, care-plan activities, tasks
and appointments into a single chronological view, keeping the originating resource so the UI can
link back to it.

## AI layer

### Preprocessing split — `ai/preprocess.ts`

The two engines receive **different views of the same text**, because they reason differently:

| Output                         | Rules engine                | Embedding model |
| ------------------------------ | --------------------------- | --------------- |
| Encoding repair                | Yes                         | Yes             |
| Formatting noise stripped      | Yes                         | Yes             |
| Abbreviations expanded         | No — keeps original wording | Yes             |
| Negated trigger phrases masked | No                          | Yes             |

The rules engine reads repaired **original** wording so it can quote exact phrases back to the
reviewer ("matched: _worsening shortness of breath_"). The model reads an **expanded, negation-masked**
view, because "chest pain ruled out" embeds close to the prototype "chest pain requiring
assessment" and would otherwise read as a positive symptom.

### Segmentation — `ai/segments.ts`

The record is split into sentences. Each label's similarity is

$$
s_{\text{label}} = \max\left(s_{\text{label}}^{\text{whole}}, \; \max_i\left(s_{\text{label}}^{\text{segment},i} - \text{MARGIN}\right)\right)
$$

with `SEGMENT_MARGIN = 0.05`.

Max-pooling lets a short, highly-relevant fragment lift its label without letting it capture the
whole record's score. The margin was swept over `0.00`–`0.20`; `0.05` maximised coverage with zero
incorrect recommendations. Without it, a single short fragment could dominate.

### Shared scoring — `ai/scoring.ts`

`scoring.ts` is the **single source of truth** for the browser worker and the Node runner:

- `cosine(a, b)`
- `buildEmbeddingBatch(texts)` — one forward pass for all prototypes
- `groupPrototypeVectors(vectors, labelOrder)` — groups vectors by label, preserving label order
- `scoreAgainstPrototypes(...)` — softmax over similarities at `SIMILARITY_TEMPERATURE = 0.05`, then max-pool within a label
- `calibrate(scores)` — maps raw scores to calibrated confidences

Consolidating this fixed a real bug: prototype vectors had been mis-indexed across labels, so every
scenario predicted `priority` with identical confidence.

### Rules engine — `ai/rules.ts`

Fully deterministic, no model, sub-millisecond.

**Negation scoping.** A negated phrase is _not_ counted as a signal when:

1. the negation is within **two words** before the phrase;
2. the negation is not separated by a contrastive connector (`and`, `but`, `however`, `yet`, `although`);
3. the clause boundary has not been crossed (comma, semicolon, colon, parenthesis end a clause);
4. for a trailing negation, the negation reaches back only **one word** — "pain not reported" is a
   denial, but "bleeding that did not stop" is not.

**Exact score sums.** Each label's score is rounded independently, leaving a residue of up to
$1.5 \times 10^{-4}$. The residue is added to the first non-zero label so the scores sum to exactly
$1$.

**Two-tier domain check.**

| Tier   | Vocabulary                                                  | Requirement                                 |
| ------ | ----------------------------------------------------------- | ------------------------------------------- |
| Strong | wound, medication, resident, audiometry, vitals, discharge… | Sufficient alone                            |
| Weak   | appointment, schedule, monitoring, follow-up…               | Requires a concrete clinical detail as well |

So "the fire drill is scheduled for Tuesday" fails the check and routes to manual review, while
"wound dressing scheduled for Tuesday" passes.

**Regex patterns.** Beyond phrase lists, the engine supports regular expressions for forms that
phrases cannot capture cleanly — "could not breathe", "work of breathing", "A&O x3", "SpO2 85%",
"facial droop", "slurring her words". Every regex resets `lastIndex` before each `exec` so a
stateful `g` flag cannot leak between records.

### Model — `ai/model.worker.ts` and `ai/model-client.ts`

- Model: `Xenova/bge-small-en-v1.5`
- Quantisation: `q8`
- Runtime: `@huggingface/transformers` in a Web Worker
- Dimensions: 384
- Download: ≈32 MB, cached by the browser after the first load

The worker owns the model and exposes `classify(text, prototypes, labelOrder)`. The client
(`model-client.ts`) is a thin promise wrapper with readiness state, cold/warm timing and metadata.
The worker never touches the DOM or `localStorage`.

### Ensemble — `ai/ensemble.ts`

Agreement-gated fusion:

```
if (model.label ≠ rules.label)  →  confidence = 0   (manual review)
if (model.confidence < T or rules.confidence < T)  →  confidence = 0   (manual review)
otherwise  →  confidence = min(0.99, model.confidence × 0.5 + rules.confidence × 0.5 + AGREEMENT_BONUS)
```

with `AGREEMENT_BONUS = 0.08` and `DECISION_THRESHOLD = 0.75`.

The averaging term is retained for the agreement case only, where both engines independently agree;
the bonus rewards corroborated evidence. It is never applied to a disagreement.

### Safety gates — `ai/classifier.ts`

`runSafetyChecks` returns eight checks. A failure forces manual review.

| Gate               | Condition for failure                                                                                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `input-present`    | Input is empty or whitespace only                                                                                                                                       |
| `content-depth`    | Fewer than `MIN_CONTENT_WORDS` (6) words                                                                                                                                |
| `domain-relevance` | `isInDomain` fails the two-tier check                                                                                                                                   |
| `fhir-validity`    | The bundle produced validation errors                                                                                                                                   |
| `label-separation` | The top label's score exceeds the runner-up by more than `0.35` _and_ the runner-up is non-trivial — an implausibly decisive split suggests a broken score distribution |
| `contradiction`    | `isContradictory` finds mutually exclusive signals                                                                                                                      |
| `clinical-scope`   | The text implies a diagnosis, treatment or prescribing request                                                                                                          |
| `engine-agreement` | The engines disagree, or one abstained                                                                                                                                  |

### Decision shape — `ai/types.ts`

`validateDecisionShape` checks that a decision has a valid label, in-range confidences, and scores
that sum to 1 within tolerance. It runs on every decision before it is surfaced.

## Evaluation layer

### Files

| File                | Responsibility                                       |
| ------------------- | ---------------------------------------------------- |
| `scenarios.ts`      | 30 tuning scenarios                                  |
| `validation.ts`     | 22 held-out validation scenarios                     |
| `runner.ts`         | Shared runner used by both the CLI and the browser   |
| `metrics.ts`        | Metric computation and failure analysis              |
| `browser-engine.ts` | Browser-side engine factories for the Evaluation Lab |

### Scenario shape

Each scenario specifies:

- `id` — stable identifier
- `text` — the resident record
- `expected` — the expected label
- `shouldAbstain` — whether the system is _supposed_ to route to manual review
- `tags` — the categories it exercises (negation, out-of-domain, contradiction, abbreviation…)

### Metric definitions

| Metric             | Definition                                                |
| ------------------ | --------------------------------------------------------- |
| Selective accuracy | Correct ÷ committed (records with a committed label)      |
| Coverage           | Committed ÷ total                                         |
| Macro F1           | Unweighted mean of per-label F1                           |
| Abstention rate    | Abstained ÷ total                                         |
| Fallback rate      | Records where the model failed and rules answered ÷ total |
| Per-class P/R/F1   | Standard, computed per label                              |

The failure analysis classifies each non-ideal outcome as `unexpected-recommendation`,
`unexpected-abstention` or `failure`, with a suggested remediation per class.

### Shared runner

`runEvaluation` is used unchanged by `scripts/run-evaluation.ts` and by the Evaluation Lab view. The
browser and the CLI therefore produce the same metrics from the same code, which is what makes the
UI numbers trustworthy.

## Workflow layer

### The eleven stages

| #   | Stage                     | What it does                                                    |
| --- | ------------------------- | --------------------------------------------------------------- |
| 1   | `load-resident`           | Resolve the resident and their source resources                 |
| 2   | `validate-fhir`           | Record validation warnings/errors; block on errors              |
| 3   | `retrieve-encounter`      | Pull encounter context                                          |
| 4   | `retrieve-observations`   | Pull and normalise structured observations                      |
| 5   | `process-document`        | Extract and clean narrative text                                |
| 6   | `classify`                | Run both engines, fuse, apply safety gates                      |
| 7   | `check-care-plan`         | Read open care-plan activities and tasks                        |
| 8   | `prepare-proposed-action` | Build the proposed administrative action                        |
| 9   | `validate-output`         | Validate the decision shape and the proposal                    |
| 10  | `await-approval`          | **Hard barrier** — the workflow cannot proceed without a review |
| 11  | `complete`                | Finalise the snapshot and write the audit entry                 |

Every stage records its **real** measured duration. The Execution view renders exactly what the
orchestrator recorded — the timeline is evidence, not decoration.

### The approval barrier

The orchestrator's `complete()` is unreachable from `await-approval` without a `ReviewDecision`
being supplied. A unit test asserts this directly:

> `a workflow cannot leave the approval gate without a review`

### Model failure fallback

If the model runner throws, the orchestrator catches it, records the failure, falls back to the
rules engine, and sets a `fallback` marker on the decision. The UI surfaces that marker — the
decision says which engine actually produced it. An early prototype silently swallowed the failure
and the UI still claimed an AI success; that is now impossible by construction.

### Snapshot

`WorkflowSnapshot` is the single object that flows between the workflow, observability and audit
layers. It carries the status, stage results, decision, proposed action, normalised input, warnings,
error and review.

## Observability layer

`src/lib/observability/recorder.ts`

- Events are written to `localStorage` under `careflow.observability.v1`
- Capped at `MAX_EVENTS = 200` (oldest dropped first)
- `snapshotToEvent` converts a workflow snapshot into a compact telemetry event
- `summariseEvents` aggregates into stage durations, engine agreement rate, fallback count, abstention count and total run count
- `clearEvents` resets the store

**Event identity.** A workflow is recorded twice: once when it stops at the approval gate, and
again after a reviewer decides. Both events describe the same workflow id and start time, so the
event id is `${workflowId}-${startedAt}-${status}-${sequence}`. The status distinguishes the two
snapshots and a monotonic counter guarantees uniqueness even when the same workflow is re-run
inside the same millisecond. Without this the list would render duplicate React keys.

Telemetry is **derived from** the workflow, never fed back into it.

## Audit layer

`src/lib/audit/trail.ts`

- Entries are appended to `localStorage` under `careflow.audit.v1`
- Each entry records the review outcome, note, final label, timestamp, reviewer, the evidence snapshot and the resulting FHIR artifact
- `buildTaskArtifact` produces a synthetic FHIR R4 `Task`:

```json
{
  "resourceType": "Task",
  "status": "requested",
  "intent": "order",
  "code": { "text": "Follow-up task for the care team" },
  "for": { "reference": "Patient/p-1001" },
  "extension": [
    {
      "url": "https://careflow.example.org/fhir/StructureDefinition/decision-label",
      "valueString": "follow-up"
    },
    {
      "url": "https://careflow.example.org/fhir/StructureDefinition/synthetic-data",
      "valueBoolean": true
    }
  ]
}
```

The artifact carries a `SYNTHETIC` tag so it can never be mistaken for a real task downstream.

> A `localStorage` audit trail is a demonstration of the audit **shape**, not an audit store. A real
> deployment needs an append-only, tamper-evident, server-side store.

## UI layer

### One route, eleven surfaces

The app is a single Next.js route with client-side hash navigation. A route per view would multiply
the static export and make the shared model and dataset state harder to keep consistent.

| View              | Shows                                                                |
| ----------------- | -------------------------------------------------------------------- |
| Dashboard         | Roster, aggregate counts computed from the dataset and your own runs |
| Residents         | Record, timeline, observations, care-plan work                       |
| Execution         | The eleven stages with real durations                                |
| Inspector         | Full evidence trail for the last decision                            |
| Review & approval | Approve / edit / reject, with a reason                               |
| FHIR explorer     | Original resources, references, normalized view                      |
| Evaluation lab    | Live computed metrics over both suites                               |
| Model lab         | The measured engine comparison                                       |
| Observability     | Live telemetry, resettable                                           |
| Audit trail       | Decisions, evidence, FHIR artifacts                                  |
| Architecture      | Implemented vs proposed, explicitly separated                        |

### URL scheme

| Hash                       | Opens                                      |
| -------------------------- | ------------------------------------------ |
| `#dashboard`               | The dashboard                              |
| `#fhir`                    | The FHIR explorer                          |
| `#fhir/Observation/o-1001` | The FHIR explorer on one specific resource |

The resource form exists because the Decision Inspector's evidence table must let a reviewer
**check the source of a recommendation**. Every evidence row links to the FHIR resource that
produced it, and the explorer opens with that resource selected. `targetFromHash` and
`resourceHash` in `src/lib/navigation.ts` implement the scheme, and it is covered by tests.

### Design system

`src/app/globals.css` holds the entire design system — tokens, layout primitives, components and
responsive rules — with no CSS framework dependency.

## State model

`src/lib/app-state.tsx` provides a single `AppProvider`:

| State                | Purpose                                     |
| -------------------- | ------------------------------------------- |
| `datasetStatus`      | `idle` / `loading` / `ready` / `error`      |
| `parseResult`        | Parsed bundle, validation result, residents |
| `selectedResidentId` | Current resident                            |
| `workflow`           | Latest `WorkflowSnapshot`                   |
| `review`             | Latest `ReviewDecision`                     |
| `modelStatus`        | Model readiness and metadata                |

Views read from this provider. The model client is created once and referenced through a ref, so
the Web Worker is not recreated on every render.

## Data contracts

| Contract                 | Producer                   | Consumers                                     |
| ------------------------ | -------------------------- | --------------------------------------------- |
| `ParseResult`            | `fhir/parser.ts`           | app state, FHIR explorer, workflow            |
| `DataQualityWarning`     | `fhir/validation.ts`       | workflow, inspector                           |
| `EngineInput`            | `ai/classifier.ts`         | rules engine, model client, evaluation runner |
| `ClassificationDecision` | `ai/classifier.ts`         | workflow, inspector, evaluation               |
| `ProposedAction`         | `workflow/orchestrator.ts` | approval view, audit                          |
| `WorkflowSnapshot`       | `workflow/orchestrator.ts` | observability, audit, inspector               |
| `ReviewDecision`         | approval view              | workflow, audit                               |
| `AuditEntry`             | `audit/trail.ts`           | audit view                                    |

## Storage

| Key                         | Contents                            | Lifetime                  |
| --------------------------- | ----------------------------------- | ------------------------- |
| `careflow.observability.v1` | Workflow telemetry events (max 200) | Until cleared by the user |
| `careflow.audit.v1`         | Audit entries                       | Until cleared by the user |
| Browser HTTP cache          | Model weights (≈32 MB)              | Managed by the browser    |

No cookies, no server sessions, no analytics, no third-party requests.

## Extension points

| To add…              | Extend…                                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------- |
| A workflow label     | `LABEL_DEFINITIONS` in `ai/types.ts`, the prototype list, the rules vocabulary, the evaluation scenarios |
| A FHIR resource type | `types.ts` (shape), `parser.ts` (extraction), `validation.ts` (checks)                                   |
| A safety gate        | `runSafetyChecks` in `ai/classifier.ts`                                                                  |
| A workflow stage     | `WORKFLOW_STAGES` and the orchestrator's `runStage` dispatch                                             |
| A UI surface         | `VIEW_IDS`, `VIEW_TITLES` in `navigation.ts`, a view component, a `ViewRouter` case                      |
| A metric             | `src/lib/eval/metrics.ts` — computed, never hard-coded                                                   |

## Production architecture (not implemented)

The following would be required for a real deployment and **none of it exists in this repository**:

- an API server with authentication, per-reviewer identity and RBAC
- server-side FHIR ingestion with pagination, rate limiting and provenance capture
- a tamper-evident, append-only audit store with retention policy
- temporal modelling of observations to detect deterioration from deltas
- clinician-led annotation of a much larger labelled corpus, with inter-rater agreement
- prospective shadow deployment with monitoring for drift and subgroup performance
- regulatory classification, a quality management system and post-market surveillance
- security controls: CSP, dependency scanning, secret management, penetration testing

See [SAFETY.md](SAFETY.md) for the control catalogue and the regulatory gap analysis.
