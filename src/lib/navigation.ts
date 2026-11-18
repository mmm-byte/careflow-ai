/**
 * View identifiers for the single-page application shell.
 *
 * The demonstration is a single Next.js route with client-side navigation.
 * A route per view would multiply the static export and make the shared
 * model and dataset state harder to keep consistent.
 */
export const VIEW_IDS = [
  'dashboard',
  'residents',
  'execution',
  'inspector',
  'approval',
  'fhir',
  'evaluation',
  'model-lab',
  'observability',
  'audit',
  'architecture',
] as const;

export type ViewId = (typeof VIEW_IDS)[number];

export const VIEW_TITLES: Record<ViewId, { title: string; eyebrow: string; subtitle: string }> = {
  dashboard: {
    eyebrow: 'Operations',
    title: 'Care operations dashboard',
    subtitle:
      'Every number on this page is computed from the loaded synthetic dataset and the workflows you have run in this browser.',
  },
  residents: {
    eyebrow: 'Workflow',
    title: 'Resident workspace',
    subtitle:
      'The synthetic resident record, its encounter timeline, structured observations and open care-plan work.',
  },
  execution: {
    eyebrow: 'Workflow',
    title: 'Agent execution',
    subtitle:
      'Every stage the orchestrator actually ran, with the real duration of each operation.',
  },
  inspector: {
    eyebrow: 'Workflow',
    title: 'Decision inspector',
    subtitle:
      'The full evidence trail behind the last decision: inputs, scores, safety gates, model metadata and review status.',
  },
  approval: {
    eyebrow: 'Workflow',
    title: 'Review and approval',
    subtitle:
      'Nothing is actioned automatically. A human reviewer approves, edits or rejects each proposal, and the reason is recorded.',
  },
  fhir: {
    eyebrow: 'Data',
    title: 'FHIR explorer',
    subtitle:
      'The original FHIR R4 resources, their references, and the normalized workflow view derived from them.',
  },
  evaluation: {
    eyebrow: 'Evidence',
    title: 'Evaluation lab',
    subtitle:
      'A reproducible labeled suite. Every metric is computed from a live run, never hard-coded.',
  },
  'model-lab': {
    eyebrow: 'Evidence',
    title: 'Model lab',
    subtitle:
      'The engineering comparison between the small embedding model and the deterministic rules engine, with the measured tradeoffs.',
  },
  observability: {
    eyebrow: 'Evidence',
    title: 'Observability',
    subtitle:
      'Real telemetry from the workflows run in this browser, stored locally and resettable at any time.',
  },
  audit: {
    eyebrow: 'Evidence',
    title: 'Audit trail',
    subtitle:
      'Every reviewer decision, the evidence behind it, and the synthetic FHIR artifact it produced.',
  },
  architecture: {
    eyebrow: 'Reference',
    title: 'Architecture and safety',
    subtitle:
      'What is actually implemented in this repository, separated clearly from what a production deployment would require.',
  },
};

/** Read the view from the URL hash so a view can be linked to directly. */
export function viewFromHash(hash: string): ViewId {
  const candidate = hash.replace(/^#\/?/, '');
  return (VIEW_IDS as readonly string[]).includes(candidate) ? (candidate as ViewId) : 'dashboard';
}

/**
 * A hash can carry a resource target as well as a view, so a link from the
 * Decision Inspector can open the FHIR explorer on the exact resource that
 * supported the recommendation.
 *
 * Format: `#fhir/ResourceType/id`
 */
export interface ViewTarget {
  view: ViewId;
  /** "ResourceType/id" when the hash targets a specific resource. */
  resourceKey: string | null;
}

/** Parse a hash into a view plus an optional resource target. */
export function targetFromHash(hash: string): ViewTarget {
  const raw = hash.replace(/^#\/?/, '');
  const separator = raw.indexOf('/');
  if (separator === -1) {
    const view = (VIEW_IDS as readonly string[]).includes(raw) ? (raw as ViewId) : 'dashboard';
    return { view, resourceKey: null };
  }
  // The resource key itself contains a slash ("Observation/o-1001"), so only
  // the first separator is structural.
  const viewPart = raw.slice(0, separator);
  const resourcePart = raw.slice(separator + 1);
  const view = (VIEW_IDS as readonly string[]).includes(viewPart)
    ? (viewPart as ViewId)
    : 'dashboard';
  return { view, resourceKey: resourcePart || null };
}

/** Build a hash that opens the FHIR explorer on a specific resource. */
export function resourceHash(resourceType: string, resourceId: string): string {
  return `#fhir/${resourceType}/${resourceId}`;
}
