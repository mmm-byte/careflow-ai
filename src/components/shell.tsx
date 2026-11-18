'use client';

import { useEffect, useState, type ReactNode } from 'react';

import {
  Activity,
  Boxes,
  ClipboardList,
  FlaskConical,
  GitBranch,
  LayoutDashboard,
  ScrollText,
  ShieldCheck,
  Users,
} from 'lucide-react';

import { useApp } from '@/lib/app-state.tsx';
import type { ViewId } from '@/lib/navigation.ts';

interface NavItem {
  id: ViewId;
  label: string;
  icon: ReactNode;
  group: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Operations dashboard', icon: <LayoutDashboard />, group: 'Workflow' },
  { id: 'residents', label: 'Resident workspace', icon: <Users />, group: 'Workflow' },
  { id: 'execution', label: 'Agent execution', icon: <GitBranch />, group: 'Workflow' },
  { id: 'inspector', label: 'Decision inspector', icon: <Activity />, group: 'Workflow' },
  { id: 'approval', label: 'Review & approval', icon: <ClipboardList />, group: 'Workflow' },

  { id: 'fhir', label: 'FHIR explorer', icon: <Boxes />, group: 'Data' },
  { id: 'evaluation', label: 'Evaluation lab', icon: <FlaskConical />, group: 'Evidence' },
  { id: 'model-lab', label: 'Model lab', icon: <ShieldCheck />, group: 'Evidence' },
  { id: 'observability', label: 'Observability', icon: <Activity />, group: 'Evidence' },
  { id: 'audit', label: 'Audit trail', icon: <ScrollText />, group: 'Evidence' },
  { id: 'architecture', label: 'Architecture', icon: <GitBranch />, group: 'Reference' },
];

export function AppShell({
  view,
  onNavigate,
  children,
}: {
  view: ViewId;
  onNavigate: (view: ViewId) => void;
  children: ReactNode;
}) {
  const { residents, events, auditEntries, workflow } = useApp();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Close the mobile drawer whenever the view changes.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [view]);

  const groups = [...new Set(NAV_ITEMS.map((item) => item.group))];

  const badgeFor = (id: ViewId): number | null => {
    if (id === 'residents') return residents.length;
    if (id === 'observability') return events.length;
    if (id === 'audit') return auditEntries.length;
    if (id === 'approval') return workflow?.status === 'awaiting-approval' ? 1 : null;
    return null;
  };

  return (
    <>
      <div className="banner" role="status">
        <strong>DEMO</strong>
        <span aria-hidden="true">·</span>
        <span>SYNTHETIC DATA</span>
        <span aria-hidden="true">·</span>
        <span>NOT FOR CLINICAL USE</span>
      </div>

      <div className="shell">
        <aside className="sidebar">
          <a className="brand" href="#main" onClick={() => onNavigate('dashboard')}>
            <span className="brand-mark" aria-hidden="true">
              CF
            </span>
            <span>
              <span className="brand-name">
                CareFlow <b>AI</b>
              </span>
              <span className="brand-tag">Care operations copilot</span>
            </span>
          </a>

          <button
            type="button"
            className="btn btn-sm btn-block"
            aria-expanded={mobileNavOpen}
            aria-controls="primary-navigation"
            onClick={() => setMobileNavOpen((open) => !open)}
            style={{ marginBottom: 12, display: 'none' }}
            data-mobile-toggle
          >
            {mobileNavOpen ? 'Hide navigation' : 'Show navigation'}
          </button>

          <nav
            id="primary-navigation"
            className="nav-groups"
            aria-label="Primary"
            data-open={mobileNavOpen}
          >
            {groups.map((group) => (
              <div className="nav-group" key={group}>
                <p className="nav-group-title">{group}</p>
                {NAV_ITEMS.filter((item) => item.group === group).map((item) => {
                  const badge = badgeFor(item.id);
                  return (
                    <a
                      key={item.id}
                      className="nav-link"
                      href={`#${item.id}`}
                      aria-current={view === item.id ? 'page' : undefined}
                      onClick={(event) => {
                        event.preventDefault();
                        onNavigate(item.id);
                      }}
                    >
                      {item.icon}
                      <span>{item.label}</span>
                      {badge !== null && badge > 0 && <span className="nav-badge">{badge}</span>}
                    </a>
                  );
                })}
              </div>
            ))}
          </nav>
        </aside>

        <main className="main" id="main">
          {children}
        </main>
      </div>
    </>
  );
}
