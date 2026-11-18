# Contributing

> **DEMO · SYNTHETIC DATA · NOT FOR CLINICAL USE**

Thanks for looking at CareFlow AI. This is a demonstration project, and contributions should keep
it that way: **synthetic data only, no clinical claims, no clinical actions.**

---

## Contents

- [Before you start](#before-you-start)
- [Getting set up](#getting-set-up)
- [Development workflow](#development-workflow)
- [Code conventions](#code-conventions)
- [Adding evaluation scenarios](#adding-evaluation-scenarios)
- [Changing the AI layer](#changing-the-ai-layer)
- [Adding a FHIR resource type](#adding-a-fhir-resource-type)
- [Adding a UI surface](#adding-a-ui-surface)
- [Testing](#testing)
- [Commit and pull request conventions](#commit-and-pull-request-conventions)
- [What will not be accepted](#what-will-not-be-accepted)

---

## Before you start

| Requirement | Version                                                                       |
| ----------- | ----------------------------------------------------------------------------- |
| Node.js     | 20+ (tested on 20, 22, 24)                                                    |
| npm         | 10+                                                                           |
| Network     | Required on the first model run, to fetch ~32 MB of weights from Hugging Face |

If you are behind a proxy, set `NODE_USE_ENV_PROXY=1` before running the evaluation or the app.

## Getting set up

```bash
npm install
npm run dev
```

The app is at `http://localhost:3000`. The model weights download on first use and are cached by the
browser.

Verify the checkout is healthy:

```bash
npm run check
```

That runs, in order: format check → lint → typecheck → tests → production build. All five must pass.

## Development workflow

```bash
npm run dev            # development server with hot reload
npm run check          # the full quality gate
npm run evaluate       # regenerate reports/evaluation.json
npm run evaluate:check # compare a fresh run against the committed report
```

### The rule that matters most

**If you change anything under `src/lib/ai/`, `src/lib/eval/`, or the synthetic dataset, run
`npm run evaluate` and commit the updated `reports/evaluation.json`.**

The evaluation report is a committed artefact precisely so that a change to the AI layer cannot
quietly alter the system's measured behaviour. A pull request that changes the AI layer without
regenerating the report is incomplete.

### How the CI regression gate works

CI runs the evaluation twice: once to produce a fresh report in a scratch file, and then
`npm run evaluate:check`, which compares that fresh report against the committed one.

The comparison is **not** a plain file diff. A report records a real run, so it contains a
generation timestamp and per-scenario latency that legitimately change on every execution; a
plain diff would always report a difference and the gate would never be usable. Instead the
comparison separates three kinds of information:

| Field kind                                           | How it is compared     | Why                                                                              |
| ---------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------- |
| Decision outcome — committed label, or manual review | Exact match            | This is what a reviewer actually experiences                                     |
| Raw label scores and aggregate averages              | Reported, not enforced | The quantized model is not bit-identical across CPU architectures                |
| Timing — timestamp, duration, latency                | Ignored                | Wall-clock numbers are environment dependent, not part of the behaviour contract |

### Threshold-boundary differences

The embedding model runs quantized (`q8`), and quantized inference is not bit-identical across
CPUs. An x86-64 runner and an Apple-silicon laptop produce slightly different embeddings for the
same text, which moves a confidence by a few hundredths. When a confidence sits close to the
decision threshold, that drift can flip a record from "committed" to "routed to manual review".

The gate accounts for this. When an outcome differs **and** at least one of the two confidences
is within `0.12` of the threshold, the difference is attributed to measurement noise: it is
reported in the CI output, but it does not fail the gate. An outcome difference where the
confidences are comfortably away from the threshold is a genuine behaviour change and fails.

This is not a loophole. A change to the calibration, the prototypes, the threshold or the rules
moves confidences by far more than a few hundredths, and the gate fails on it. The rule only
absorbs the noise floor, which was measured rather than guessed: comparing the committed report
against a real x86-64 CI run produced three outcome differences, all of them within `0.12` of the
threshold, and all of them inside the range where the quantized model is known to drift. The same
comparison produced no new error on either side: the one incorrect record is the same record with
the same wrong label in both runs.

A pull request that changes a decision will fail the gate and print the exact paths that
differ. If the change is intentional, regenerate the report and commit it.

## Code conventions

### TypeScript

- `strict` is on. No `any` — `eslint` rejects it with `@typescript-eslint/no-explicit-any: error`.
- Use `.ts` / `.tsx` extensions in relative imports (`allowImportingTsExtensions` is enabled).
- Prefer explicit return types on exported functions.
- Model data as discriminated unions when variants differ in shape.

### Styling

- All styling lives in `src/app/globals.css`. There is no CSS framework and no CSS-in-JS.
- Use the existing design tokens and component classes. Do not add a second naming convention.
- If a pattern appears in three or more views, promote it to `src/components/ui.tsx`.

### Comments

Comment the _why_, not the _what_. A comment that restates the code is noise. Comment where a
decision is non-obvious — especially where a measurement drove a design choice:

```ts
// The margin prevents a single short fragment capturing the whole record's
// score. Swept 0.00-0.20; 0.05 maximised coverage with zero incorrect
// recommendations.
const SEGMENT_MARGIN = 0.05;
```

That kind of comment is the point of the project.

### Formatting

Prettier is the single source of truth:

```bash
npm run format          # write
npm run format:check    # check (used by CI)
```

## Adding evaluation scenarios

Scenarios live in one of two files, and **which file you choose changes what the result means.**

| File                         | Purpose             | Use it for                                 |
| ---------------------------- | ------------------- | ------------------------------------------ |
| `src/lib/eval/scenarios.ts`  | Tuning suite        | Any scenario you are iterating against     |
| `src/lib/eval/validation.ts` | Held-out validation | Scenarios that probe a specific hypothesis |

### The rule about the validation suite

The validation suite was written after the architecture was frozen, so it measures generalisation
rather than fit. **Do not add to it casually.** If you add a validation scenario, you must:

1. State the specific hypothesis it probes.
2. Run the full evaluation **before** and **after** your change.
3. Record the result in the pull request description.
4. Accept that the suite is no longer pristine — and say so.

If you are just adding coverage, use the tuning suite.

### Scenario shape

```ts
{
  id: 'category-nn',
  text: 'Synthetic note: ...',
  expected: 'priority',           // 'priority' | 'follow-up' | 'routine'
  shouldAbstain: false,          // true if the system should route to manual review
  tags: ['negation', 'abbreviation'],
}
```

### Categories to cover

Existing scenarios are tagged by category. New ones should extend that taxonomy rather than
invent a parallel one:

`priority`, `follow-up`, `routine`, `negation`, `contrastive`, `abbreviation`, `malformed`,
`out-of-domain`, `contradiction`, `unusual-wording`, `clinical-scope`, `history-marker`.

### Synthetic data rules

- Every text must begin with `Synthetic note: ` — this is how the corpus is marked.
- No real patient information, even anonymised. No names, dates of birth, addresses or phone
  numbers that could be real.
- Use generic references like "the resident", "Mum" or "the daughter".

## Changing the AI layer

The AI layer has a deliberate separation. Respect it.

| If you want to…      | Change                                       | Do not change                                             |
| -------------------- | -------------------------------------------- | --------------------------------------------------------- |
| Add a label          | `LABEL_DEFINITIONS` in `src/lib/ai/types.ts` | The rules engine's assumptions about three labels         |
| Add a rule signal    | `ruleSignals` for the label                  | The model's prototypes — the two must stay independent    |
| Add a regex rule     | `rulePatterns` for the label                 | The preprocessing path                                    |
| Change preprocessing | `src/lib/ai/preprocess.ts`                   | Both engines' views at once — they differ on purpose      |
| Change scoring       | `src/lib/ai/scoring.ts`                      | Only the browser copy — the Node runner must stay in sync |
| Change the threshold | `DECISION_THRESHOLD`                         | Any metric — thresholds are measured, not asserted        |
| Change the ensemble  | `src/lib/ai/ensemble.ts`                     | The agreement gate without re-measuring the alternative   |

### Two rules that are easy to break

**The rules engine and the model must stay independent.** If the rules engine starts reading the
model's output, the ensemble stops being a genuine second opinion and the agreement gate becomes
meaningless.

**Browser and Node scoring must stay identical.** Both use `src/lib/ai/scoring.ts`. If you find
yourself writing scoring logic in `src/lib/ai/model.worker.ts` or `scripts/node-model-engine.ts`,
it belongs in `scoring.ts` instead.

### After any AI-layer change

```bash
npm run evaluate                       # both suites
npm run evaluate:check                 # confirm the fresh run matches the committed report
npm run check                          # full gate
```

Then commit the regenerated `reports/evaluation.json` and describe the metric change in the pull
request — including if it went **down**.

## Adding a FHIR resource type

1. Add the TypeScript shape to `src/lib/fhir/types.ts`.
2. Add extraction to `src/lib/fhir/parser.ts`.
3. Add validation to `src/lib/fhir/validation.ts`.
4. If it carries narrative content, feed it into the resident's normalised text.
5. Extend `scripts/generate-dataset.ts` so the new type appears in the synthetic bundle.
6. Add parser and validation tests.
7. Regenerate the bundle and confirm **0 warnings and 0 orphaned references**.

## Adding a UI surface

1. Add the id to `VIEW_IDS` and a title to `VIEW_TITLES` in `src/lib/navigation.ts`.
2. Create `src/components/views/<name>.tsx`.
3. Add a case to the `ViewRouter` in `src/app/page.tsx`.
4. Reuse the primitives in `src/components/ui.tsx`; do not invent new ones without a reason.
5. Read state from `useApp()` — never fetch or parse independently.

## Testing

```bash
npm test
```

Tests use the Node built-in runner (`node --test`). No test framework is installed, and adding one
should be justified in the pull request.

### What deserves a test

- **Behaviour that could regress silently.** Negation scoping, the approval barrier, the fallback
  labelling, reference resolution.
- **Edge cases** introduced by a change.

### What does not

- Trivial accessors
- Constants
- Framework behaviour
- Restating the implementation in another form

### Where tests live

Tests sit next to the code they cover, as `<module>.test.ts`:

```
src/lib/fhir/parser.test.ts
src/lib/ai/rules.test.ts
src/lib/workflow/orchestrator.test.ts
```

## Commit and pull request conventions

### Commit messages

```
<type>: <imperative summary>

<optional body explaining why, not what>
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `perf`, `chore`, `build`.

```
feat: add history-marker masking to the model preprocessing

Affects the abbrev-01 scenario, where "SOB w/ exertion, afib hx" was
read as an active symptom rather than background history. History
markers now mask the phrase they qualify, the same way negation does.

Validation suite: 0 wrong, coverage 77.3% -> 81.8%.
```

### Pull request description

Include:

1. **What changed** and **why**.
2. **The metric change**, if the AI layer was touched — with the before/after numbers.
3. **What you verified** — the commands you ran and their outcome.
4. **Anything you deliberately did not do.**

Be honest about regressions. A pull request that says "selective accuracy dropped from 100% to 95%
and here is why I think that is the right trade" is far more useful than one that quietly omits the
number.

## What will not be accepted

| Change                                                                   | Reason                                                                 |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Real patient data, even anonymised                                       | The synthetic-data guarantee is the foundation of the safety case      |
| Diagnosis, treatment or prescribing suggestions                          | Out of scope by design; the `clinical-scope` gate exists to enforce it |
| A path that actions a proposal without human approval                    | It breaks the core safety property                                     |
| A hard-coded metric in the UI or docs                                    | Metrics must be computed from a live run                               |
| Removing the synthetic-data banner                                       | Required by the project's premise                                      |
| An LLM API call that sends resident data to a server                     | Breaks the browser-only, no-egress guarantee                           |
| A change to the AI layer without a regenerated `reports/evaluation.json` | The report is the evidence that behaviour did not change silently      |

## Licence

MIT. Contributions are accepted under the same licence.
