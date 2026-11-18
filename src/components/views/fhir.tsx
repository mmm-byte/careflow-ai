'use client';

import { useMemo, useState } from 'react';
import { ArrowRight, Boxes, Link2, Search } from 'lucide-react';

import { useApp } from '@/lib/app-state.tsx';
import { Card, EmptyState, KeyValue, Notice, StatusPill } from '@/components/ui.tsx';
import { buildResourceGraph, extractReferences } from '@/lib/fhir/references.ts';

export function FhirView({ resourceKey = null }: { resourceKey?: string | null }) {
  const { parseResult, selectedResident } = useApp();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const resources = useMemo(() => parseResult?.resources ?? [], [parseResult]);

  const graph = useMemo(
    () => buildResourceGraph(resources, parseResult?.bundleId ?? null),
    [resources, parseResult?.bundleId],
  );

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return resources;
    return resources.filter((resource) =>
      `${resource.resourceType}/${resource.id ?? ''}`.toLowerCase().includes(needle),
    );
  }, [resources, filter]);

  // A link from the Decision Inspector targets a specific resource, so the
  // explorer opens on the resource that supported the recommendation.
  const activeId = resourceKey ?? selectedId;

  const selected = useMemo(
    () =>
      resources.find((resource) => `${resource.resourceType}/${resource.id ?? ''}` === activeId) ??
      null,
    [resources, activeId],
  );

  const selectedReferences = selected ? extractReferences(selected) : [];
  const inbound = selected
    ? (graph.inbound.get(`${selected.resourceType}/${selected.id ?? ''}`) ?? [])
    : [];

  const normalizedForResident =
    selectedResident?.sourceResourceIds.includes(selected?.id ?? '') ?? false;

  return (
    <div className="stack">
      <div className="grid grid-4">
        <div className="stat">
          <div className="stat-label">Resources</div>
          <div className="stat-value">{resources.length}</div>
          <div className="stat-note">Preserved verbatim from the bundle</div>
        </div>
        <div className="stat">
          <div className="stat-label">Resource types</div>
          <div className="stat-value">
            {new Set(resources.map((resource) => resource.resourceType)).size}
          </div>
          <div className="stat-note">FHIR R4 shapes</div>
        </div>
        <div className="stat">
          <div className="stat-label">Validation messages</div>
          <div className="stat-value">{parseResult?.warnings.length ?? 0}</div>
          <div className="stat-note">Warnings and informational notices</div>
        </div>
        <div className="stat stat-accent">
          <div className="stat-label">Unresolved references</div>
          <div className="stat-value">
            {[...graph.inbound.values()].flat().filter((reference) => !reference.resolved).length}
          </div>
          <div className="stat-note">References with no target in the bundle</div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '290px minmax(0, 1fr)' }}>
        <Card
          title="Resources"
          subtitle="Select one to inspect it."
          actions={
            <div style={{ position: 'relative' }}>
              <Search
                size={13}
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  left: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--ink-subtle)',
                  pointerEvents: 'none',
                }}
              />
              <input
                type="search"
                className="input"
                style={{ paddingLeft: 26, width: 130 }}
                placeholder="Filter"
                aria-label="Filter resources by type or id"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
            </div>
          }
        >
          <div className="resident-list">
            {filtered.map((resource) => {
              const key = `${resource.resourceType}/${resource.id ?? ''}`;
              return (
                <button
                  type="button"
                  key={key}
                  className="resident-item"
                  aria-pressed={activeId === key}
                  onClick={() => setSelectedId(key)}
                >
                  <span className="avatar" aria-hidden="true" style={{ width: 30, height: 30 }}>
                    {resource.resourceType.slice(0, 2)}
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span className="resident-name">{resource.resourceType}</span>
                    <span className="resident-meta mono truncate">{resource.id}</span>
                  </span>
                </button>
              );
            })}
            {filtered.length === 0 && <EmptyState title="No matching resources" />}
          </div>
        </Card>

        <div className="stack">
          {!selected ? (
            <Card>
              <EmptyState icon={<Boxes />} title="Select a resource">
                The original FHIR JSON is shown here unchanged, alongside its references and the
                normalized workflow view derived from it.
              </EmptyState>
            </Card>
          ) : (
            <>
              <Card
                title={`${selected.resourceType}/${selected.id ?? 'unknown'}`}
                actions={
                  <span className="pill pill-neutral">
                    {selected.resourceType === 'Patient' ? 'Directory' : 'Clinical'}
                  </span>
                }
              >
                <div className="grid grid-2">
                  <div>
                    <p className="stat-label" style={{ marginBottom: 8 }}>
                      Outbound references
                    </p>
                    {selectedReferences.length === 0 ? (
                      <p className="prose">This resource has no references.</p>
                    ) : (
                      <div className="stack stack-sm">
                        {selectedReferences.map((reference) => (
                          <button
                            type="button"
                            key={`${reference.field}-${reference.reference}`}
                            className="notice"
                            style={{
                              textAlign: 'left',
                              cursor: reference.reference ? 'pointer' : 'default',
                              border: '1px solid var(--line)',
                              background: 'var(--surface-sunken)',
                              color: 'var(--ink-muted)',
                              fontSize: 13,
                            }}
                            onClick={() => {
                              if (reference.reference) setSelectedId(reference.reference);
                            }}
                          >
                            <Link2 aria-hidden="true" />
                            <span>
                              <span className="mono">{reference.field}</span>
                              <br />
                              <span className="mono">{reference.reference}</span>
                              {reference.display && (
                                <>
                                  <br />
                                  <span className="stat-note">{reference.display}</span>
                                </>
                              )}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <p className="stat-label" style={{ marginBottom: 8 }}>
                      Inbound references
                    </p>
                    {inbound.length === 0 ? (
                      <p className="prose">Nothing in the bundle points at this resource.</p>
                    ) : (
                      <div className="stack stack-sm">
                        {inbound.map((reference) => (
                          <div key={`${reference.from}-${reference.field}`} className="notice">
                            <ArrowRight aria-hidden="true" />
                            <span>
                              <span className="mono">{reference.from}</span>
                              <br />
                              <span className="stat-note">
                                via {reference.field} ·{' '}
                                {reference.resolved ? (
                                  <StatusPill tone="routine">resolved</StatusPill>
                                ) : (
                                  <StatusPill tone="danger">unresolved</StatusPill>
                                )}
                              </span>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </Card>

              <Card
                title="Normalized workflow representation"
                subtitle="Derived from the original resources. The source JSON is never replaced."
              >
                {!normalizedForResident ? (
                  <Notice>
                    This resource is not part of the currently selected resident. Select the
                    resident in the workspace to see the normalized view of their record.
                  </Notice>
                ) : (
                  <KeyValue
                    items={[
                      {
                        label: 'Type',
                        value: `${selected.resourceType} (FHIR R4)`,
                      },
                      {
                        label: 'Resource id',
                        value: <span className="mono">{selected.id ?? '—'}</span>,
                      },
                      {
                        label: 'Last updated',
                        value: selected.meta?.lastUpdated ?? 'not recorded',
                      },
                      {
                        label: 'Provenance tags',
                        value:
                          selected.meta?.tag?.map((tag) => tag.code ?? tag.display).join(', ') ||
                          'none',
                      },
                      {
                        label: 'Normalizes into',
                        value:
                          selected.resourceType === 'Patient'
                            ? 'Resident (identity, encounters, observations, documents, tasks)'
                            : selected.resourceType === 'Observation'
                              ? 'NormalizedObservation (label, value, unit, range, interpretation)'
                              : selected.resourceType === 'Encounter'
                                ? 'NormalizedEncounter (status, reason, period)'
                                : selected.resourceType === 'DocumentReference'
                                  ? 'NormalizedDocument (description, authored date, content type)'
                                  : selected.resourceType === 'CarePlan' ||
                                      selected.resourceType === 'Task'
                                    ? 'NormalizedTask (description, status, due date)'
                                    : selected.resourceType === 'Appointment'
                                      ? 'NormalizedAppointment (description, status, start, end)'
                                      : 'Preserved only',
                      },
                    ]}
                  />
                )}
              </Card>

              <Card title="Original FHIR JSON" subtitle="Exactly as it appears in the bundle.">
                <pre className="code">{JSON.stringify(selected, null, 2)}</pre>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
