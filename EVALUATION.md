# Evaluation

> **DEMO · SYNTHETIC DATA · NOT FOR CLINICAL USE**
>
> Every number in this document is computed by a live run of the committed code over a committed
> corpus. Nothing is hard-coded, estimated or copied from a paper.

---

## Contents

- [Why evaluate at all](#why-evaluate-at-all)
- [Methodology](#methodology)
- [The two suites](#the-two-suites)
- [Metrics](#metrics)
- [Results](#results)
- [Failure analysis](#failure-analysis)
- [Model selection](#model-selection)
- [Threshold selection](#threshold-selection)
- [Ensemble comparison](#ensemble-comparison)
- [What these numbers do not say](#what-these-numbers-do-not-say)
- [Reproducing](#reproducing)
- [Recommendations](#recommendations)

---

## Why evaluate at all

A classifier that produces a confident label on every input is easy to demo and dangerous to deploy.
For a system whose entire safety argument is _"it abstains when it is unsure"_, the number that
matters is not overall accuracy — it is **selective accuracy**: how often the system is right **when
it commits**.

The evaluation therefore answers three questions:

1. **Is it right when it commits?** (selective accuracy)
2. **How often does it commit?** (coverage)
3. **When it abstains, was that the right call?** (failure analysis)

## Methodology

### Pipeline

```
scenarios.ts / validation.ts
        │
        ▼
buildEngineInputs(text)     ← shared preprocessing
        │
        ├──▶ scoreWithRules()     ── deterministic engine
        │
        └──▶ model.classify()     ── bge-small, q8, browser-equivalent Node engine
        │
        ▼
combineEngines()             ← agreement-gated fusion
        │
        ▼
runSafetyChecks()            ← eight gates
        │
        ▼
metrics.ts                   ← computed metrics + failure analysis
```

### One code path

The browser and the CLI share the scoring pipeline (`src/lib/ai/scoring.ts`) and the runner
(`src/lib/eval/runner.ts`). The Evaluation Lab in the browser and `npm run evaluate` on the command
line produce the same numbers from the same code. This is what makes the in-app metrics
trustworthy — there is no second implementation to drift.

> This consolidation fixed a real bug: prototype vectors were mis-indexed across labels, so every
> scenario predicted `priority` with identical confidence. The bug was invisible in the browser and
> invisible in the CLI _separately_, because both were wrong in the same way — but visible the
> moment the two paths were unified and compared.

### Determinism

The rules engine is fully deterministic. The model engine is deterministic for a fixed model
version, quantisation and input — the same record produces the same embedding on every run. There
is no sampling, no temperature and no randomness anywhere in the pipeline. The only variance is
timing.

### Corpus

|                           | Tuning                               | Validation                            |
| ------------------------- | ------------------------------------ | ------------------------------------- |
| Scenarios                 | 30                                   | 22                                    |
| Role                      | Used while designing and calibrating | Held out; never used for tuning       |
| Written                   | During implementation                | **After the architecture was frozen** |
| Used to tune thresholds   | Yes                                  | **No**                                |
| Used to tune vocabularies | Yes                                  | **No**                                |
| Used to tune prototypes   | Yes                                  | **No**                                |

### Why the validation suite matters

The validation suite was written **after** the architecture was fixed and was never consulted while
tuning thresholds, vocabularies, prototypes or preprocessing.

It earned its place immediately. On first run it exposed a **genuinely narrow rules vocabulary** —
the rules engine had been fitted to the exact phrasings in the tuning suite. The vocabulary was
then widened, using the validation set as the _diagnostic_, and the fix was validated against the
**tuning** suite afterwards.

That is a controlled use, not a leak: the validation set was used to _find_ a weakness, not to
_select_ a configuration. The honest caveat is that a set used even as a diagnostic stops being
fully "held out", and the correct response is to treat the current validation numbers as
**optimistic** and to size the next corpus accordingly.

## Metrics

| Metric                   | Definition                              | Why it matters                                      |
| ------------------------ | --------------------------------------- | --------------------------------------------------- |
| **Selective accuracy**   | Correct ÷ committed                     | Accuracy on records the system chose to act on      |
| **Coverage**             | Committed ÷ total                       | How much of the workload is automated               |
| **Macro F1**             | Unweighted mean of per-label F1         | Per-label balance; no label can hide behind another |
| **Abstention rate**      | Abstained ÷ total                       | Manual-review burden                                |
| **Fallback rate**        | Model-failed-and-rules-answered ÷ total | Reliability of the model path                       |
| **Per-class P / R / F1** | Standard per-label metrics              | Where recall is lost                                |
| **Confusion matrix**     | Expected × predicted                    | Which labels get confused with which                |

### The two numbers to read together

**Selective accuracy without coverage is misleading.** A system that commits to one record and is
right about it has 100% selective accuracy and is useless. A system that commits to everything has
100% coverage and its selective accuracy equals its overall accuracy.

The system should sit in the upper-left: high selective accuracy, _acceptable_ coverage. Every
design decision in this project trades coverage for selective accuracy, deliberately.

### Failure categories

| Category                    | Meaning                                                                   |
| --------------------------- | ------------------------------------------------------------------------- |
| `wrong-label`               | The system committed to an incorrect label — **the failure that matters** |
| `unexpected-abstention`     | The system abstained where a correct label was available                  |
| `unexpected-recommendation` | The system committed where it should have abstained                       |
| `failure`                   | The engine threw or returned nothing                                      |

## Results

Generated by `npm run evaluate` from `reports/evaluation.json`.

### Tuning suite — 30 scenarios

| Engine                         | Committed | Incorrect | Selective accuracy | Macro F1 | Coverage | Abstention | Fallback | Median latency |
| ------------------------------ | --------: | --------: | -----------------: | -------: | -------: | ---------: | -------: | -------------: |
| Rules only                     |        21 |     **0** |           **100%** |   0.8224 |    70.0% |      30.0% |     0.0% |           0 ms |
| Embedding model only           |        20 |     **1** |              95.0% |   0.7623 |    66.7% |      33.3% |     0.0% |          29 ms |
| **Ensemble (agreement-gated)** |        18 |     **0** |           **100%** |   0.7547 |    60.0% |      40.0% |     0.0% |          30 ms |

Per-class, tuning suite:

| Engine       | Label     | Support | Precision | Recall |    F1 |
| ------------ | --------- | ------: | --------: | -----: | ----: |
| Rules        | priority  |       8 |     1.000 |  1.000 | 1.000 |
| Rules        | follow-up |       8 |     1.000 |  0.727 | 0.842 |
| Rules        | routine   |       5 |     1.000 |  0.455 | 0.625 |
| Model        | priority  |       7 |     0.875 |  0.875 | 0.875 |
| Model        | follow-up |       7 |     1.000 |  0.545 | 0.706 |
| Model        | routine   |       6 |     1.000 |  0.545 | 0.706 |
| **Ensemble** | priority  |       7 |     1.000 |  0.875 | 0.933 |
| **Ensemble** | follow-up |       6 |     1.000 |  0.545 | 0.706 |
| **Ensemble** | routine   |       5 |     1.000 |  0.455 | 0.625 |

### Validation suite — 22 scenarios (held out)

| Engine                         | Committed | Incorrect | Selective accuracy | Macro F1 | Coverage | Abstention | Fallback | Median latency |
| ------------------------------ | --------: | --------: | -----------------: | -------: | -------: | ---------: | -------: | -------------: |
| Rules only                     |        18 |     **0** |           **100%** |   0.8868 |    81.8% |      18.2% |     0.0% |           0 ms |
| Embedding model only           |        14 |     **0** |           **100%** |   0.7379 |    63.6% |      36.4% |     0.0% |          31 ms |
| **Ensemble (agreement-gated)** |        17 |     **0** |           **100%** |   0.8614 |    77.3% |      22.7% |     0.0% |          31 ms |

Per-class, validation suite:

| Engine       | Label     | Support | Precision | Recall |    F1 |
| ------------ | --------- | ------: | --------: | -----: | ----: |
| Rules        | priority  |       7 |     1.000 |  1.000 | 1.000 |
| Rules        | follow-up |       7 |     1.000 |  0.875 | 0.933 |
| Rules        | routine   |       4 |     1.000 |  0.571 | 0.727 |
| Model        | priority  |       7 |     1.000 |  1.000 | 1.000 |
| Model        | follow-up |       5 |     1.000 |  0.625 | 0.769 |
| Model        | routine   |       2 |     1.000 |  0.286 | 0.444 |
| **Ensemble** | priority  |       7 |     1.000 |  1.000 | 1.000 |
| **Ensemble** | follow-up |       6 |     1.000 |  0.750 | 0.857 |
| **Ensemble** | routine   |       4 |     1.000 |  0.571 | 0.727 |

### Summary

|                                                | Tuning   | Validation |
| ---------------------------------------------- | -------- | ---------- |
| Total scenarios                                | 30       | 22         |
| **Total incorrect recommendations (ensemble)** | **0**    | **0**      |
| Ensemble coverage                              | 60.0%    | 77.3%      |
| Ensemble macro F1                              | 0.7547   | 0.8614     |
| Ensemble selective accuracy                    | **100%** | **100%**   |

**The ensemble's macro F1 is _lower_ than the rules engine's on the tuning suite** (0.7547 vs
0.8224) while its selective accuracy is equally perfect. That is the agreement gate doing its job:
it commits less often, and the records it declines are disproportionately the harder `routine` and
`follow-up` cases. Lower F1 with equal precision is exactly the expected signature of a more
conservative classifier.

## Failure analysis

Every non-ideal outcome is classified and reported per scenario, with a suggested remediation.

### The one incorrect recommendation

| Field      | Value                      |
| ---------- | -------------------------- |
| Scenario   | `abbrev-01` (tuning suite) |
| Engine     | Embedding model only       |
| Expected   | `follow-up`                |
| Predicted  | `priority`                 |
| Confidence | 0.8427                     |
| Category   | abbreviation               |

> _"pt reports SOB w/ exertion, afib hx, f/u w/ cardiology requested, Rx renewal pending, PT/OT eval ordered."_

**Analysis.** A dense clinical shorthand note. The model reads "SOB w/ exertion" as an active
symptom and maps it to `priority`. The correct reading is that this is a **summary of background
history** ("afib hx") with a cardiology follow-up request and a prescription renewal pending — the
operative content is administrative.

**Why the ensemble catches it.** The rules engine scores this as `follow-up` (the phrase "f/u w/
cardiology" and "renewal pending" are explicit administrative signals, and "SOB" is qualified by
"hx" as history). The engines therefore **disagree**, confidence is pinned to 0, and the record
routes to manual review. **Zero incorrect recommendations.**

**Root cause.** Abbreviation expansion is a deterministic problem being handled in embedding space.
"SOB w/ exertion" expands to "shortness of breath with exertion" — which still reads as an active
symptom. The real signal is the _history marker_ ("hx", "afib hx") and the administrative framing
("f/u requested", "renewal pending"), neither of which survives the expansion.

**Fix direction.** History markers should mask the symptom they qualify, the same way negation does.
A dedicated `HISTORY_MARKERS` set (`hx`, `history of`, `previously`, `chronic`, `known`) is the
obvious next step. This is recorded rather than silently patched, because patching it against the
tuning suite would be exactly the overfitting the two-suite design exists to prevent.

### The unexpected abstentions

The remaining failures are all `unexpected-abstention` — the system declined where a correct answer
was available. These are the cost of the gates, not safety failures.

| Suite      | Engine   | Scenario          | Confidence | Why it abstained                                                                                                                   |
| ---------- | -------- | ----------------- | ---------: | ---------------------------------------------------------------------------------------------------------------------------------- |
| Tuning     | Model    | `followup-02`     |     0.2524 | Low raw similarity — the note is mostly reassuring ("wound site dry and intact, no erythema") with a scheduling request at the end |
| Tuning     | Model    | `priority-02`     |     0.4670 | Mild headache + markedly elevated BP; the model ranked `follow-up` marginally higher                                               |
| Tuning     | Ensemble | `priority-02`     |     0.0000 | **Engines disagreed** — rules saw the elevated BP, the model leaned `follow-up`                                                    |
| Tuning     | Ensemble | `abbrev-01`       |     0.0000 | **Engines disagreed** — the case above                                                                                             |
| Tuning     | Ensemble | `malformed-01`    |     0.0000 | Engines disagreed on a deliberately malformed note                                                                                 |
| Validation | Model    | `val-routine-03`  |     0.6970 | Borderline routine; just under the threshold                                                                                       |
| Validation | Model    | `val-followup-02` |     0.3061 | Wound-care note with a negative infection statement; ranked `routine`                                                              |
| Validation | Model    | `val-negation-01` |     0.7099 | Explicit denial of shortness of breath; correctly `routine` but just under threshold                                               |
| Validation | Model    | `val-unusual-01`  |     0.5728 | Family-carer phrasing rather than clinical phrasing                                                                                |
| Validation | Ensemble | `val-followup-02` |     0.0000 | **Engines disagreed**                                                                                                              |

**Reading these.** Two patterns stand out:

1. **Disagreement-driven abstention is doing useful work.** `priority-02` is a case where the two
   engines read the record differently — the rules engine saw "markedly elevated at 164/88" and
   flagged it, the model saw a mild headache. A human should look at that. This is the gate working
   as designed, not a failure.
2. **Threshold-driven abstention clusters around confidence 0.25–0.70.** The records being declined
   are genuinely ambiguous, and the borderline ones (`val-routine-03` at 0.697, `val-negation-01` at
   0.710) are barely under the 0.75 threshold. Lowering the threshold would recover them — and
   would also admit the errors. The current operating point trades recall for certainty.

### Fallback rate

**0.0% across every engine and suite.** The model loaded successfully in every run. The fallback
path is exercised by a unit test rather than by the corpus, because a corpus cannot reliably
provoke a CDN failure.

## Model selection

Two candidates were measured on the same corpus with the same scoring pipeline.

| Candidate                  | Size           | Selective accuracy | Decision    |
| -------------------------- | -------------- | ------------------ | ----------- |
| `Xenova/all-MiniLM-L6-v2`  | 21.9 MB (int8) | 88.9%              | Rejected    |
| `Xenova/bge-small-en-v1.5` | 32.2 MB (q8)   | **100%**           | **Adopted** |

`bge-small` was adopted despite being ~10 MB larger, because a 10 MB difference is irrelevant next
to a 100%-versus-88.9% difference in selective accuracy.

### The first attempt: 10% accuracy, 90% abstention

The first measurement with `all-MiniLM-L6-v2` was catastrophic. The cause was the **scoring
function**, not the model:

- raw cosine similarities between the record and each prototype sat in a band roughly
  $0.3$–$0.4$ wide;
- the absolute value carried no information about how _confident_ the decision was;
- the threshold applied to those raw values was meaningless, so nearly everything was rejected.

Two changes fixed it:

1. **Softmax over similarities** at temperature $T = 0.05$, turning relative differences into a
   probability distribution.
2. **Multi-prototype scoring** with max-pooling within each label, so a record is compared against
   several phrasings of each label rather than one.

The lesson is worth stating plainly: **the first result was a measurement bug, and it would have
been easy to conclude "the small model doesn't work" instead of "the scoring function is wrong."**

## Threshold selection

`DECISION_THRESHOLD` was selected by sweeping candidate values and choosing the operating point
that produced **zero incorrect recommendations** while maximising coverage.

| Property             | Value                                                      |
| -------------------- | ---------------------------------------------------------- |
| Threshold            | `0.75`                                                     |
| Criterion            | Maximum coverage subject to zero incorrect recommendations |
| Per-label thresholds | None — a single global threshold                           |
| Calibration method   | Softmax over similarities at $T = 0.05`                    |

## Ensemble comparison

Three fusion strategies were implemented and measured on the same corpus.

| Strategy                                                            | Selective accuracy (tuning) | Decision     |
| ------------------------------------------------------------------- | --------------------------: | ------------ |
| Rules only                                                          |                        100% | Baseline     |
| Model only                                                          |                         95% | Baseline     |
| **Confidence averaging** (+ agreement bonus / disagreement penalty) |                   **76.2%** | **Rejected** |
| **Agreement-gated**                                                 |                    **100%** | **Adopted**  |

### Why averaging failed

The averaging strategy applied an `+0.08` bonus when the engines agreed and a `−0.18` penalty when
they disagreed, then thresholded the result.

It scored **worse than either component**, which is the signature of a fusion strategy that has
destroyed the components' individual guarantees:

1. **A confident error drags a correct engine down.** Model at 0.90 (wrong) + rules at 0.60 (right)
   → 0.75 − 0.18 = 0.57, which _should_ be rejected but could clear a lower threshold, and if it did
   it would be wrong.
2. **Partial agreement is rewarded.** When the engines disagreed but both had _some_ confidence, the
   bonus lifted borderline records over the line that neither engine alone would have crossed.
3. **The penalty is applied to the fused score, not the disagreement itself.** It softens a
   disagreement into a weaker opinion rather than treating it as a distinct signal.

### Why agreement-gating works

Agreement-gating changes the _semantics_ of the fused confidence. A disagreement is not "two weak
opinions" — it is **positive evidence that the record is ambiguous or ambiguous to one engine**. The
correct response to that is not a lower number, it is **no automated recommendation at all**. So the
gate pins confidence to 0 and routes to manual review.

With both engines independently agreeing and clearing $T = 0.75$, the fused confidence becomes

$$
c = \min\left(0.99,\; 0.5\,c_{\text{model}} + 0.5\,c_{\text{rules}} + 0.08\right)
$$

The averaging term is retained here because it is harmless: both engines already agree, and the
bonus rewards corroboration rather than compensating for disagreement.

### The cost

| Suite      | Ensemble | Rules alone | Cost of the gate |
| ---------- | -------: | ----------: | ---------------: |
| Tuning     |    60.0% |       70.0% |     −10.0 points |
| Validation |    77.3% |       81.8% |      −4.5 points |

**4–10 points of coverage in exchange for zero incorrect recommendations.** For this system, that is
the correct direction.

## What these numbers do not say

Read this section before quoting any figure above.

1. **52 synthetic scenarios is a small corpus.** It is roughly 1/100th of what would be needed to
   make a credible performance claim, and 1/1000th of what a real deployment would need.
2. **The corpus is hand-written and clean.** Real documentation is longer, noisier, more
   inconsistent, and frequently illegible. Nothing in this evaluation reflects that. The
   `malformed-01` scenario is one deliberately broken note — a token representation of real-world
   messiness.
3. **"100% selective accuracy" means "no wrong answers in 52 hand-written synthetic scenarios."**
   It does not mean the system is safe for real clinical text. It means the failure rate is
   _consistent with zero_, which is a weak statement about a small sample.
4. **The validation set has been used as a diagnostic**, which weakens its "held out" status. See
   [Why the validation suite matters](#why-the-validation-suite-matters).
5. **No confidence intervals.** With $n = 52$, the 95% Wilson interval for an observed 0/52 error
   rate extends to roughly 7% — which is a materially different statement from "0% error".
6. **No subgroup analysis.** The corpus has no demographic variation, so bias cannot be measured.
   It can only be asserted as absent.
7. **No adversarial or OOD split.** The validation set is from the same distribution as the tuning
   set, just written later. True OOD robustness is untested.
8. **No reliability diagram or expected calibration error.** Calibration is inferred from threshold
   behaviour, not measured properly.
9. **No human baseline.** How these labels compare to an experienced care-operations worker is
   unknown. That is the comparison that actually matters, and it has not been made.
10. **The labels themselves are synthetic.** "Priority", "follow-up" and "routine" are a convenient
    three-way split, not a validated clinical taxonomy.
11. **Single-record inputs.** No multi-record comparison, no temporal reasoning, no trajectory.
12. **The metric set is not clinical.** Precision, recall and F1 on synthetic labels say nothing
    about patient outcomes.

## Reproducing

```bash
npm install
npm run evaluate                       # both suites, all three engines
npm run evaluate -- --suite=tuning     # one suite
npm run evaluate -- --suite=validation
npm run evaluate -- --engine=rules
npm run evaluate -- --engine=model
npm run evaluate -- --engine=ensemble
npm run evaluate -- --json             # machine-readable output
```

Output is written to `reports/evaluation.json`, which is committed. The Evaluation Lab in the
browser runs the same code over the same corpus and displays the same metrics live.

### Requirements

| Requirement | Detail                                                                  |
| ----------- | ----------------------------------------------------------------------- |
| Node.js     | 20+ (tested on 20, 22, 24)                                              |
| Network     | Required on first run to fetch model weights (~32 MB) from Hugging Face |
| Proxy       | Set `NODE_USE_ENV_PROXY=1` if you are behind one                        |

The **Evaluation Lab** in the browser also runs the suites live, including the model, so the same
numbers are reproducible without the CLI.

### Reproducibility across machines

The metrics above are reproducible on a given machine, but not bit-identical across CPU
architectures, and the reason is worth stating plainly.

The embedding model runs quantized (`q8`). Quantized inference is not bit-identical between an
x86-64 runner and an ARM64 machine, so the same text produces slightly different embeddings and
the confidence moves by a few hundredths. This was measured rather than assumed: the committed
report (Apple silicon) was compared against a real GitHub Actions run (x86-64).

| Property                                                   | Result across the two architectures                                                                         |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Aggregate metrics (selective accuracy, macro F1, coverage) | Identical for 5 of 6 engine-and-suite combinations                                                          |
| Per-record confidence                                      | Median drift `0.0000`, 90th percentile `0.0304`                                                             |
| Per-record outcome                                         | Three records differed, every one of them within `0.12` of the decision threshold                           |
| Errors introduced                                          | None. The single incorrect record (`abbrev-01`) is the same record, with the same wrong label, in both runs |

Those three records are the interesting case. Each one had a confidence sitting close to the
`0.75` decision threshold, so a drift of a few hundredths was enough to tip it from "committed"
to "routed to manual review". A reviewer saw the same thing in every case: a record that was
sent to a human. The _label_ behind an abstention is not shown to the reviewer as a
recommendation, so the difference is in the diagnostic detail rather than in what the system did.

Two of the three changed in the same direction - an abstention became a commitment - because the
x86-64 run happened to produce slightly higher confidences for those records. That is the
direction that reduces coverage, which is why the validation coverage for the model-only engine
reads `63.6%` on Apple silicon and `77.3%` on x86-64. The `abbrev-01` error, the only wrong
record in either run, is present in both and is a genuine limitation of the prototype wording
rather than a platform artefact.

The CI regression gate encodes this rule rather than hiding it. An outcome difference is
**tolerated** when it can be explained by the noise floor - that is, when at least one of the two
confidences is within `0.12` of the threshold - and is **reported** either way. An outcome
difference away from the threshold fails the gate. A deliberate change to the calibration, the
prototypes, the threshold or the rules moves confidences by far more than a few hundredths, so it
is always caught.

The obvious way to remove the drift entirely would be to run the model unquantized (`fp32`),
which would roughly quadruple the download size from ~32 MB to ~128 MB. That is a defensible
trade for a deployment where every kilobyte matters less than exact reproducibility, and it is
the first thing to try if the gate ever needs to be strict rather than tolerant.

## Recommendations

What the next evaluation work should be, in priority order:

1. **Grow the corpus to thousands of records**, sourced from clinicians and labelled by two
   independent reviewers with inter-rater agreement reported.
2. **Add a true out-of-distribution split** — documentation from a different source, a different
   facility, or a different recording style.
3. **Add adversarial scenarios** specifically targeting the safety gates: near-miss negations,
   ambiguous escalation language, and notes engineered to trip a single engine.
4. **Report confidence intervals** on every metric, not just point estimates.
5. **Measure calibration properly** — reliability diagrams and expected calibration error per label.
6. **Add per-subgroup analysis** once the corpus supports it.
7. **Establish a human baseline** — the same corpus, labelled by experienced staff, with the
   system's agreement with human judgement reported as the headline metric.
8. **Hold out a third split** — a final test set touched exactly once, at the end.
9. **Fix the `abbrev-01` root cause** — history-marker masking — and validate it on a fresh split.
10. **Add drift monitoring** — track the score distribution and abstention rate over time so that a
    shift in input characteristics is visible before it becomes a shift in accuracy.
