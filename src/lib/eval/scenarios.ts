import type { WorkflowLabel } from '../ai/types.ts';

export type ScenarioCategory =
  | 'routine'
  | 'follow-up'
  | 'priority'
  | 'ambiguous'
  | 'missing-resource'
  | 'contradictory'
  | 'negation'
  | 'abbreviation'
  | 'unusual-wording'
  | 'out-of-distribution'
  | 'malformed'
  | 'low-confidence';

export interface EvaluationScenario {
  id: string;
  category: ScenarioCategory;
  /** Human-authored label for the scenario. */
  expected: WorkflowLabel;
  /** Short description of what the scenario tests. */
  description: string;
  /** The clinical narrative used as input. */
  note: string;
  /** Optional structured observations, rendered into the input text. */
  observations?: { label: string; value: number; unit: string }[];
  /** Optional open work items. */
  tasks?: string[];
  /**
   * Expected behaviour that differs from a plain label, for example abstention
   * on an ambiguous case. When present, the run is scored on behaviour.
   */
  expectAbstention?: boolean;
  /** Error category used in the failure analysis table. */
  errorCategory?: string;
}

export const EVALUATION_SCENARIOS: EvaluationScenario[] = [
  // ---- Routine -----------------------------------------------------------
  {
    id: 'routine-01',
    category: 'routine',
    expected: 'routine',
    description: 'Stable annual wellness visit with no outstanding work.',
    note: 'Synthetic note: annual wellness visit completed. Resident is stable and no concerns reported today.',
    observations: [{ label: 'Body temperature', value: 36.7, unit: '°C' }],
  },
  {
    id: 'routine-02',
    category: 'routine',
    expected: 'routine',
    description: 'Routine preventive screening with normal results.',
    note: 'Synthetic note: routine blood work returned normal results. Standard preventive care continues.',
    observations: [{ label: 'Haemoglobin', value: 13.8, unit: 'g/dL' }],
  },
  {
    id: 'routine-03',
    category: 'routine',
    expected: 'routine',
    description: 'Unchanged chronic condition with a routine review.',
    note: 'Synthetic note: chronic condition unchanged from last month. Regular review only, nothing outstanding.',
  },

  // ---- Follow-up ---------------------------------------------------------
  {
    id: 'followup-01',
    category: 'follow-up',
    expected: 'follow-up',
    description: 'Medication review with scheduling request.',
    note: 'Synthetic note: resident reports dizziness after medication change; follow-up scheduling requested within seven days.',
    tasks: ['Recheck postural blood pressure and review dizziness after dose change'],
  },
  {
    id: 'followup-02',
    category: 'follow-up',
    expected: 'follow-up',
    description: 'Open care-plan activity that needs scheduling.',
    note: 'Synthetic note: wound site dry and intact, no erythema. Suture removal due in ten days; scheduling assistance requested.',
    tasks: ['Schedule suture removal appointment within ten days'],
  },
  {
    id: 'followup-03',
    category: 'follow-up',
    expected: 'follow-up',
    description: 'Prescription renewal to be arranged by the pharmacy team.',
    note: 'Synthetic note: prescription renewal to be arranged by the pharmacy team within seven days.',
  },
  {
    id: 'followup-04',
    category: 'follow-up',
    expected: 'follow-up',
    description: 'Monitoring plan outstanding after discharge.',
    note: 'Synthetic note: monitoring plan remains open. Care team to review readings and arrange the next appointment.',
  },

  // ---- Priority ----------------------------------------------------------
  {
    id: 'priority-01',
    category: 'priority',
    expected: 'priority',
    description: 'Acute deterioration after a fall with low oxygen saturation.',
    note: 'Synthetic note: resident found on floor in the early morning. Appears acutely unwell and short of breath on exertion. Escalated for urgent clinician assessment this morning.',
    observations: [
      { label: 'Oxygen saturation', value: 91, unit: '%' },
      { label: 'Respiratory rate', value: 24, unit: 'breaths/min' },
    ],
  },
  {
    id: 'priority-02',
    category: 'priority',
    expected: 'priority',
    description: 'Markedly elevated blood pressure with same-day review requested.',
    note: 'Synthetic note: resident reports a mild headache this morning and blood pressure measured markedly elevated at 164/88. Same-day clinician review requested.',
    observations: [{ label: 'Systolic blood pressure', value: 164, unit: 'mmHg' }],
  },
  {
    id: 'priority-03',
    category: 'priority',
    expected: 'priority',
    description: 'Acute confusion with a new neurological symptom.',
    note: 'Synthetic note: new acute confusion observed this evening with slurred speech. Emergency assessment required.',
  },
  {
    id: 'priority-04',
    category: 'priority',
    expected: 'priority',
    description: 'Chest pain reported on exertion.',
    note: 'Synthetic note: resident reports chest pain on exertion, worsening over the past hour. Same-day urgent review needed.',
  },

  // ---- Negation ----------------------------------------------------------
  {
    id: 'negation-01',
    category: 'negation',
    expected: 'routine',
    description: 'Negated urgency statement with a routine review still open.',
    note: 'Synthetic note: annual wellness visit completed. No urgent concerns. Routine care-plan review remains open.',
  },
  {
    id: 'negation-02',
    category: 'negation',
    expected: 'follow-up',
    description: 'Denied fall and dizziness, but a renewal is still outstanding.',
    note: 'Synthetic note: resident denies dizziness, denies falls and reports no concerns today. Prescription renewal to be arranged within seven days.',
  },
  {
    id: 'negation-03',
    category: 'negation',
    expected: 'routine',
    description: 'Explicitly ruled out an acute event.',
    note: 'Synthetic note: chest pain ruled out. Symptoms stable and unchanged since the previous visit.',
  },

  // ---- Abbreviation ------------------------------------------------------
  {
    id: 'abbrev-01',
    category: 'abbreviation',
    expected: 'follow-up',
    description: 'Clinical shorthand with abbreviations.',
    note: 'Synthetic note: pt reports SOB w/ exertion, afib hx, f/u w/ cardiology requested, Rx renewal pending, PT/OT eval ordered.',
  },
  {
    id: 'abbrev-02',
    category: 'abbreviation',
    expected: 'priority',
    description: 'Terse handover shorthand describing an acute change.',
    note: 'Synthetic note: pt found on floor at 0700. A&O x3, resp distress. MD eval STAT requested.',
  },

  // ---- Contradictory -----------------------------------------------------
  {
    id: 'contradictory-01',
    category: 'contradictory',
    expected: 'priority',
    description: 'Stable vitals but an acute symptom in the note.',
    note: 'Synthetic note: observations stable and within normal range. However resident reports chest pain and requires urgent assessment.',
    observations: [{ label: 'Heart rate', value: 72, unit: 'beats/min' }],
  },
  {
    id: 'contradictory-02',
    category: 'contradictory',
    expected: 'follow-up',
    description: 'An administrative task alongside a stable clinical picture.',
    note: 'Synthetic note: resident stable, no acute concerns. Care-plan activity remains open and follow-up scheduling is requested.',
  },

  // ---- Ambiguous ---------------------------------------------------------
  {
    id: 'ambiguous-01',
    category: 'ambiguous',
    expected: 'follow-up',
    description: 'Vague note that should be routed to manual review.',
    note: 'Synthetic note: resident seems a bit off today, maybe worth another look at some point.',
    expectAbstention: true,
    errorCategory: 'low-information',
  },
  {
    id: 'ambiguous-02',
    category: 'ambiguous',
    expected: 'follow-up',
    description: 'Short note with no explicit action.',
    note: 'Synthetic note: discussed at handover, will review later.',
    expectAbstention: true,
    errorCategory: 'low-information',
  },

  // ---- Missing resource --------------------------------------------------
  {
    id: 'missing-01',
    category: 'missing-resource',
    expected: 'routine',
    description: 'Resident record with no notes and no observations.',
    note: '',
    expectAbstention: true,
    errorCategory: 'missing-data',
  },
  {
    id: 'missing-02',
    category: 'missing-resource',
    expected: 'routine',
    description: 'Encounter with no supporting clinical content.',
    note: '',
    observations: [],
    expectAbstention: true,
    errorCategory: 'missing-data',
  },

  // ---- Unusual wording ---------------------------------------------------
  {
    id: 'unusual-01',
    category: 'unusual-wording',
    expected: 'follow-up',
    description: 'Narrative in an unusual, non-clinical register.',
    note: 'Synthetic note: the family asked whether the next appointment could be moved. We said we would try to sort it out and get back to them.',
  },
  {
    id: 'unusual-02',
    category: 'unusual-wording',
    expected: 'priority',
    description: 'Colloquial description of an acute change.',
    note: 'Synthetic note: resident was not making sense and could barely breathe, so we called the doctor straight away.',
  },

  // ---- Out of distribution ----------------------------------------------
  {
    id: 'ood-01',
    category: 'out-of-distribution',
    expected: 'routine',
    description: 'Content unrelated to the care workflow.',
    note: 'Synthetic note: the cafeteria will be serving soup and sandwiches today. The garden club meets on Thursday.',
    expectAbstention: true,
    errorCategory: 'out-of-distribution',
  },
  {
    id: 'ood-02',
    category: 'out-of-distribution',
    expected: 'routine',
    description: 'Non-clinical administrative content.',
    note: 'Synthetic note: invoice 4471 was paid. The supply cupboard key has been misplaced again.',
    expectAbstention: true,
    errorCategory: 'out-of-distribution',
  },

  // ---- Low confidence ----------------------------------------------------
  {
    id: 'lowconf-01',
    category: 'low-confidence',
    expected: 'routine',
    description: 'Very short, information-free note.',
    note: 'Synthetic note: ok.',
    expectAbstention: true,
    errorCategory: 'low-information',
  },
  {
    id: 'lowconf-02',
    category: 'low-confidence',
    expected: 'follow-up',
    description: 'Single ambiguous keyword without context.',
    note: 'Synthetic note: review.',
    expectAbstention: true,
    errorCategory: 'low-information',
  },

  // ---- Malformed ---------------------------------------------------------
  {
    id: 'malformed-01',
    category: 'malformed',
    expected: 'routine',
    description: 'Note containing formatting noise that must not break parsing.',
    note: 'Synthetic note: {{{ resident ))) stable ?? no urgent concerns <<< review pending',
  },
  {
    id: 'malformed-02',
    category: 'malformed',
    expected: 'priority',
    description: 'Note with encoding noise around an urgent signal.',
    note: 'Synthetic note: Â£Â£ urgent Â€” resident acutely unwell, please review immediately.',
  },
];

export const SCENARIO_COUNT = EVALUATION_SCENARIOS.length;
