import type { EvaluationScenario } from './scenarios.ts';

/**
 * Held-out validation scenarios.
 *
 * The primary suite in `scenarios.ts` was used to choose the decision
 * threshold, the similarity temperature and the label prototypes. Numbers
 * measured on that suite are therefore *tuning* numbers, and quoting them as
 * evidence of generalization would be dishonest.
 *
 * These scenarios were written **after** the architecture was fixed and were
 * never used to select a threshold, a prototype or a rule signal. They use
 * different wording, different clinical situations and different lengths from
 * the tuning set, which makes them a meaningful check on whether the system
 * generalizes or merely memorized.
 *
 * They are reported separately in EVALUATION.md and in the Evaluation Lab.
 */

export const VALIDATION_SCENARIOS: EvaluationScenario[] = [
  // ---- Routine -----------------------------------------------------------
  {
    id: 'val-routine-01',
    category: 'routine',
    expected: 'routine',
    description: 'Stable diabetes review with normal blood sugar readings.',
    note: 'Synthetic note: blood sugar readings within the target range all week. Insulin dose unchanged and the resident reports feeling well.',
    observations: [{ label: 'Blood glucose', value: 118, unit: 'mg/dL' }],
  },
  {
    id: 'val-routine-02',
    category: 'routine',
    expected: 'routine',
    description: 'Routine podiatry check with nothing outstanding.',
    note: 'Synthetic note: podiatry check completed, toenails trimmed and no concerns raised. Nothing outstanding for the care team.',
  },
  {
    id: 'val-routine-03',
    category: 'routine',
    expected: 'routine',
    description: 'Unchanged mobility assessment with no new symptoms.',
    note: 'Synthetic note: mobility unchanged since the previous assessment. Walks unaided to the dining room without shortness of breath.',
  },

  // ---- Follow-up ---------------------------------------------------------
  {
    id: 'val-followup-01',
    category: 'follow-up',
    expected: 'follow-up',
    description: 'New orthostatic dizziness with a recheck scheduled.',
    note: 'Synthetic note: resident reports light-headedness when standing after the antihypertensive dose was adjusted. Repeat postural readings arranged for next week.',
  },
  {
    id: 'val-followup-02',
    category: 'follow-up',
    expected: 'follow-up',
    description: 'Incomplete wound dressing with a review outstanding.',
    note: 'Synthetic note: dressing on the left shin is soiled and needs changing. The wound is not infected but the dressing must be reviewed tomorrow.',
  },
  {
    id: 'val-followup-03',
    category: 'follow-up',
    expected: 'follow-up',
    description: 'Hearing aid battery check outstanding.',
    note: 'Synthetic note: hearing aid batteries replaced. An annual hearing check still needs booking with the audiology team.',
  },

  // ---- Priority ----------------------------------------------------------
  {
    id: 'val-priority-01',
    category: 'priority',
    expected: 'priority',
    description: 'Sudden facial droop with weakness on one side.',
    note: 'Synthetic note: facial droop noticed at breakfast with weakness down the right arm. Stroke pathway activated and the resident is being seen immediately.',
  },
  {
    id: 'val-priority-02',
    category: 'priority',
    expected: 'priority',
    description: 'Oxygen saturation below threshold after a deterioration.',
    note: 'Synthetic note: oxygen saturation dropped to 88% during the night with increasing work of breathing. Urgent medical review requested this morning.',
    observations: [{ label: 'Oxygen saturation', value: 88, unit: '%' }],
  },
  {
    id: 'val-priority-03',
    category: 'priority',
    expected: 'priority',
    description: 'Uncontrolled bleeding requiring immediate attention.',
    note: 'Synthetic note: uncontrolled bleeding from a grazed knee that did not stop after ten minutes of pressure. Immediate clinician attention required.',
  },

  // ---- Negation ----------------------------------------------------------
  {
    id: 'val-negation-01',
    category: 'negation',
    expected: 'routine',
    description: 'Shortness of breath explicitly denied.',
    note: 'Synthetic note: resident denies any shortness of breath on the stairs. Breathing is comfortable at rest and the chest is clear.',
  },
  {
    id: 'val-negation-02',
    category: 'negation',
    expected: 'follow-up',
    description: 'Falls explicitly denied but a medication review outstanding.',
    note: 'Synthetic note: resident denies falls since the last visit. Medication review still to be arranged by the pharmacist.',
  },

  // ---- Abbreviation ------------------------------------------------------
  {
    id: 'val-abbrev-01',
    category: 'abbreviation',
    expected: 'follow-up',
    description: 'Mixed shorthand with a follow-up outstanding.',
    note: 'Synthetic note: pt c/o dizziness w/ postural changes. f/u w/ pharmacist requested, Rx review pending.',
  },
  {
    id: 'val-abbrev-02',
    category: 'abbreviation',
    expected: 'priority',
    description: 'Terse handover shorthand for an acute deterioration.',
    note: 'Synthetic note: pt found on floor 0600, A&O x2, RR 30, hypoxic. MD review STAT.',
  },

  // ---- Contradictory -----------------------------------------------------
  {
    id: 'val-contradictory-01',
    category: 'contradictory',
    expected: 'priority',
    description: 'Normal observations alongside a new acute symptom.',
    note: 'Synthetic note: observations are unremarkable and temperature is normal. However the resident is confused and has collapsed twice today, requiring urgent assessment.',
  },

  // ---- Unusual wording ---------------------------------------------------
  {
    id: 'val-unusual-01',
    category: 'unusual-wording',
    expected: 'follow-up',
    description: 'Everyday-language description of an outstanding appointment.',
    note: 'Synthetic note: the son asked when Mum comes back for her check. We said we would ring the clinic and sort the booking out for her.',
  },
  {
    id: 'val-unusual-02',
    category: 'unusual-wording',
    expected: 'priority',
    description: 'Everyday-language description of an acute event.',
    note: 'Synthetic note: the resident was slurring her words and could not get her breath, so the nurse called the doctor straight away.',
  },

  // ---- Out of distribution ----------------------------------------------
  {
    id: 'val-ood-01',
    category: 'out-of-distribution',
    expected: 'routine',
    description: 'Non-clinical facilities content.',
    note: 'Synthetic note: the fire drill is scheduled for Tuesday. The laundry room key needs replacing before then.',
    expectAbstention: true,
    errorCategory: 'out-of-distribution',
  },
  {
    id: 'val-ood-02',
    category: 'out-of-distribution',
    expected: 'routine',
    description: 'Unrelated workplace content.',
    note: 'Synthetic note: the quarterly catering invoice was approved. The new laptop arrives on Thursday.',
    expectAbstention: true,
    errorCategory: 'out-of-distribution',
  },

  // ---- Low information ---------------------------------------------------
  {
    id: 'val-lowconf-01',
    category: 'low-confidence',
    expected: 'routine',
    description: 'Content-free acknowledgement.',
    note: 'Synthetic note: noted.',
    expectAbstention: true,
    errorCategory: 'low-information',
  },
  {
    id: 'val-lowconf-02',
    category: 'low-confidence',
    expected: 'follow-up',
    description: 'Bare instruction with no subject.',
    note: 'Synthetic note: ring back later please.',
    expectAbstention: true,
    errorCategory: 'low-information',
  },

  // ---- Malformed ---------------------------------------------------------
  {
    id: 'val-malformed-01',
    category: 'malformed',
    expected: 'follow-up',
    description: 'Encoding noise around an administrative task.',
    note: 'Synthetic note: Â€” prescription renewal pending, due in five days.',
  },
  {
    id: 'val-malformed-02',
    category: 'malformed',
    expected: 'priority',
    description: 'Formatting noise around an acute signal.',
    note: 'Synthetic note: {{{ urgent !!! resident acutely unwell ??? same-day review needed',
  },
];

export const VALIDATION_SCENARIO_COUNT = VALIDATION_SCENARIOS.length;
