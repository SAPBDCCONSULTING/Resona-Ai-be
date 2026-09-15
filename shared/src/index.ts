export type PermissionKey =
  | 'org:read'
  | 'org:write'
  | 'users:read'
  | 'users:write'
  | 'roles:read'
  | 'roles:write'
  | 'contacts:read'
  | 'contacts:write'
  | 'contacts:import'
  | 'sessions:read'
  | 'sessions:write'
  | 'sessions:launch'
  | 'sessions:archive'
  | 'campaigns:read'
  | 'campaigns:write'
  | 'templates:read'
  | 'templates:write'
  | 'reports:read'
  | 'reports:export'
  | 'ai:use'
  | 'settings:read'
  | 'settings:write'
  | 'responses:write';

/** Only two product session types — no focus groups. */
export type SessionType = 'one_on_one' | 'survey';

export type SessionStatus =
  | 'draft'
  | 'scheduled'
  | 'ongoing'
  | 'completed'
  | 'archived';

/** Board filter chips (per column). */
export type SessionBoardFilter =
  | 'ongoing'
  | 'favorites'
  | 'scheduled'
  | 'drafts'
  | 'completed'
  | 'archived';

export type CampaignType = 'recurring' | 'linked' | 'independent';

export type HealthStatus = 'on_track' | 'behind' | 'done' | 'no_schedule';

export type SessionSortBy = 'endAt' | 'startAt' | 'updatedAt' | 'title' | 'custom';

/**
 * Create-session wizard steps (flowchart S1–S6).
 * Resume draft by jumping to wizardStep.
 */
export type WizardStep =
  | 'choose_type'
  | 'describe'
  | 'verify'
  | 'participants'
  | 'reports'
  | 'schedule';

export type CreateEntryMode = 'blank' | 'goal_first' | 'quick_create';

export const WIZARD_STEPS: { id: WizardStep; number: number; title: string; blurb: string }[] = [
  {
    id: 'choose_type',
    number: 1,
    title: 'Choose Session Type',
    blurb: 'Select the type of session that best fits your needs.',
  },
  {
    id: 'describe',
    number: 2,
    title: 'Describe Session',
    blurb: 'Goals, tone, and AI prompt builder.',
  },
  {
    id: 'verify',
    number: 3,
    title: 'Verify & Customize',
    blurb: 'Review topics, settings, and draft.',
  },
  {
    id: 'participants',
    number: 4,
    title: 'Select Participants',
    blurb: 'Add from contacts, groups, or CSV.',
  },
  {
    id: 'reports',
    number: 5,
    title: 'Build Reports',
    blurb: 'Choose or create a report template.',
  },
  {
    id: 'schedule',
    number: 6,
    title: 'Schedule & Launch',
    blurb: 'Set timing and go live.',
  },
];

export interface Organization {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

export interface User {
  id: string;
  orgId: string;
  email: string;
  name: string;
  roleId: string;
  locale: string;
  createdAt: string;
}

export interface Role {
  id: string;
  orgId: string;
  name: string;
  permissions: PermissionKey[];
}

/** Denormalized counters for board cards — do not join responses on list. */
export interface SessionProgress {
  invited: number;
  completed: number;
  percent: number;
  health: HealthStatus;
}

export interface SessionTopic {
  id: string;
  title: string;
  order: number;
}

export interface FeedbackSession {
  id: string;
  orgId: string;
  title: string;
  type: SessionType;
  status: SessionStatus;
  startAt: string | null;
  endAt: string | null;
  createdBy: string;
  createdByName: string;
  campaignId: string | null;
  progress: SessionProgress;
  favorite: boolean;
  participantCount: number;
  topics: SessionTopic[];
  goalPrompt: string | null;
  /** Wizard resume pointer */
  wizardStep: WizardStep;
  entryMode: CreateEntryMode;
  tone: string | null;
  reportTemplateId: string | null;
  participantIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateSessionDraftInput {
  type?: SessionType;
  title?: string;
  entryMode?: CreateEntryMode;
  goalPrompt?: string | null;
  wizardStep?: WizardStep;
}

export interface UpdateSessionDraftInput {
  title?: string;
  type?: SessionType;
  goalPrompt?: string | null;
  tone?: string | null;
  topics?: SessionTopic[];
  wizardStep?: WizardStep;
  participantIds?: string[];
  reportTemplateId?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  status?: SessionStatus;
}

export interface SessionListQuery {
  type?: SessionType;
  filter?: SessionBoardFilter;
  sortBy?: SessionSortBy;
  search?: string;
  limit?: number;
}

export interface SessionListResponse {
  items: FeedbackSession[];
  columns: {
    one_on_one: FeedbackSession[];
    survey: FeedbackSession[];
  };
}

export interface Campaign {
  id: string;
  orgId: string;
  title: string;
  type: CampaignType;
  status: SessionStatus;
  startAt: string | null;
  endAt: string | null;
  createdBy: string;
  sessionsCompleted: number;
  sessionsTotal: number;
  percent: number;
  health: HealthStatus;
  createdAt: string;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ApiHealth {
  status: 'ok' | 'degraded';
  service: string;
  mongo: 'up' | 'down' | 'unknown';
  redis: 'up' | 'down' | 'unknown';
  timestamp: string;
}

export function sessionFilterToQuery(filter: SessionBoardFilter): {
  status?: SessionStatus;
  favorite?: boolean;
} {
  switch (filter) {
    case 'ongoing':
      return { status: 'ongoing' };
    case 'scheduled':
      return { status: 'scheduled' };
    case 'drafts':
      return { status: 'draft' };
    case 'completed':
      return { status: 'completed' };
    case 'archived':
      return { status: 'archived' };
    case 'favorites':
      return { favorite: true };
    default:
      return {};
  }
}

export function nextWizardStep(current: WizardStep): WizardStep | null {
  const idx = WIZARD_STEPS.findIndex((s) => s.id === current);
  if (idx < 0 || idx >= WIZARD_STEPS.length - 1) return null;
  return WIZARD_STEPS[idx + 1].id;
}

export function wizardStepPath(sessionId: string, step: WizardStep): string {
  return `/sessions/create/${sessionId}/${step}`;
}

export interface Contact {
  id: string;
  orgId: string;
  name: string;
  email: string;
  department: string | null;
  groupIds: string[];
  contactType: 'employee' | 'external';
  createdAt: string;
}

export interface ContactGroup {
  id: string;
  orgId: string;
  name: string;
  memberCount: number;
  createdAt: string;
}

export interface ReportTemplate {
  id: string;
  orgId: string | null;
  name: string;
  description: string;
  kind: 'summary' | 'themes' | 'scores' | 'custom';
  sessionTypes: SessionType[];
}

export interface GenerateTopicsInput {
  goalPrompt: string;
  type: SessionType;
  tone?: string | null;
  title?: string | null;
}

export interface GenerateTopicsResult {
  topics: SessionTopic[];
  source: 'heuristic' | 'openai';
}

export interface SessionJoinInfo {
  id: string;
  title: string;
  type: SessionType;
  status: SessionStatus;
  topics: SessionTopic[];
  startAt: string | null;
  endAt: string | null;
  joinPath: string;
}

export interface LaunchSessionResult {
  session: FeedbackSession;
  joinUrl: string;
  joinPath: string;
}

export function sessionJoinPath(session: Pick<FeedbackSession, 'id' | 'type'>): string {
  if (session.type === 'survey') return `/survey/join/${session.id}`;
  return `/one-on-one/join/${session.id}`;
}
