# Model Card — CareFlow AI

> **DEMO · SYNTHETIC DATA · NOT FOR CLINICAL USE**
>
> This model card describes a **demonstration system** built on synthetic data. It is not a medical
> device, it is not clinically validated, and it must not be used to inform real care.

---

## Contents

- [Model details](#model-details)
- [Intended use](#intended-use)
- [Out-of-scope use](#out-of-scope-use)
- [Architecture](#architecture)
- [Training data](#training-data)
- [Evaluation](#evaluation)
- [Ensemble design](#ensemble-design)
- [Thresholds and calibration](#thresholds-and-calibration)
- [Safety gates](#safety-gates)
- [Ethical considerations](#ethical-considerations)
- [Known limitations](#known-limitations)
- [Out-of-distribution behaviour](#out-of-distribution-behaviour)
- [Maintenance](#maintenance)

---

## Model details

| Field                | Value                                                      |
| -------------------- | ---------------------------------------------------------- |
| Model                | `Xenova/bge-small-en-v1.5`                                 |
| Runtime              | `@huggingface/transformers` (Transformers.js)              |
| Execution            | Browser Web Worker                                         |
| Quantisation         | `q8`                                                       |
| Approximate download | 32.2 MB                                                    |
| Embedding dimensions | 384                                                        |
| Base model           | `BAAI/bge-small-en-v1.5`                                   |
| Licence              | MIT (base model), MIT (this repository)                    |
| Modifications        | Quantised to `q8` for browser distribution; no fine-tuning |

The base model is a general-purpose English sentence encoder. **No weights were trained, fine-tuned
or adapted for this project.** The "model" in this system is the base encoder plus three prototype
sentences per label, a similarity scoring function and a calibration step — all of which live in
this repository and are inspectable.

## Intended use

**Use case.** Classify a synthetic senior-care resident record into one of three _operational
attention_ labels, so that a care-operations workflow can propose an administrative next step for a
human reviewer.

| Label       | Definition                                                | Proposed action                                                |
| ----------- | --------------------------------------------------------- | -------------------------------------------------------------- |
| `priority`  | A safety-relevant signal suggests prompt clinician review | Route to a clinician for priority review within the same shift |
| `follow-up` | Administrative or monitoring work is outstanding          | Create a follow-up task for the care team                      |
| `routine`   | No escalation indicated; normal cadence                   | Record no workflow action                                      |

**Intended users.** Care-operations staff in a synthetic demonstration environment.

**Intended deployment.** A static web application running entirely client-side, with a human review
step that is mandatory.

## Out-of-scope use

This system must **not** be used to:

- diagnose any condition, or suggest a diagnosis
- recommend, select, alter or discontinue medication or a dose
- suggest a treatment, intervention or clinical procedure
- determine clinical urgency in a real care setting
- influence any real clinical decision
- process any real patient data
- satisfy any regulatory requirement for a medical device

The labels describe **operational attention**, not clinical severity. `priority` means "a clinician
should look at this promptly", not "this resident is critically ill".

## Architecture

```
resident record
      │
      ▼
 preprocessing ─── encoding repair, noise stripping
      │          ─── abbreviations expanded (model only)
      │          ─── negated phrases masked (model only)
      ▼
 segmentation ───── sentence split
      │
      ▼
 embedding ───────── bge-small, q8, Web Worker
      │
      ▼
 scoring ─────────── softmax over prototype similarities (T = 0.05)
      │              max-pool across segments (margin 0.05)
      │              max-pool across prototypes per label
      ▼
 calibration ─────── calibrated confidences
      │
      ▼
 ensemble ────────── agreement-gated fusion with the deterministic rules engine
      │
      ▼
 safety gates ────── eight checks; any failure ⇒ manual review
      │
      ▼
 proposal ────────── administrative action, pending human approval
```

### Why a prototype-based classifier

Three labels with three prototype sentences each is a **nearest-neighbour** problem, not a
generative one. A sentence encoder with good semantic coverage solves it well, cheaply, and
auditably. The scoring pipeline is:

$$
p(\ell) = \frac{\exp\left(s_\ell / T\right)}{\sum_{k} \exp\left(s_k / T\right)}, \qquad T = 0.05
$$

where $s_\ell$ is the max-pooled similarity of label $\ell$'s prototypes against the record and its
segments.

### Why a softmax over similarities

Raw cosine similarity differences between prototypes occupied a band so narrow that the argmax was
dominated by numerical noise. The first candidate model measured **10% accuracy with 90%
abstention** using raw similarities; with the softmax at $T = 0.05$, the same model and the same
prototypes became competitive. **This was a scoring bug, not a model failure** — a useful reminder
that the first thing to question is the measurement.

### Segment max-pooling

$$
s_\ell = \max\left(s_\ell^{\text{whole}}, \max_i \left(s_\ell^{\text{segment},i} - 0.05\right)\right)
$$

A short, highly-relevant fragment can lift its label; the margin prevents it from capturing the
whole record's score. The margin was swept over $0.00$–$0.20$; $0.05$ maximised coverage with zero
incorrect recommendations.

## Training data

**There is none.** No fine-tuning, no training corpus, no gradient updates.

What the system _does_ have:

| Artefact             | Size                             | Contents                                                                 |
| -------------------- | -------------------------------- | ------------------------------------------------------------------------ |
| Prototype set        | 9 sentences (3 per label)        | Hand-written descriptions of each label                                  |
| Rules vocabulary     | ~120 phrases + 14 regex patterns | Hand-curated clinical and administrative signals                         |
| Tuning scenarios     | 30                               | Hand-written labelled records used during design                         |
| Validation scenarios | 22                               | Hand-written held-out records, written after the architecture was frozen |
| Synthetic bundle     | 40 FHIR R4 entries, 7 residents  | Generated by `scripts/generate-dataset.ts`                               |

All synthetic. No real patient data was used, seen, or approximated from a real source.

### Preprocessing the model sees

The model's input differs from the raw text in three ways:

1. **Encoding repair** — mojibake and broken unicode sequences are repaired.
2. **Abbreviation expansion** — `SOB` → `shortness of breath`, `HR` → `heart rate`, `SATS` →
   `oxygen saturation`, and similar.
3. **Negation masking** — negated trigger phrases are removed, because an embedding model does not
   distinguish "chest pain" from "no chest pain".

This is why `abbrev-01` is the model's one error on the tuning suite: abbreviation handling is
better suited to deterministic expansion than to embedding-space generalisation.

## Evaluation

Full methodology in [EVALUATION.md](EVALUATION.md). Summary:

| Suite           | Engine       | Committed | Incorrect | Selective accuracy | Coverage |
| --------------- | ------------ | --------: | --------: | -----------------: | -------: |
| Tuning (30)     | Rules        |        21 |         0 |               100% |    70.0% |
| Tuning (30)     | Model        |        20 |         1 |              95.0% |    66.7% |
| Tuning (30)     | **Ensemble** |        18 |     **0** |           **100%** |    60.0% |
| Validation (22) | Rules        |        18 |         0 |               100% |    81.8% |
| Validation (22) | Model        |        14 |         0 |               100% |    63.6% |
| Validation (22) | **Ensemble** |        17 |     **0** |           **100%** |    77.3% |

Reproduce with `npm run evaluate`.

## Ensemble design

### The conventional approach was measured and rejected

Averaging the two engines' confidences — the standard ensemble — was implemented first. It scored
**76.2% selective accuracy, worse than either engine alone** (rules 100%, model 95%).

Two mechanisms explain this:

1. **A confident error drags a correct engine down.** If the model is confidently wrong at 0.9 and
   the rules are right at 0.6, the average lands at 0.75 — above the threshold, and wrong.
2. **Borderline records clear a threshold neither engine should have cleared.** A model at 0.55 and
   rules at 0.55 average to 0.55, but with an agreement bonus applied to partial agreement it can
   cross $T$.

### The shipped design: agreement-gated

```
if model.label ≠ rules.label        ⇒ confidence = 0  ⇒ manual review
if model.confidence < T             ⇒ confidence = 0  ⇒ manual review
if rules.confidence < T             ⇒ confidence = 0  ⇒ manual review
otherwise                            ⇒ confidence = min(0.99,
                                               model × 0.5 + rules × 0.5 + 0.08)
```

Two properties matter:

- **Disagreement is never averaged away.** A disagreement is a strong signal that _something_ is
  wrong — usually that the record is ambiguous. Pinning confidence to 0 sends it to a human, which
  is the correct outcome.
- **The bonus only rewards corroboration.** `AGREEMENT_BONUS = 0.08` applies only when both
  engines independently selected the same label.

### The cost

| Suite      | Ensemble coverage | Rules coverage | Cost of the gate |
| ---------- | ----------------: | -------------: | ---------------- |
| Tuning     |             60.0% |          70.0% | −10 points       |
| Validation |             77.3% |          81.8% | −4.5 points      |

The gate trades 4–10 points of coverage for the elimination of every observed incorrect
recommendation. **For a system whose entire safety argument rests on not being confidently wrong,
that is the right direction.**

### A single point of failure

The rules engine is a **necessary** input to the ensemble, not a fallback. If the rules vocabulary
misses a phrasing entirely, the rules engine abstains and the ensemble abstains, even if the model
was confident. This is conservative and correct — but it means the rules vocabulary is part of the
critical path, and it is hand-curated.

## Thresholds and calibration

| Constant                 | Value  | Role                                            |
| ------------------------ | ------ | ----------------------------------------------- |
| `SIMILARITY_TEMPERATURE` | `0.05` | Softmax sharpness over prototype similarities   |
| `DECISION_THRESHOLD`     | `0.75` | Minimum calibrated confidence to commit         |
| `MIN_CONTENT_WORDS`      | `6`    | Minimum words for a meaningful classification   |
| `SEGMENT_MARGIN`         | `0.05` | Max-pooling penalty on segment-level similarity |
| `AGREEMENT_BONUS`        | `0.08` | Added only on corroborated agreement            |

The threshold was selected by sweeping candidate values and choosing the one that produced **zero
incorrect recommendations** while maximising coverage. It is a single global threshold; there are no
per-label thresholds.

### Calibration method

Raw similarity scores are mapped through the softmax at $T = 0.05$, which spreads a narrow band of
similarities into a usable distribution. Calibration was assessed by comparing committed
confidence against observed correctness on the tuning suite.

**There is no proper reliability diagram or expected-calibration-error measurement.** That is a
known gap; see [Known limitations](#known-limitations).

## Safety gates

Eight checks run before any proposal reaches a reviewer. **Any failure forces manual review.**

| Gate               | Condition                                        |
| ------------------ | ------------------------------------------------ |
| `input-present`    | Empty or whitespace-only input                   |
| `content-depth`    | Fewer than 6 words                               |
| `domain-relevance` | Two-tier care-context check fails                |
| `fhir-validity`    | Bundle validation produced errors                |
| `label-separation` | Implausibly decisive score split                 |
| `contradiction`    | Mutually exclusive signals detected              |
| `clinical-scope`   | Text implies diagnosis, treatment or prescribing |
| `engine-agreement` | Engines disagree, or one abstained               |

### `domain-relevance` — the two-tier check

| Tier                        | Examples                                                               | Requirement                             |
| --------------------------- | ---------------------------------------------------------------------- | --------------------------------------- |
| Strong care context         | wound, medication, resident, audiometry, vitals, discharge, fall, pain | Sufficient alone                        |
| Weak administrative context | appointment, schedule, monitoring, follow-up                           | Requires a concrete clinical detail too |

"the fire drill is scheduled for Tuesday" fails. "wound dressing scheduled for Tuesday" passes.

## Ethical considerations

| Consideration       | How it is addressed                                                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Privacy**         | All inference is client-side; no resident data leaves the device. The only network request after the model loads is for model weights.             |
| **Human oversight** | A mandatory approval gate; the system can produce a proposal but never an action.                                                                  |
| **Bias**            | The corpus is synthetic and hand-written. **No bias analysis has been performed** — see limitations.                                               |
| **Transparency**    | Every decision exposes its scores, matched phrases, safety gates and model metadata. The rules engine can name every phrase it matched.            |
| **Accountability**  | Every reviewer decision is recorded with its evidence and produces a labelled FHIR artifact.                                                       |
| **Over-trust**      | The agreement gate, the eight safety gates and explicit fallback labelling all exist to prevent the system from appearing more capable than it is. |
| **Dual use**        | The system cannot prescribe, diagnose or act, so it presents no direct dual-use pathway.                                                           |
| **Consent**         | Not applicable — synthetic data only. A real deployment would require an appropriate lawful basis.                                                 |

## Known limitations

1. **52 synthetic scenarios is a small evaluation corpus.** 100% selective accuracy means _"no wrong
   answers in 52 hand-written synthetic scenarios"_. It does **not** mean the system is safe on real
   clinical text.
2. **The data is hand-written and clean.** Real documentation is longer, noisier, more internally
   inconsistent, and often poorly structured. Nothing in this evaluation captures that.
3. **English only.** No multilingual capability, no validation on non-English text.
4. **No temporal reasoning.** The classifier sees one assembled record. It cannot detect
   deterioration from a change in a value, which is one of the most clinically important patterns.
5. **Three labels is a coarse output space.** The system answers "what deserves operational
   attention", not "what is wrong".
6. **Nine prototype sentences.** No retrieval corpus, no few-shot examples, no learned calibration.
   Adding a new label means writing prototypes _and_ rules _and_ scenarios.
7. **The rules vocabulary is the ensemble's critical path.** A phrasing it misses causes abstention.
8. **No bias or subgroup analysis.** The corpus is synthetic and small; there are no demographic
   subgroups to analyse. This is a genuine gap for any real deployment.
9. **No reliability diagram or ECE.** Calibration is asserted from threshold behaviour, not measured
   with proper calibration metrics.
10. **No adversarial or OOD test split.** The held-out validation set is drawn from the same
    distribution as the tuning set, just written later.
11. **Prototype sentences are hand-written in one author's voice.** They encode one person's model of
    what these labels mean.
12. **Not clinically validated and not a medical device.** No regulatory review of any kind.

## Out-of-distribution behaviour

| Input                                          | Behaviour                                                                           |
| ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| Administrative text with no clinical content   | `domain-relevance` gate fails → manual review                                       |
| Short or empty text                            | `content-depth` gate fails → manual review                                          |
| Mutually contradictory signals                 | `contradiction` gate fails → manual review                                          |
| Text implying a diagnosis or treatment request | `clinical-scope` gate fails → manual review                                         |
| Engines disagree                               | `engine-agreement` gate fails → manual review                                       |
| One engine abstains                            | `engine-agreement` gate fails → manual review                                       |
| Model fails to load                            | Rules engine answers alone; the UI states the model was unavailable                 |
| Model throws during inference                  | Caught, fallback recorded, rules answer, UI says which engine produced the decision |

**The system is designed to abstain, not to guess.** On inputs it does not understand, the correct
answer is manual review, and every gate exists to make that the default.

## Maintenance

| Aspect                | Current state                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Update cadence        | Ad hoc                                                                                                                                                                    |
| Drift monitoring      | Not implemented                                                                                                                                                           |
| Re-evaluation trigger | Changes to the rules vocabulary, prototypes, threshold or preprocessing                                                                                                   |
| Held-out suite        | `src/lib/eval/validation.ts` — must not be used for tuning                                                                                                                |
| Regression gate       | CI runs format, lint, typecheck, tests and build. `npm run evaluate` should be run before any change to the AI layer and the committed `reports/evaluation.json` updated. |

### Adding a scenario

See [CONTRIBUTING.md](CONTRIBUTING.md#adding-evaluation-scenarios). Scenarios added to the
**tuning** suite are fair game; scenarios added to the **validation** suite should only be added to
probe a specific hypothesis, and the fact that they were added must be recorded.

## Licence and provenance

- Base model: `BAAI/bge-small-en-v1.5`, MIT licence, distributed by `Xenova` in ONNX form for
  Transformers.js.
- Prototypes, rules vocabulary, preprocessing, scoring, calibration and evaluation corpora: written
  for this repository, MIT licence.
- No third-party dataset was used.
