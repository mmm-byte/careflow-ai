# Safety

> **DEMO · SYNTHETIC DATA · NOT FOR CLINICAL USE**
>
> This document is a **demonstration safety case**. It describes the controls implemented in this
> repository and, separately and explicitly, the controls that a real deployment would need and that
> **do not exist here**.

---

## Contents

- [Safety principles](#safety-principles)
- [Implemented controls](#implemented-controls)
- [Prohibited capabilities](#prohibited-capabilities)
- [Data protection](#data-protection)
- [Human oversight](#human-oversight)
- [Failure modes](#failure-modes)
- [Output validation](#output-validation)
- [Regulatory status](#regulatory-status)
- [Gap analysis](#gap-analysis)
- [Production safety requirements](#production-safety-requirements)
- [Incident response](#incident-response)
- [Known safety limitations](#known-safety-limitations)

---

## Safety principles

1. **Fail closed.** Uncertainty routes to a human, never to an automated action.
2. **The system proposes; the human disposes.** No automated action exists in the codebase.
3. **Never claim clinical capability.** The labels are operational, not clinical.
4. **Make the safe path visible.** Every abstention, fallback and gate failure is surfaced in the UI,
   not hidden.
5. **Never let a fallback masquerade as the primary path.** The original prototype silently fell
   back to rules while the UI claimed an AI success. That is now structurally impossible.
6. **State the limits.** The evaluation corpus is small and synthetic, and every document that
   quotes a metric says so.

## Implemented controls

### C1 — Synthetic data only

| Control          | Implementation                                                                         |
| ---------------- | -------------------------------------------------------------------------------------- |
| Source           | `scripts/generate-dataset.ts` — every resource is generated                            |
| Provenance       | `Provenance` resources carry the synthetic marker; detected and surfaced by the parser |
| Third-party data | None. No real patient data was used, seen or approximated                              |
| Licence          | No dataset licence obligations                                                         |

### C2 — Persistent synthetic-data banner

| Control   | Implementation                                         |
| --------- | ------------------------------------------------------ |
| Placement | A fixed banner in the app shell, visible on every view |
| Metadata  | `robots: noindex, nofollow` in the layout metadata     |
| Copy      | "DEMO · SYNTHETIC DATA · NOT FOR CLINICAL USE"         |

### C3 — Human approval barrier

| Control     | Implementation                                                        |
| ----------- | --------------------------------------------------------------------- |
| Mechanism   | A hard stage in the state machine — `await-approval`                  |
| Enforcement | The orchestrator cannot reach `complete()` without a `ReviewDecision` |
| Test        | `a workflow cannot leave the approval gate without a review`          |
| Options     | Approve / edit / reject, each requiring a recorded reason             |

### C4 — Output validation

| Control                 | Implementation                                                |
| ----------------------- | ------------------------------------------------------------- |
| `validateDecisionShape` | Label validity, confidence bounds, score sum within tolerance |
| Gate count              | Eight independent safety gates                                |
| Gate behaviour          | Any failure forces manual review; gates never silently pass   |

### C5 — No clinical actions

| Control               | Implementation                                                                |
| --------------------- | ----------------------------------------------------------------------------- |
| Vocabulary            | The three labels are operational: `priority`, `follow-up`, `routine`          |
| Proposed action       | Administrative only — route to a clinician, create a task, or do nothing      |
| `clinical-scope` gate | Text implying diagnosis, treatment or prescribing is rejected                 |
| No prescribing        | No medication name, dose, route or frequency appears anywhere in the codebase |

### C6 — Explicit fallback labelling

| Control   | Implementation                                               |
| --------- | ------------------------------------------------------------ |
| Mechanism | The decision records which engine produced it                |
| UI        | The fallback marker is shown wherever the decision appears   |
| Telemetry | Fallback rate is a computed metric, not a log line           |
| Test      | `a failing model falls back to the rules engine and says so` |

### C7 — Browser-only inference

| Control          | Implementation                                                 |
| ---------------- | -------------------------------------------------------------- |
| Inference        | Web Worker in the user's browser                               |
| Data egress      | No resident data is transmitted to any server                  |
| Network requests | Model weights only (one-time, cached)                          |
| Analytics        | None. No cookies, no telemetry service, no third-party scripts |

### C8 — Audit trail

| Control    | Implementation                                                               |
| ---------- | ---------------------------------------------------------------------------- |
| Storage    | `localStorage`, key `careflow.audit.v1`                                      |
| Contents   | Decision, reviewer, timestamp, reason, full evidence snapshot, FHIR artifact |
| Artifact   | A synthetic FHIR R4 `Task` tagged `SYNTHETIC`                                |
| Resettable | Yes, from the UI                                                             |

### C9 — Local-only observability

| Control    | Implementation                                                        |
| ---------- | --------------------------------------------------------------------- |
| Storage    | `localStorage`, key `careflow.observability.v1`, capped at 200 events |
| Contents   | Stage durations, engine agreement, fallback and abstention counts     |
| Resettable | Yes, from the UI                                                      |

### C10 — Out-of-domain rejection

| Control     | Implementation                                   |
| ----------- | ------------------------------------------------ |
| Mechanism   | Two-tier care-context vocabulary check           |
| Strong tier | Sufficient alone                                 |
| Weak tier   | Requires a concrete clinical detail as well      |
| Effect      | Administrative-only text routes to manual review |

## Prohibited capabilities

This system has **no** capability to:

- diagnose a condition
- suggest a diagnosis or differential
- recommend, select, alter or discontinue medication
- suggest a dose, route or frequency
- recommend a treatment or clinical procedure
- determine a clinical urgency level
- take an action in any clinical system
- transmit resident data to a server
- act without a human reviewer

These are absent by construction, not by policy. There is no code path that writes to an external
system, because there is no external system and no server.

## Data protection

### Data flow

```
  public/data/fhir-bundle.json      ← static asset, synthetic
            │
            ▼
      browser memory
            │
     ┌──────┴──────┐
     ▼             ▼
 rules engine   Web Worker model      ← both local
     └──────┬──────┘
            ▼
       localStorage                  ← synthetic only, resettable
```

**Nothing leaves the device except the model weights, once.**

### Data inventory

| Data                  | Where it lives                 | Lifetime                |
| --------------------- | ------------------------------ | ----------------------- |
| Synthetic FHIR bundle | `public/data/fhir-bundle.json` | Static, committed       |
| Resident records      | Browser memory                 | Page lifetime           |
| Observability events  | `localStorage`                 | Until reset by the user |
| Audit entries         | `localStorage`                 | Until reset by the user |
| Model weights         | Browser HTTP cache             | Browser-managed         |

### Regulatory claims

**No HIPAA, GDPR, HIPAA-HITECH, GDPR Article 9, or any other regulatory compliance is claimed.**
No BAAs are in place, no data-processing agreements exist, and no compliance audit has been
performed. The system processes synthetic data only, so the question of protected-data handling
does not arise — but a real deployment would need all of it.

## Human oversight

### The barrier

The orchestrator is a linear state machine with an explicit barrier:

```
... → validate-output → await-approval → complete
                              │
                     ┌────────┴────────┐
                     ▼                 ▼
                  approved          rejected
```

`await-approval` is not a UI convention. The orchestrator's transition into `complete` requires a
`ReviewDecision` argument. Calling `complete()` without one is impossible by the type signature.

### Review options

| Outcome    | Effect                                            |
| ---------- | ------------------------------------------------- |
| `approved` | The proposed action is accepted as-is             |
| `edited`   | The reviewer changes the label or the action text |
| `rejected` | The proposal is declined; no action results       |

Every outcome writes an audit entry containing the decision, the reviewer, the timestamp, the
reviewer's own note, and the evidence snapshot (scores, matched phrases, safety gates, model
metadata, source resource ids).

### The reviewer's information

The reviewer sees, before deciding:

- the normalized input the classifiers consumed
- each engine's label and confidence separately
- the matched phrases and regex hits from the rules engine
- the outcome of all eight safety gates
- the model identifier, quantisation, dimensions and timing
- the proposed action and its rationale
- the source FHIR resource ids the decision is grounded in

That is the minimum needed for a reviewer to judge whether the system was right, and it is the
minimum needed to make a wrong decision _legible_ in hindsight.

### What is not automated

There is no auto-approval, no escalation path that bypasses a human, no bulk-approval action, and
no mode in which the proposal is applied automatically.

## Failure modes

| Failure                       | Detection                     | Response                                                  | Verified by         |
| ----------------------------- | ----------------------------- | --------------------------------------------------------- | ------------------- |
| Model fails to load           | Client readiness check        | Rules engine answers; UI states the model was unavailable | Manual + inspection |
| Model throws during inference | Try/catch in the orchestrator | Fallback recorded, rules answer, UI names the engine      | Unit test           |
| Rules engine abstains         | Engine result                 | Ensemble pins confidence to 0 → manual review             | Unit test           |
| Engines disagree              | Ensemble comparison           | Confidence pinned to 0 → manual review                    | Unit test           |
| Low confidence                | Threshold comparison          | Manual review                                             | Unit test           |
| Empty input                   | `input-present` gate          | Manual review                                             | Unit test           |
| Too few words                 | `content-depth` gate          | Manual review                                             | Unit test           |
| Out-of-domain text            | `domain-relevance` gate       | Manual review                                             | Unit test           |
| Malformed FHIR                | Bundle validation             | Workflow blocked before classification                    | Unit test           |
| Contradictory signals         | `contradiction` gate          | Manual review                                             | Unit test           |
| Clinical-scope request        | `clinical-scope` gate         | Manual review                                             | Inspection          |
| Invalid decision shape        | `validateDecisionShape`       | Decision rejected                                         | Unit test           |
| Empty dataset                 | Load status                   | Explicit error; rest of app remains usable                | Manual              |
| Corrupt localStorage          | JSON parse guard              | Storage reset; no crash                                   | Inspection          |

### The defect this catalogue exists to prevent

The original prototype contained a silent `catch {}` around the model call. On failure it fell back
to the rules engine and returned the result as though the model had produced it — while the UI
reported "AI classification complete". A reviewer would have been shown a result with no indication
that the model path had failed.

That is a **safety defect disguised as a reliability feature**, and it is why:

- the fallback is now an explicit, typed state;
- the decision records which engine produced it;
- the fallback rate is a computed metric;
- a unit test asserts the fallback says so.

## Output validation

### Decision shape

Every decision passes `validateDecisionShape`:

| Property       | Requirement                                                 |
| -------------- | ----------------------------------------------------------- |
| Label          | Must be one of `priority`, `follow-up`, `routine`           |
| Confidences    | Within $[0, 1]$                                             |
| Score sum      | Equal to 1 within tolerance                                 |
| Rule score sum | Exactly 1 (residue distributed to the first non-zero label) |

### Proposed action

| Property         | Requirement                                                           |
| ---------------- | --------------------------------------------------------------------- |
| Label            | Must be a valid workflow label                                        |
| Source resources | Must reference resource ids present in the loaded bundle              |
| Action text      | Administrative; generated from the label definition                   |
| Ready flag       | False unless the decision passed every gate and cleared the threshold |

### FHIR artifact

The `Task` artifact is validated against the same rules that validate the input bundle, and is
tagged `SYNTHETIC` with `careflow-*` extensions carrying the decision label, confidence, workflow
id and reviewer id.

## Regulatory status

| Question                              | Answer                                                                                                                       |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Is this a medical device?             | **No.** It is a demonstration software project that is not intended for, and must not be used for, clinical decision-making. |
| Is there a regulatory clearance?      | **No.** None has been sought or granted.                                                                                     |
| Is this HIPAA compliant?              | **No claim is made.** No compliance audit, no BAA, no risk analysis.                                                         |
| Has this been clinically validated?   | **No.** The evaluation is 52 synthetic scenarios.                                                                            |
| Has this been reviewed by clinicians? | **No.** The scenarios and label definitions were written by the author.                                                      |
| Has this been risk-managed?           | **No.** This document is a demonstration safety case, not an ISO 14971 risk-management file.                                 |

## Gap analysis

### Fully implemented here

- Synthetic-only data pipeline with provenance
- Persistent non-clinical-use banner
- Human approval barrier enforced by the type system
- Eight safety gates with fail-closed behaviour
- Deterministic rules engine as a genuinely separate component
- Explicit, labelled fallback behaviour
- Browser-only inference with no data egress
- Output validation on every decision
- Audit trail with a FHIR-shaped artifact
- Reproducible evaluation with computed metrics
- Honest reporting of the evaluation's limits

### Not implemented here

| Gap                                                                           | Why it matters                                       | Severity |
| ----------------------------------------------------------------------------- | ---------------------------------------------------- | -------- |
| **Authentication and authorisation**                                          | Anyone can act as the reviewer                       | Critical |
| **Server-side, tamper-evident audit store**                                   | `localStorage` is editable and per-browser           | Critical |
| **Per-reviewer identity**                                                     | Decisions cannot be attributed                       | Critical |
| **Real clinical validation**                                                  | The safety argument is unproven                      | Critical |
| **Clinician review of labels and prototypes**                                 | One author's model of the task                       | High     |
| **Temporal reasoning**                                                        | Deterioration from deltas is undetectable            | High     |
| **Bias and subgroup analysis**                                                | Unknown fairness properties                          | High     |
| **Large, independently-labelled corpus**                                      | The evaluation cannot support a performance claim    | High     |
| **Prospective shadow deployment**                                             | Real-world agreement is unmeasured                   | High     |
| **Risk management (ISO 14971-style)**                                         | No documented hazard analysis or risk controls       | High     |
| **Regulatory classification and QMS**                                         | Required for any real clinical use                   | High     |
| **Monitoring and drift detection**                                            | Silent degradation would go unnoticed                | Medium   |
| **Security hardening** (CSP, dependency scanning, secret management, pentest) | Standard production controls                         | Medium   |
| **Incident response procedure**                                               | No process for a safety event                        | Medium   |
| **Model update governance**                                                   | No review process for changing weights or thresholds | Medium   |
| **Data retention and deletion policy**                                        | `localStorage` persists until manually cleared       | Medium   |
| **Accessibility audit**                                                       | Not formally assessed against WCAG                   | Medium   |
| **Localisation**                                                              | English only; no validation on other languages       | Low      |

## Production safety requirements

What would be required before any real-world use. **None of this is implemented.**

### Governance

1. A documented safety case following ISO 14971, with a hazard analysis and risk-control traceability matrix.
2. A quality management system (ISO 13485 or equivalent) covering design, verification and validation.
3. Regulatory classification and, where required, submission and clearance.
4. A post-market surveillance and vigilance process.
5. Documented model-update governance: any change to weights, prototypes, thresholds or vocabulary requires re-validation and a documented review.
6. Named clinical safety officers with authority to halt deployment.

### Technical

1. Authentication, RBAC and per-reviewer identity, with separation of duties.
2. An append-only, tamper-evident, server-side audit store with retention and export.
3. Real FHIR ingestion with provenance capture, pagination and rate limiting.
4. Temporal modelling to detect deterioration from deltas.
5. A large, independently-annotated corpus with inter-rater agreement reported.
6. True out-of-distribution and adversarial evaluation splits.
7. Calibration measurement (reliability diagrams, ECE) and per-label thresholds.
8. Prospective shadow deployment with pre-registered success criteria.
9. Drift monitoring on score distributions, abstention rates and coverage.
10. Subgroup performance analysis with defined fairness thresholds.
11. A kill switch that disables recommendation generation centrally.
12. Encrypted storage and transport, key management, and access logging.

### Clinical

1. Clinician-led definition and review of the label taxonomy.
2. Clinician-led annotation of the evaluation corpus with inter-rater agreement.
3. Agreement with experienced human judgement measured and reported.
4. A human-factors study of the review interface.
5. Defined escalation procedures when the system abstains.

## Incident response

Not yet implemented. The minimum required for a real deployment:

| Element           | Requirement                                                                     |
| ----------------- | ------------------------------------------------------------------------------- |
| Detection         | Monitoring for wrong-label rate, abstention rate drift and coverage collapse    |
| Triage            | A named on-call owner with authority to disable the system                      |
| Communication     | A procedure for notifying affected reviewers and, where relevant, patients      |
| Evidence          | The audit trail must be sufficient to reconstruct every decision                |
| Corrective action | A documented path from incident to validated fix                                |
| Learning          | A mandatory review for every wrong-label incident, feeding the regression suite |

## Known safety limitations

1. **The safety argument rests on 52 synthetic scenarios.** The gates are designed to fail closed,
   but their _coverage_ of the real input space is unmeasured.
2. **The label definitions were written by one author** and have not been validated against clinical
   judgement.
3. **The rules vocabulary is hand-curated and English-only.** It will miss phrasing it has not seen.
   The `domain-relevance` gate is the backstop, not a substitute.
4. **No temporal reasoning.** The system can miss deterioration, which is the failure mode with the
   highest clinical cost.
5. **No bias analysis is possible** on a synthetic corpus with no demographic variation.
6. **`localStorage` audit trails are not tamper-evident.** A user can edit them. This is a
   demonstration of the audit _shape_ only.
7. **The reviewer is a fixed synthetic identity.** There is no attribution and no separation of
   duties.
8. **The system is not resilient to a compromised client.** All controls are client-side, so a
   modified client bypasses all of them. A real deployment needs server-side enforcement of the
   approval barrier.
9. **The model weights are fetched at runtime** from a third-party CDN. A compromised CDN response
   could alter inference behaviour. Production would pin and verify artefact hashes.
10. **No availability engineering.** The system requires the CDN for its first load and degrades to
    rules-only without it, which is safe but functionally reduced.
