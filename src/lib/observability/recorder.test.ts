import test from 'node:test';
import assert from 'node:assert/strict';

import { snapshotToEvent, summariseEvents } from './recorder.ts';
import type { WorkflowSnapshot } from '../workflow/orchestrator.ts';

function snapshot(overrides: Partial<WorkflowSnapshot> = {}): WorkflowSnapshot {
  return {
    id: 'wf-p-1-abc',
    residentId: 'p-1',
    residentName: 'Test Resident',
    status: 'awaiting-approval',
    startedAt: '2026-01-02T10:00:00.000Z',
    finishedAt: null,
    durationMs: 12,
    stages: [
      {
        id: 'load-resident',
        title: 'Load resident',
        status: 'passed',
        durationMs: 12,
        detail: 'ok',
      },
    ],
    decision: null,
    proposedAction: null,
    normalizedInput: null,
    warnings: [],
    error: null,
    review: null,
    ...overrides,
  };
}

test('two snapshots of the same workflow produce different event ids', () => {
  // The same workflow is recorded once at the approval gate and again after a
  // reviewer decides. The two events must not collide.
  const before = snapshotToEvent(snapshot());
  const after = snapshotToEvent(snapshot({ status: 'completed' }));
  assert.notEqual(before.id, after.id);
});

test('re-running the same workflow produces different event ids', () => {
  const first = snapshotToEvent(snapshot());
  const second = snapshotToEvent(snapshot());
  assert.notEqual(first.id, second.id);
});

test('the summary aggregates stage durations and outcomes', () => {
  const events = [
    snapshotToEvent(snapshot()),
    snapshotToEvent(
      snapshot({
        status: 'completed',
        stages: [
          {
            id: 'load-resident',
            title: 'Load resident',
            status: 'passed',
            durationMs: 20,
            detail: 'ok',
          },
          {
            id: 'await-approval',
            title: 'Await approval',
            status: 'passed',
            durationMs: 4,
            detail: 'ok',
          },
        ],
      }),
    ),
  ];

  const summary = summariseEvents(events);
  assert.equal(summary.totalRuns, 2);
  assert.equal(summary.completed, 1);
  assert.equal(summary.abstained, 0);
  assert.equal(summary.fallbacks, 0);
  const loadStage = summary.meanStageDurations.find((stage) => stage.id === 'load-resident');
  assert.ok((loadStage?.meanMs ?? 0) > 0);
});
