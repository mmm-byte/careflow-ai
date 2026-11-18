'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  ClipboardList,
  FileText,
  LoaderCircle,
  Play,
  Stethoscope,
} from 'lucide-react';

import { useApp, classifyResidentWithRules } from '@/lib/app-state.tsx';
import { Card, EmptyState, LabelPill, Notice } from '@/components/ui.tsx';
import { buildTimeline } from '@/lib/fhir/references.ts';
import type { ViewId } from '@/lib/navigation.ts';

export function ResidentsView({ onNavigate }: { onNavigate: (view: ViewId) => void }) {
  const { residents, selectedResident, selectResident, runWorkflow, workflowRunning, workflow } =
    useApp();
  const [tab, setTab] = useState<'timeline' | 'observations' | 'documents' | 'care-plan'>(
    'timeline',
  );

  const timeline = useMemo(
    () => (selectedResident ? buildTimeline(selectedResident) : []),
    [selectedResident],
  );

  if (residents.length === 0) {
    return (
      <Card>
        <EmptyState icon={<Stethoscope />} title="No residents are available">
          The synthetic dataset has not loaded yet.
        </EmptyState>
      </Card>
    );
  }

  return (
    <div className="grid grid-sidebar">
      <Card title="Resident queue" bodyless>
        <div className="card-body">
          <div className="resident-list">
            {residents.map((resident) => {
              const result = classifyResidentWithRules(resident);
              return (
                <button
                  type="button"
                  key={resident.id}
                  className="resident-item"
                  aria-pressed={selectedResident?.id === resident.id}
                  onClick={() => selectResident(resident.id)}
                >
                  <span className="avatar" aria-hidden="true">
                    {resident.name
                      .split(' ')
                      .map((part) => part[0])
                      .slice(0, 2)
                      .join('')}
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span className="row spread">
                      <span className="resident-name">{resident.name}</span>
                      <LabelPill label={result.label} />
                    </span>
                    <span className="resident-meta">Synthetic identifier {resident.id}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      {selectedResident ? (
        <div className="stack">
          <Card>
            <div className="row spread" style={{ alignItems: 'flex-start' }}>
              <div>
                <p className="eyebrow">Synthetic resident</p>
                <h2 className="page-title" style={{ fontSize: 24 }}>
                  {selectedResident.name}
                </h2>
                <p className="page-sub">
                  {selectedResident.ageYears !== null
                    ? `${selectedResident.ageYears} years old`
                    : 'Age unknown'}
                  {selectedResident.gender ? ` · ${selectedResident.gender}` : ''} · DOB{' '}
                  {selectedResident.birthDate ?? 'unknown'} · identifier{' '}
                  {selectedResident.identifiers.join(', ') || selectedResident.id}
                </p>
              </div>
              <div className="stack stack-sm" style={{ alignItems: 'flex-end' }}>
                <LabelPill label={classifyResidentWithRules(selectedResident).label} />
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={workflowRunning}
                  onClick={() => void runWorkflow()}
                >
                  {workflowRunning ? <LoaderCircle className="spin" /> : <Play />}
                  {workflowRunning ? 'Running CareFlow…' : 'Run CareFlow'}
                </button>
              </div>
            </div>

            {selectedResident.warnings.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <Notice tone="warn">
                  <strong>
                    {selectedResident.warnings.length} data-quality warning
                    {selectedResident.warnings.length === 1 ? '' : 's'}
                  </strong>
                  <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                    {selectedResident.warnings.slice(0, 5).map((warning, index) => (
                      <li key={`${warning.code}-${index}`}>{warning.message}</li>
                    ))}
                  </ul>
                </Notice>
              </div>
            )}

            {workflow && (
              <div style={{ marginTop: 14 }}>
                <Notice tone={workflow.status === 'awaiting-approval' ? 'warn' : 'neutral'}>
                  The last workflow for this resident finished with status{' '}
                  <strong>{workflow.status}</strong>. Open the agent execution view to inspect the
                  stage-by-stage result.
                  <button
                    type="button"
                    className="btn btn-sm"
                    style={{ marginLeft: 10 }}
                    onClick={() => onNavigate('execution')}
                  >
                    View execution
                  </button>
                </Notice>
              </div>
            )}
          </Card>

          <Card
            title="Resident record"
            actions={
              <div className="tabs" role="tablist" aria-label="Resident record sections">
                {(
                  [
                    ['timeline', 'Timeline'],
                    ['observations', 'Observations'],
                    ['documents', 'Documents'],
                    ['care-plan', 'Care plan'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    className="tab"
                    aria-selected={tab === id}
                    onClick={() => setTab(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            }
          >
            {tab === 'timeline' && (
              <>
                {timeline.length === 0 ? (
                  <EmptyState title="No timeline entries">
                    This resident has no dated clinical resources.
                  </EmptyState>
                ) : (
                  <div className="timeline">
                    {timeline.map((entry) => (
                      <div className="timeline-item" key={entry.id}>
                        <span className="timeline-dot" aria-hidden="true" />
                        <p className="timeline-time">
                          {entry.at ? entry.at.slice(0, 10) : 'No date'} · {entry.resourceType}
                        </p>
                        <p className="timeline-title">{entry.title}</p>
                        {entry.detail && <p className="timeline-detail">{entry.detail}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {tab === 'observations' && (
              <>
                {selectedResident.observations.length === 0 ? (
                  <EmptyState icon={<Stethoscope />} title="No observations">
                    This resident has no structured measurements.
                  </EmptyState>
                ) : (
                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr>
                          <th>Observation</th>
                          <th>Value</th>
                          <th>Interpretation</th>
                          <th>Reference range</th>
                          <th>Effective</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedResident.observations.map((observation) => (
                          <tr key={observation.id}>
                            <td>{observation.label}</td>
                            <td>
                              <strong>{observation.displayValue}</strong>
                            </td>
                            <td>{observation.interpretation ?? '—'}</td>
                            <td>{observation.referenceRange ?? '—'}</td>
                            <td>
                              {observation.effectiveAt?.slice(0, 16).replace('T', ' ') ?? '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {tab === 'documents' && (
              <>
                {selectedResident.documents.length === 0 ? (
                  <EmptyState icon={<FileText />} title="No documents">
                    This resident has no narrative notes.
                  </EmptyState>
                ) : (
                  <div className="stack stack-sm">
                    {selectedResident.documents.map((document) => (
                      <div
                        key={document.id}
                        className="notice"
                        style={{ alignItems: 'flex-start' }}
                      >
                        <FileText aria-hidden="true" />
                        <div>
                          <p style={{ fontWeight: 650 }}>
                            {document.description || document.title}
                          </p>
                          <p className="stat-note">
                            {document.resourceType}/{document.id} ·{' '}
                            {document.authoredAt?.slice(0, 16).replace('T', ' ') ?? 'no date'} ·{' '}
                            {document.contentType ?? 'text/plain'}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {tab === 'care-plan' && (
              <>
                {selectedResident.tasks.length === 0 &&
                selectedResident.appointments.length === 0 ? (
                  <EmptyState icon={<ClipboardList />} title="No open work">
                    This resident has no care-plan activities or appointments.
                  </EmptyState>
                ) : (
                  <div className="stack stack-sm">
                    {selectedResident.tasks.map((task) => (
                      <div key={task.id} className="notice" style={{ alignItems: 'flex-start' }}>
                        <ClipboardList aria-hidden="true" />
                        <div>
                          <p style={{ fontWeight: 650 }}>{task.description}</p>
                          <p className="stat-note">
                            {task.resourceType}/{task.id} · status {task.status ?? 'unknown'} · due{' '}
                            {task.dueAt?.slice(0, 10) ?? 'not scheduled'}
                          </p>
                        </div>
                      </div>
                    ))}
                    {selectedResident.appointments.map((appointment) => (
                      <div
                        key={appointment.id}
                        className="notice"
                        style={{ alignItems: 'flex-start' }}
                      >
                        <CalendarClock aria-hidden="true" />
                        <div>
                          <p style={{ fontWeight: 650 }}>{appointment.description}</p>
                          <p className="stat-note">
                            {appointment.resourceType}/{appointment.id} · status{' '}
                            {appointment.status ?? 'unknown'} · starts{' '}
                            {appointment.startsAt?.slice(0, 16).replace('T', ' ') ??
                              'not scheduled'}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </Card>

          <Card title="Source resources" subtitle="Every resource that contributed to this view.">
            <div className="row">
              {selectedResident.sourceResourceIds.map((id) => (
                <span key={id} className="pill pill-neutral mono">
                  {id}
                </span>
              ))}
            </div>
            {selectedResident.warnings.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <Notice tone="warn">
                  <AlertTriangle aria-hidden="true" />
                  <div>
                    Some source resources produced validation warnings. The workflow records them
                    rather than silently dropping them.
                  </div>
                </Notice>
              </div>
            )}
          </Card>
        </div>
      ) : (
        <Card>
          <EmptyState title="Select a resident">
            Choose a resident from the queue to see their record.
          </EmptyState>
        </Card>
      )}
    </div>
  );
}
