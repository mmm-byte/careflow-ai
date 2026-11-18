'use client';

import { useEffect, useState } from 'react';

import { AppProvider, useApp } from '@/lib/app-state.tsx';
import { AppShell } from '@/components/shell.tsx';
import { VIEW_TITLES, targetFromHash, type ViewId } from '@/lib/navigation.ts';

import { DashboardView } from '@/components/views/dashboard.tsx';
import { ResidentsView } from '@/components/views/residents.tsx';
import { ExecutionView } from '@/components/views/execution.tsx';
import { InspectorView } from '@/components/views/inspector.tsx';
import { ApprovalView } from '@/components/views/approval.tsx';
import { FhirView } from '@/components/views/fhir.tsx';
import { EvaluationView } from '@/components/views/evaluation.tsx';
import { ModelLabView } from '@/components/views/model-lab.tsx';
import { ObservabilityView } from '@/components/views/observability.tsx';
import { AuditView } from '@/components/views/audit.tsx';
import { ArchitectureView } from '@/components/views/architecture.tsx';

function ViewRouter({
  view,
  resourceKey,
  onNavigate,
}: {
  view: ViewId;
  resourceKey: string | null;
  onNavigate: (view: ViewId) => void;
}) {
  switch (view) {
    case 'dashboard':
      return <DashboardView onNavigate={onNavigate} />;
    case 'residents':
      return <ResidentsView onNavigate={onNavigate} />;
    case 'execution':
      return <ExecutionView onNavigate={onNavigate} />;
    case 'inspector':
      return <InspectorView />;
    case 'approval':
      return <ApprovalView />;
    case 'fhir':
      return <FhirView resourceKey={resourceKey} />;
    case 'evaluation':
      return <EvaluationView />;
    case 'model-lab':
      return <ModelLabView />;
    case 'observability':
      return <ObservabilityView />;
    case 'audit':
      return <AuditView />;
    case 'architecture':
      return <ArchitectureView />;
    default:
      return <DashboardView onNavigate={onNavigate} />;
  }
}

function Shell() {
  const [view, setView] = useState<ViewId>('dashboard');
  const [resourceKey, setResourceKey] = useState<string | null>(null);
  const { datasetStatus, datasetError } = useApp();

  // The view, and optionally the resource it targets, are reflected in the URL
  // hash so any part of the application can be linked to directly.
  useEffect(() => {
    const applyHash = () => {
      const target = targetFromHash(window.location.hash);
      setView(target.view);
      setResourceKey(target.resourceKey);
    };
    applyHash();
    window.addEventListener('hashchange', applyHash);
    return () => window.removeEventListener('hashchange', applyHash);
  }, []);

  const navigate = (next: ViewId) => {
    // Clearing the resource target keeps the hash consistent with the state.
    setResourceKey(null);
    setView(next);
    window.history.replaceState(null, '', `#${next}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const title = VIEW_TITLES[view];

  return (
    <AppShell view={view} onNavigate={navigate}>
      <div className="page-head">
        <div>
          <p className="eyebrow">{title.eyebrow}</p>
          <h1 className="page-title">{title.title}</h1>
          <p className="page-sub">{title.subtitle}</p>
        </div>
      </div>

      {datasetStatus === 'error' && (
        <div style={{ marginBottom: 16 }}>
          <div className="notice notice-danger" role="alert">
            <div>
              <strong>The synthetic dataset could not be loaded.</strong>
              <div style={{ marginTop: 4 }}>{datasetError}</div>
              <div style={{ marginTop: 6 }}>
                Every other section of the application remains available so the data handling and
                evaluation behaviour can still be inspected.
              </div>
            </div>
          </div>
        </div>
      )}

      <ViewRouter view={view} resourceKey={resourceKey} onNavigate={navigate} />
    </AppShell>
  );
}

export default function Home() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
