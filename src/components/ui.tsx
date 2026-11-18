'use client';

import type { ReactNode } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  CircleSlash,
  Info,
  XCircle,
} from 'lucide-react';

import type { WorkflowLabel } from '@/lib/ai/types.ts';

/* ------------------------------------------------------------------ */
/* Card                                                               */
/* ------------------------------------------------------------------ */

export function Card({
  title,
  subtitle,
  actions,
  children,
  bodyless,
  className,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  bodyless?: boolean;
  className?: string;
}) {
  return (
    <section className={`card${className ? ` ${className}` : ''}`}>
      {(title || actions) && (
        <header className={`card-head${bodyless ? ' no-border' : ''}`}>
          <div>
            {title && <h2 className="card-title">{title}</h2>}
            {subtitle && <p className="card-sub">{subtitle}</p>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </header>
      )}
      {bodyless ? children : <div className="card-body">{children}</div>}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Label pill                                                         */
/* ------------------------------------------------------------------ */

const LABEL_TEXT: Record<WorkflowLabel, string> = {
  priority: 'Priority review',
  'follow-up': 'Follow-up',
  routine: 'Routine',
};

export function LabelPill({ label, children }: { label: WorkflowLabel; children?: ReactNode }) {
  return (
    <span className={`pill pill-${label}`}>
      <span className="dot" aria-hidden="true" />
      {children ?? LABEL_TEXT[label]}
    </span>
  );
}

export function labelText(label: WorkflowLabel): string {
  return LABEL_TEXT[label];
}

/* ------------------------------------------------------------------ */
/* Status pill                                                        */
/* ------------------------------------------------------------------ */

export type Tone = 'neutral' | 'accent' | 'warn' | 'danger' | 'routine';

export function StatusPill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

/* ------------------------------------------------------------------ */
/* Stat tile                                                          */
/* ------------------------------------------------------------------ */

export function Stat({
  label,
  value,
  note,
  tone,
  icon,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  tone?: 'accent' | 'priority' | 'followup' | 'routine';
  icon?: ReactNode;
}) {
  return (
    <div className={`stat${tone ? ` stat-${tone}` : ''}`}>
      <div className="stat-label">
        {icon}
        {label}
      </div>
      <div className="stat-value">{value}</div>
      {note && <div className="stat-note">{note}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Empty state                                                        */
/* ------------------------------------------------------------------ */

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <p className="empty-title">{title}</p>
      {children && <p className="empty-text">{children}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Notice                                                             */
/* ------------------------------------------------------------------ */

export function Notice({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'warn' | 'danger';
  children: ReactNode;
}) {
  const Icon = tone === 'danger' ? XCircle : tone === 'warn' ? AlertTriangle : Info;
  return (
    <div
      className={`notice${tone === 'neutral' ? '' : ` notice-${tone}`}`}
      role={tone === 'neutral' ? 'note' : 'alert'}
    >
      <Icon aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Score meter                                                        */
/* ------------------------------------------------------------------ */

export function ScoreRow({
  label,
  score,
  detail,
  selected,
}: {
  label: string;
  score: number;
  detail?: string;
  selected?: boolean;
}) {
  const percent = Math.max(0, Math.min(1, score)) * 100;
  const slug = label === 'follow-up' ? 'follow-up' : label;
  return (
    <div className="score-row">
      <div>
        <span className="score-label">{label}</span>
        {detail && (
          <div className="stat-note" style={{ fontSize: '11px' }}>
            {detail}
          </div>
        )}
      </div>
      <div
        className="meter"
        role="meter"
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label} score`}
      >
        <div
          className={`meter-fill ${slug}${selected ? '' : ''}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="score-value">{percent.toFixed(1)}%</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Safety check                                                       */
/* ------------------------------------------------------------------ */

export function SafetyCheckRow({
  status,
  title,
  detail,
}: {
  status: 'pass' | 'warn' | 'fail';
  title: string;
  detail: string;
}) {
  const Icon = status === 'pass' ? CheckCircle2 : status === 'warn' ? AlertTriangle : XCircle;
  return (
    <div className={`check ${status}`}>
      <span className="check-icon">
        <Icon aria-hidden="true" />
      </span>
      <div>
        <p className="check-title">{title}</p>
        <p className="check-detail">{detail}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Stage status icon                                                  */
/* ------------------------------------------------------------------ */

export function StageStatusIcon({ status }: { status: string }) {
  if (status === 'passed') return <CheckCircle2 aria-hidden="true" />;
  if (status === 'failed') return <XCircle aria-hidden="true" />;
  if (status === 'warned') return <AlertTriangle aria-hidden="true" />;
  if (status === 'skipped') return <CircleSlash aria-hidden="true" />;
  if (status === 'running') return <CircleDashed aria-hidden="true" />;
  return <CircleDashed aria-hidden="true" />;
}

/* ------------------------------------------------------------------ */
/* Key/value list                                                     */
/* ------------------------------------------------------------------ */

export function KeyValue({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="kv">
      {items.map((item) => (
        <div key={item.label} style={{ display: 'contents' }}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
