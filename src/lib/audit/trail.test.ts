import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTaskArtifact, recordAuditEntry } from './trail.ts';
import type { ReviewDecision, WorkflowSnapshot } from '../workflow/orchestrator.ts';

const review: ReviewDecision = {
  outcome: 'approved',
  note: 'Agreed with the proposed routing.',
  finalLabel: 'follow-up',
  decidedAt: '2026-01-02T10:00:00Z',
  reviewer: 'Demo reviewer',
};

const snapshot: WorkflowSnapshot = {
  id: 'wf-p-1-abc',
  residentId: 'p-1',
  residentName: 'Ada Lovelace',
  status: 'awaiting-approval',
  startedAt: '2026-01-02T10:00:00Z',
  finishedAt: null,
  durationMs: 12,
  stages: [],
  decision: null,
  proposedAction: null,
  normalizedInput: null,
  warnings: [],
  error: null,
  review: null,
};

test('the demonstration artifact is a FHIR Task marked as synthetic', () => {
  const artifact = buildTaskArtifact(snapshot, review);

  assert.equal(artifact.resourceType, 'Task');
  assert.equal(artifact.subject.reference, 'Patient/p-1');
  assert.equal(artifact.priority, 'routine');
  assert.ok(
    artifact.meta.tag.some((tag) => tag.code === 'SYNTHETIC'),
    'the artifact must be tagged synthetic',
  );
  assert.ok(
    artifact.extension.some((extension) => extension.valueString === 'true'),
    'the artifact must carry the synthetic-artifact extension',
  );
});

test('the artifact records the workflow id and source engine', () => {
  const artifact = buildTaskArtifact(snapshot, review);
  const urls = artifact.extension.map((extension) => extension.url);
  assert.ok(urls.some((url) => url.endsWith('/workflow-id')));
  assert.ok(urls.some((url) => url.endsWith('/source-engine')));
});

test('a rejected decision produces a rejected artifact', () => {
  const artifact = buildTaskArtifact(snapshot, { ...review, outcome: 'rejected' });
  assert.equal(artifact.status, 'rejected');
});

test('a priority decision produces an urgent artifact', () => {
  const artifact = buildTaskArtifact(snapshot, { ...review, finalLabel: 'priority' });
  assert.equal(artifact.priority, 'urgent');
});

test('two reviews of the same workflow produce different audit entry ids', () => {
  // The same workflow can be reviewed more than once, and an append-only
  // trail must not collapse those into a single entry.
  const first = recordAuditEntry(snapshot, review);
  const second = recordAuditEntry(snapshot, { ...review, decidedAt: '2026-01-02T11:30:00Z' });
  assert.notEqual(first.id, second.id);
});
