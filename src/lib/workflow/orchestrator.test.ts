import test from 'node:test';
import assert from 'node:assert/strict';

import { WorkflowOrchestrator } from './orchestrator.ts';
import { WORKFLOW_STAGES } from './stages.ts';
import type { Resident } from '../fhir/types.ts';

function resident(overrides: Partial<Resident> = {}): Resident {
  return {
    id: 'p-1',
    name: 'Ada Lovelace',
    givenName: 'Ada',
    familyName: 'Lovelace',
    birthDate: '1939-12-10',
    gender: 'female',
    ageYears: 86,
    identifiers: ['SYN-0001'],
    encounters: [
      {
        id: 'e-1',
        startedAt: '2026-01-02T09:00:00Z',
        endedAt: '2026-01-02T09:30:00Z',
        reason: 'Medication review',
        status: 'finished',
        type: 'ambulatory',
        resourceType: 'Encounter',
      },
    ],
    observations: [
      {
        id: 'o-1',
        label: 'Systolic blood pressure',
        value: 128,
        unit: 'mmHg',
        displayValue: '128 mmHg',
        effectiveAt: '2026-01-02T09:10:00Z',
        status: 'final',
        interpretation: 'normal',
        referenceRange: '<= 140 mmHg',
        note: null,
        resourceType: 'Observation',
      },
    ],
    documents: [
      {
        id: 'd-1',
        description:
          'Synthetic note: medication review requested; follow-up scheduling needed within seven days.',
        authoredAt: '2026-01-02T09:20:00Z',
        contentType: 'text/plain',
        title: 'Care note',
        resourceType: 'DocumentReference',
      },
    ],
    tasks: [
      {
        id: 'cp-1',
        description: 'Recheck postural blood pressure within seven days',
        status: 'not-started',
        dueAt: '2026-01-09T00:00:00Z',
        scheduledStart: null,
        code: 'Follow-up',
        resourceType: 'CarePlan',
      },
    ],
    appointments: [],
    warnings: [],
    sourceResourceIds: ['p-1', 'e-1', 'o-1', 'd-1', 'cp-1'],
    ...overrides,
  };
}

test('the workflow runs every pre-approval stage in order and stops at the approval gate', async () => {
  const orchestrator = new WorkflowOrchestrator({ resident: resident(), warnings: [] });
  const snapshot = await orchestrator.run();

  assert.equal(snapshot.status, 'awaiting-approval');
  assert.deepEqual(
    snapshot.stages.map((stage) => stage.id),
    WORKFLOW_STAGES.filter((stage) => stage !== 'complete'),
  );
  assert.equal(snapshot.proposedAction?.ready, true);
  assert.ok(snapshot.decision);
});

test('the complete stage runs once a reviewer decides', async () => {
  const orchestrator = new WorkflowOrchestrator({ resident: resident(), warnings: [] });
  await orchestrator.run();
  const reviewed = orchestrator.review({
    outcome: 'approved',
    note: 'Agreed.',
    finalLabel: 'follow-up',
    decidedAt: '2026-01-02T10:00:00Z',
    reviewer: 'Demo reviewer',
  });

  assert.equal(reviewed.status, 'completed');
  assert.equal(reviewed.stages.at(-1)?.id, 'complete');
  assert.equal(reviewed.stages.at(-1)?.status, 'passed');
});

test('a workflow with no usable content abstains rather than recommending', async () => {
  const empty = resident({ documents: [], observations: [], encounters: [], tasks: [] });
  const orchestrator = new WorkflowOrchestrator({ resident: empty, warnings: [] });
  const snapshot = await orchestrator.run();

  assert.equal(snapshot.decision?.status, 'abstained');
  assert.equal(snapshot.proposedAction?.ready, false);
});

test('a FHIR validation error blocks the workflow before classification', async () => {
  const orchestrator = new WorkflowOrchestrator({
    resident: resident(),
    warnings: [
      {
        code: 'bundle.broken',
        severity: 'error',
        message: 'The bundle could not be parsed.',
      },
    ],
  });
  const snapshot = await orchestrator.run();

  assert.equal(snapshot.status, 'abstained');
  assert.equal(snapshot.decision, null);
  assert.equal(snapshot.stages.find((stage) => stage.id === 'validate-fhir')?.status, 'failed');
});

test('a failing model falls back to the rules engine and says so', async () => {
  const orchestrator = new WorkflowOrchestrator({
    resident: resident(),
    warnings: [],
    model: {
      async classify() {
        throw new Error('model unavailable');
      },
    },
  });
  const snapshot = await orchestrator.run();

  assert.equal(snapshot.decision?.usedFallback, true);
  assert.equal(snapshot.decision?.modelFailed, true);
  assert.match(snapshot.decision?.rationale ?? '', /could not run/);
});

test('a workflow cannot leave the approval gate without a review', async () => {
  const orchestrator = new WorkflowOrchestrator({ resident: resident(), warnings: [] });
  const snapshot = await orchestrator.run();
  assert.equal(snapshot.review, null);
  assert.equal(snapshot.status, 'awaiting-approval');

  const reviewed = orchestrator.review({
    outcome: 'rejected',
    note: 'Reviewed by a clinician; no action needed today.',
    finalLabel: 'routine',
    decidedAt: '2026-01-02T10:00:00Z',
    reviewer: 'Demo reviewer',
  });

  assert.equal(reviewed.status, 'rejected');
  assert.equal(reviewed.review?.outcome, 'rejected');
});

test('every stage records a real duration', async () => {
  const orchestrator = new WorkflowOrchestrator({ resident: resident(), warnings: [] });
  const snapshot = await orchestrator.run();
  for (const stage of snapshot.stages) {
    assert.equal(typeof stage.durationMs, 'number');
    assert.ok(stage.durationMs >= 0);
    assert.ok(stage.detail.length > 0);
  }
});

test('the review appends the final stage with a real measured duration', async () => {
  // A clock that advances by a known amount on every read, so the review
  // stage's duration is verifiable rather than assumed to be zero.
  let tick = 0;
  const orchestrator = new WorkflowOrchestrator({
    resident: resident(),
    warnings: [],
    now: () => {
      tick += 7;
      return tick;
    },
  });

  const beforeReview = await orchestrator.run();
  assert.equal(beforeReview.stages.length, WORKFLOW_STAGES.length - 1);

  const reviewed = orchestrator.review({
    outcome: 'approved',
    note: 'Confirmed against the nursing note.',
    finalLabel: 'follow-up',
    decidedAt: '2026-01-02T10:00:00Z',
    reviewer: 'Demo reviewer',
  });

  assert.equal(reviewed.stages.length, WORKFLOW_STAGES.length);
  const last = reviewed.stages.at(-1);
  assert.equal(last?.id, 'complete');
  assert.ok((last?.durationMs ?? 0) > 0, 'the complete stage must record a real duration');
});

test('the workflow exposes every declared stage exactly once, in order', async () => {
  const orchestrator = new WorkflowOrchestrator({ resident: resident(), warnings: [] });
  await orchestrator.run();
  const reviewed = orchestrator.review({
    outcome: 'approved',
    note: 'Confirmed against the nursing note.',
    finalLabel: 'follow-up',
    decidedAt: '2026-01-02T10:00:00Z',
    reviewer: 'Demo reviewer',
  });

  assert.deepEqual(
    reviewed.stages.map((stage) => stage.id),
    [...WORKFLOW_STAGES],
  );
});
