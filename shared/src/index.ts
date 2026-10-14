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

/** Only meaningful when type === 'recurring'. unlinked = same session repeats; linked = whole chain repeats each cycle. */
export type CampaignRecurringMode = 'unlinked' | 'linked';

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
  address: string | null;
  country: string | null;
  description: string | null;
  website: string | null;
  domain: string | null;
  phone: string | null;
  timezone: string | null;
  foundedYear: string | null;
  logoUrl: string | null;
  accentColor: string | null;
  accentSoft: string | null;
  tagline: string | null;
  aiSystemPrompt: string | null;
  blockedTopics: string[];
  piiRedactionEnabled: boolean;
  retentionDays: number;
  archiveAfterDays: number;
  softDeleteEnabled: boolean;
  createdAt: string;
}

export interface UpdateOrganizationInput {
  name?: string;
  address?: string | null;
  country?: string | null;
  description?: string | null;
  website?: string | null;
  domain?: string | null;
  phone?: string | null;
  timezone?: string | null;
  foundedYear?: string | null;
  logoUrl?: string | null;
  accentColor?: string | null;
  accentSoft?: string | null;
  tagline?: string | null;
  aiSystemPrompt?: string | null;
  blockedTopics?: string[];
  piiRedactionEnabled?: boolean;
  retentionDays?: number;
  archiveAfterDays?: number;
  softDeleteEnabled?: boolean;
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

/** Settings User Management row — includes role label. */
export interface OrgUser extends User {
  roleName: string;
}

export interface AssignUserRoleInput {
  roleId: string;
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

export interface SessionInvitation {
  subject: string;
  header: string;
  body: string;
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
  /**
   * Resolved User ids for participantIds, computed at launch (Contacts with no linked
   * User account are skipped). Employee-assignment queries key on this, not participantIds.
   */
  assignedUserIds: string[];
  /** Employee-facing title (Verify step). */
  participantTitle: string | null;
  /** Employee-facing description / invite framing. */
  participantDescription: string | null;
  welcomeMessage: string | null;
  anonymous: boolean;
  invitation: SessionInvitation;
  engagementMetrics: string[];
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
  participantTitle?: string | null;
  participantDescription?: string | null;
  welcomeMessage?: string | null;
  anonymous?: boolean;
  invitation?: Partial<SessionInvitation>;
  engagementMetrics?: string[];
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

export interface LinkedSequenceStep {
  id: string;
  title: string;
  order: number;
}

export interface Campaign {
  id: string;
  orgId: string;
  title: string;
  type: CampaignType;
  /** Campaign context. Null on campaigns created before these fields existed. */
  objective: string | null;
  background: string | null;
  targetAudience: string | null;
  intendedDecision: string | null;
  status: SessionStatus;
  startAt: string | null;
  endAt: string | null;
  createdBy: string;
  createdByName: string;
  /** ISO cadence hint for recurring campaigns, e.g. weekly | monthly | quarterly */
  cadence: string | null;
  /** Only meaningful when type === 'recurring'. */
  recurringMode: CampaignRecurringMode | null;
  /** Brief used to AI-draft Step 1 of a linked campaign. */
  masterPrompt: string | null;
  /** Planned steps for a linked campaign (Step 1 -> report -> Step 2 -> ...). */
  linkedSequence: LinkedSequenceStep[];
  sessionTemplateId: string | null;
  sessionsCompleted: number;
  sessionsTotal: number;
  percent: number;
  health: HealthStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignListResponse {
  items: Campaign[];
  columns: {
    recurring: Campaign[];
    linked: Campaign[];
    independent: Campaign[];
  };
}

export interface CreateCampaignInput {
  title: string;
  type: CampaignType;
  objective: string;
  background?: string | null;
  targetAudience?: string | null;
  intendedDecision?: string | null;
  cadence?: string | null;
  /** Only meaningful when type === 'recurring'. */
  recurringMode?: CampaignRecurringMode | null;
  /** Only meaningful when type === 'linked'. */
  masterPrompt?: string | null;
  /** Only meaningful when type === 'linked'. */
  linkedSequence?: LinkedSequenceStep[];
  sessionTemplateId?: string | null;
  /** How many child sessions to spawn on create (recurring default 3). */
  sessionCount?: number;
  sessionType?: SessionType;
  startAt?: string | null;
  endAt?: string | null;
}

export interface UpdateCampaignInput {
  title?: string;
  cadence?: string | null;
  recurringMode?: CampaignRecurringMode | null;
  masterPrompt?: string | null;
  linkedSequence?: LinkedSequenceStep[];
  startAt?: string | null;
  endAt?: string | null;
  status?: SessionStatus;
  sessionTemplateId?: string | null;
}

export interface LaunchCampaignInput {
  startAt?: string | null;
  endAt?: string | null;
}

export interface CampaignDetail extends Campaign {
  sessions: FeedbackSession[];
}

/** Reusable survey / 1:1 outline (topics + goal), distinct from report templates. */
export interface SessionTemplate {
  id: string;
  orgId: string | null;
  name: string;
  description: string;
  sessionType: SessionType;
  goalPrompt: string | null;
  topics: SessionTopic[];
  tone: string | null;
  createdAt: string;
}

export interface CreateSessionTemplateInput {
  name: string;
  description?: string;
  sessionType: SessionType;
  goalPrompt?: string | null;
  topics?: SessionTopic[];
  tone?: string | null;
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
  /** Linked login account, when one exists. Null until an account is created (future task). */
  userId: string | null;
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

export interface SessionChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface SessionChatDraft {
  title?: string | null;
  goalPrompt?: string | null;
  tone?: string | null;
  teamSize?: string | null;
}

export interface SessionChatTurnInput {
  type: SessionType;
  messages: SessionChatMessage[];
  title?: string | null;
}

export interface SessionChatTurnResult {
  assistantMessage: string;
  draft: SessionChatDraft;
  readyToGenerate: boolean;
  /** Quick-reply chips for the HR Describe coach UI. */
  suggestions?: string[];
}

export interface AssistantChatTurnInput {
  messages: SessionChatMessage[];
  pageHint?: string | null;
}

export interface AssistantChatTurnResult {
  assistantMessage: string;
  source: 'openai' | 'heuristic';
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
  /** True when status is ongoing and within the start/end window. */
  acceptingResponses: boolean;
}

export interface ResponseAnswer {
  topicId: string;
  text: string;
}

export interface SessionResponse {
  id: string;
  orgId: string;
  sessionId: string;
  userId: string;
  answers: ResponseAnswer[];
  submittedAt: string;
}

export interface SubmitSessionResponseInput {
  answers: ResponseAnswer[];
}

/** Per-employee 1:1 discussion thread (topic-guided AI chat). */
export type ConversationStatus = 'available' | 'active' | 'completed' | 'expired';

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  topicId?: string | null;
  createdAt: string;
}

export interface ConversationTopicSummary {
  topicId: string;
  text: string;
}

export interface SessionConversation {
  id: string;
  orgId: string;
  sessionId: string;
  userId: string;
  status: ConversationStatus;
  currentTopicIndex: number;
  messages: ConversationMessage[];
  topicSummaries: ConversationTopicSummary[];
  responseId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationChatTurnInput {
  message: string;
}

export interface ConversationChatTurnResult {
  conversation: SessionConversation;
  assistantMessage: string;
  currentTopicIndex: number;
  currentTopicTitle: string | null;
  topicComplete: boolean;
  agendaComplete: boolean;
  /** Present when agenda finished and Response was written. */
  response: SessionResponse | null;
}

/** Employee “My sessions” row. */
export interface EmployeeAssignment {
  id: string;
  title: string;
  type: SessionType;
  status: SessionStatus;
  endAt: string | null;
  topicsCount: number;
  completedByMe: boolean;
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
