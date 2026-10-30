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
  | 'responses:write'
  | 'kb:read'
  | 'kb:write'
  | 'kb:publish'
  | 'kb:archive'
  | 'kb:web_manage'
  | 'kb:web_ingest'
  | 'kb:collections_manage'
  | 'kb:feedback_manage'
  | 'kb:delete';

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
  /** 'custom' for roles created in Roles & Permissions; absent on older API responses. */
  roleKind?: 'system' | 'custom';
  /** False when the caller may not change this user's role (self, or a role beyond their authority). */
  canChangeRole?: boolean;
  /** Why `canChangeRole` is false, for display. */
  roleChangeBlockedReason?: string | null;
}

export interface AssignUserRoleInput {
  roleId: string;
}

export interface Role {
  id: string;
  orgId: string;
  name: string;
  permissions: PermissionKey[];
  /** 'custom' for roles created in Roles & Permissions; absent on older API responses. */
  kind?: 'system' | 'custom';
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
  /**
   * Knowledge Base collections (KnowledgeCollectionRecord ids) the Describe
   * Session AI coach/topic-generation should scope its retrieval to. Empty
   * = no scoping, the pre-existing default (every published, eligible
   * source for the 'describe'/'topics' surfaces). Never applies to the
   * live employee_discussion facilitator, which has no document retrieval
   * at all by design.
   */
  knowledgeCollectionIds: string[];
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
  /** See FeedbackSession.knowledgeCollectionIds doc. */
  knowledgeCollectionIds?: string[];
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

/** Stored gender values — the dashboard form and the API both validate against this list. */
export const CONTACT_GENDERS = ['female', 'male', 'non_binary', 'prefer_not_to_say'] as const;

export type ContactGender = (typeof CONTACT_GENDERS)[number];

export const CONTACT_GENDER_LABELS: Record<ContactGender, string> = {
  female: 'Female',
  male: 'Male',
  non_binary: 'Non-binary',
  prefer_not_to_say: 'Prefer not to say',
};

/** IANA identifiers look like "Area/Location" (e.g. Asia/Kolkata); "UTC" is the one bare name allowed. */
export const IANA_TIMEZONE_PATTERN = /^(UTC|[A-Za-z_]+(\/[A-Za-z0-9_+-]+)+)$/;

/** Preferred-language options, stored by their ISO 639-1 code. English first, then A–Z. */
export const CONTACT_LANGUAGE_LABELS = {
  en: 'English',
  ar: 'Arabic',
  bn: 'Bengali',
  zh: 'Chinese (Mandarin)',
  nl: 'Dutch',
  fr: 'French',
  de: 'German',
  gu: 'Gujarati',
  hi: 'Hindi',
  id: 'Indonesian',
  it: 'Italian',
  ja: 'Japanese',
  kn: 'Kannada',
  ko: 'Korean',
  ml: 'Malayalam',
  mr: 'Marathi',
  pt: 'Portuguese',
  pa: 'Punjabi',
  ru: 'Russian',
  es: 'Spanish',
  ta: 'Tamil',
  te: 'Telugu',
  tr: 'Turkish',
  ur: 'Urdu',
} as const;

export type ContactLanguage = keyof typeof CONTACT_LANGUAGE_LABELS;

export const CONTACT_LANGUAGES = Object.keys(CONTACT_LANGUAGE_LABELS) as ContactLanguage[];

/**
 * A date of birth is a calendar date kept as "YYYY-MM-DD" text, never a timestamp,
 * so it reads the same in every timezone. Valid means: a real date, 1900 or later,
 * and not after today anywhere in the world (UTC+14 is the furthest-ahead zone).
 */
export function isValidDateOfBirth(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const real =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  if (!real || year < 1900) return false;
  const latestToday = new Date(Date.now() + 14 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return value <= latestToday;
}

export interface Contact {
  id: string;
  orgId: string;
  name: string;
  email: string;
  department: string | null;
  /** The five profile fields are required on create; null only on older or imported contacts. */
  designation: string | null;
  /** IANA identifier, e.g. "Asia/Kolkata". */
  timezone: string | null;
  city: string | null;
  country: string | null;
  gender: ContactGender | null;
  /** Optional. Calendar date as "YYYY-MM-DD". */
  dateOfBirth: string | null;
  /** Optional. */
  preferredLanguage: ContactLanguage | null;
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
  /** See FeedbackSession.knowledgeCollectionIds doc. Empty/absent = default (unscoped) retrieval. */
  knowledgeCollectionIds?: string[];
}

export interface GenerateTopicsResult {
  topics: SessionTopic[];
  source: 'heuristic' | 'openai';
  /**
   * Evidence actually used to ground these topics, when any was retrieved
   * (OpenAI path only — the heuristic fallback never queries the knowledge
   * base). Optional and additive, same contract as AiCitation elsewhere.
   */
  citations?: AiCitation[];
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
  /** See FeedbackSession.knowledgeCollectionIds doc. Empty/absent = default (unscoped) retrieval. */
  knowledgeCollectionIds?: string[];
}

export interface SessionChatTurnResult {
  assistantMessage: string;
  draft: SessionChatDraft;
  readyToGenerate: boolean;
  /** Quick-reply chips for the HR Describe coach UI. */
  suggestions?: string[];
  /**
   * Evidence actually used to ground this coaching turn, when any was
   * retrieved (OpenAI path only). Optional and additive, same contract as
   * AiCitation elsewhere.
   */
  citations?: AiCitation[];
}

export interface AssistantChatTurnInput {
  messages: SessionChatMessage[];
  pageHint?: string | null;
}

/**
 * Provenance for one piece of evidence an AI answer was actually grounded
 * in. Always derived from a re-verified, authorized, published source at
 * the moment of the response — never fabricated, and never present merely
 * because a source's title appeared somewhere in a prompt.
 *
 * `kind: 'curated_kb'` — a static article shipped with the backend.
 * sourceId is that article's stable string id; there is no version or
 * chunk because the whole article is the unit of evidence.
 *
 * `kind: 'uploaded_document'` — an org's own published KnowledgeSource.
 * sourceId is its Mongo _id as a string; sourceVersion and chunkId
 * identify exactly which version/chunk backed this answer.
 */
export interface AiCitation {
  kind: 'curated_kb' | 'uploaded_document';
  sourceId: string;
  sourceTitle: string;
  sourceVersion: number | null;
  chunkId: string | null;
}

export interface AssistantChatTurnResult {
  assistantMessage: string;
  source: 'openai' | 'heuristic';
  /**
   * Evidence actually used to ground this answer, when any was retrieved.
   * Optional and additive — absent or empty means no specific source was
   * retrieved for this query, not that the answer is wrong; existing
   * consumers that don't read this field are unaffected.
   */
  citations?: AiCitation[];
  /**
   * Present only when assistantMessage is a conflict/uncertainty response
   * (two or more eligible sources disagree and recency metadata didn't
   * clearly resolve it) rather than an answer. `citations` is absent in
   * this case — the point is that this turn deliberately did NOT pick one
   * side of a conflicting source set. Optional and additive; a consumer
   * that ignores it still sees a safe, readable assistantMessage.
   */
  conflict?: { sourceTitles: string[] };
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

/**
 * Which AI surfaces a knowledge article/document is eligible to ground.
 * Authoritative definition — the curated static KB (resona.knowledge.ts,
 * backend-only) re-exports this rather than defining its own copy.
 */
export type KbSurface = 'describe' | 'assistant' | 'employee_discussion' | 'topics';

/**
 * 'superseded' is distinct from 'archived': superseded means a specific
 * newer source now replaces this one (supersededBySourceId is set);
 * archived means it was manually retired with no designated replacement.
 * Both are terminal and excluded from AI retrieval the same way.
 *
 * 'deleted' is a further, one-way step past archived/superseded/failed: an
 * explicit, confirmed deletion has removed this source's chunks (and their
 * embeddings) and its underlying file, leaving only a minimal tombstone
 * (title, status, who/when deleted) so existing references to this exact
 * source id — a KnowledgeAuditEvent or a KnowledgeFeedback citation — keep
 * resolving to something inspectable instead of a dangling id. There is no
 * path back from 'deleted'.
 */
export type KnowledgeSourceStatus =
  | 'processing'
  | 'pending_review'
  | 'published'
  | 'superseded'
  | 'archived'
  | 'failed'
  | 'deleted';

/**
 * Governance category for an uploaded document. Independent of `surfaces`
 * (which AI path may ground on it) — a collection is "what kind of
 * document is this for people browsing the KB," not an AI-routing concern.
 */
export type KnowledgeCollection =
  | 'hr_people'
  | 'company_policies'
  | 'product_process'
  | 'it_security'
  | 'customer_support'
  | 'approved_templates';

export const KNOWLEDGE_COLLECTIONS: KnowledgeCollection[] = [
  'hr_people',
  'company_policies',
  'product_process',
  'it_security',
  'customer_support',
  'approved_templates',
];

export const KNOWLEDGE_COLLECTION_LABELS: Record<KnowledgeCollection, string> = {
  hr_people: 'HR & People',
  company_policies: 'Company Policies',
  product_process: 'Product & Process',
  it_security: 'IT & Security',
  customer_support: 'Customer Support',
  approved_templates: 'Approved Templates',
};

/**
 * A managed collection record — the governance layer `KnowledgeSource.category`
 * alone doesn't provide (no name/description management, no archival of the
 * collection itself, no visibility into how many sources use it). Deliberately
 * kept separate from `category` (which stays a simple, unchanged per-source
 * tag) and from `accessRoleIds`/`surfaces` (access control and AI routing are
 * not collection concerns). Archiving a collection record never touches any
 * KnowledgeSource that already has that category — it only blocks *new*
 * sources from being assigned to it going forward.
 */
export type KnowledgeCollectionStatus = 'active' | 'archived';

export interface KnowledgeCollectionRecord {
  id: string;
  orgId: string;
  key: KnowledgeCollection;
  name: string;
  description: string | null;
  status: KnowledgeCollectionStatus;
  /** Count of KnowledgeSources currently tagged with this collection's key — informational, computed at read time. */
  sourceCount: number;
  createdBy: string;
  archivedBy: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateKnowledgeCollectionInput {
  key: KnowledgeCollection;
  name?: string;
  description?: string | null;
}

export interface UpdateKnowledgeCollectionInput {
  name?: string;
  description?: string | null;
}

export interface KnowledgeCollectionListResponse {
  items: KnowledgeCollectionRecord[];
}

/** Metadata for one uploaded document. Content lives separately in KnowledgeChunk rows. */
export interface KnowledgeSource {
  id: string;
  orgId: string;
  title: string;
  description: string | null;
  status: KnowledgeSourceStatus;
  uploadedBy: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  surfaces: KbSurface[];
  /** Safe, non-sensitive failure summary only — never raw extraction errors or content. */
  processingError: string | null;
  version: number;
  publishedBy: string | null;
  publishedAt: string | null;
  archivedBy: string | null;
  archivedAt: string | null;
  /** Person responsible for this document's accuracy/upkeep. Person-level only — see report for why there is no team/department dimension. */
  ownerUserId: string | null;
  category: KnowledgeCollection | null;
  /**
   * Role ids (this org's own Role documents) allowed to have this source
   * ground their AI answers, in addition to the existing org+published+
   * surface rules. Empty array = unrestricted (every role with ai:use can
   * be grounded by it) — the default, and the only behavior that existed
   * before this field was added, so existing sources are unaffected.
   */
  accessRoleIds: string[];
  /** Null = effective immediately. */
  effectiveAt: string | null;
  /** Null = never expires. */
  expiresAt: string | null;
  /** Informational reminder date only — not enforced at retrieval. */
  reviewDueAt: string | null;
  /** Set when this source was uploaded as the designated replacement for another. */
  supersedesSourceId: string | null;
  /** Set when another source has been marked as this one's replacement. */
  supersededBySourceId: string | null;
  supersededBy: string | null;
  supersededAt: string | null;
  /** Set only once status reaches 'deleted' — see KnowledgeSourceStatus doc. */
  deletedBy: string | null;
  deletedAt: string | null;
  /** See MalwareScanStatus doc — 'not_scanned' in this deployment today, always. */
  malwareScanStatus: MalwareScanStatus;
  createdAt: string;
  updatedAt: string;
}

/** Deletion is explicit and irreversible, so the caller must affirmatively confirm it — see KnowledgeSourceStatus doc on what 'deleted' means. */
export interface DeleteKnowledgeSourceInput {
  confirm: true;
}

/**
 * 'not_scanned' is the honest default and, in this deployment, the only
 * value ever actually produced today — there is no antivirus/malware
 * scanner wired in (see the backend's MalwareScanProvider doc). This field
 * exists so nothing ever silently implies "this file was checked and is
 * safe" when it was not; a UI showing this should treat 'not_scanned' as
 * a visible caveat, not hide it.
 */
export type MalwareScanStatus = 'not_scanned' | 'clean' | 'infected' | 'scan_failed';

export interface UpdateKnowledgeSourceInput {
  title?: string;
  description?: string | null;
  surfaces?: KbSurface[];
  ownerUserId?: string | null;
  category?: KnowledgeCollection | null;
  accessRoleIds?: string[];
  effectiveAt?: string | null;
  expiresAt?: string | null;
  reviewDueAt?: string | null;
}

export interface SupersedeKnowledgeSourceInput {
  supersededBySourceId: string;
}

export interface KnowledgeSourceListResponse {
  items: KnowledgeSource[];
}

export type KnowledgeAuditAction =
  | 'uploaded'
  | 'duplicate_upload'
  | 'processing_failed'
  | 'metadata_updated'
  | 'published'
  | 'archived'
  | 'superseded'
  | 'reprocessed'
  | 'web_approval_created'
  | 'web_approval_revoked'
  | 'web_ingest_blocked'
  | 'collection_created'
  | 'collection_updated'
  | 'collection_archived'
  | 'feedback_submitted'
  | 'feedback_status_changed'
  | 'embeddings_reindexed'
  | 'deleted';

/**
 * A single governance event, for a KnowledgeSource OR a web approval
 * change. sourceId is null for an approval-management event (nothing was
 * ingested) and for a blocked ingest attempt (no source was ever
 * created) — approvalId then carries the relevant id inside metadata.
 * Never carries document content, URLs with sensitive query strings, or
 * raw errors — see KnowledgeAuditEvent.metadata limits in the backend
 * service.
 */
export interface KnowledgeAuditEvent {
  id: string;
  orgId: string;
  sourceId: string | null;
  actorUserId: string;
  action: KnowledgeAuditAction;
  /** Short, safe, human-readable outcome — never raw error text or content. */
  outcome: string;
  metadata: Record<string, string | number | boolean | null> | null;
  createdAt: string;
}

export interface KnowledgeAuditLogResponse {
  items: KnowledgeAuditEvent[];
}

/**
 * Only an admin-curated allowlist entry makes a URL eligible for
 * ingestion — the ingest endpoint never fetches an arbitrary caller-
 * supplied URL directly, only one that matches an active entry here.
 *
 * 'exact_url': the full normalized URL (scheme+host+port+path+query) must
 * match exactly — only that one page.
 * 'domain': scheme+host+port must match exactly; path/query are not
 * compared, so this covers any page on that exact origin. Deliberately
 * never implies a subdomain, a different scheme, or a different port —
 * each must be its own separate entry.
 */
export type WebApprovalType = 'exact_url' | 'domain';

export interface KnowledgeWebApproval {
  id: string;
  orgId: string;
  type: WebApprovalType;
  value: string;
  status: 'active' | 'revoked';
  createdBy: string;
  createdAt: string;
  revokedBy: string | null;
  revokedAt: string | null;
}

export interface CreateWebApprovalInput {
  type: WebApprovalType;
  value: string;
}

export interface WebApprovalListResponse {
  items: KnowledgeWebApproval[];
}

export interface IngestApprovedWebPageInput {
  url: string;
  title?: string;
  description?: string | null;
  surfaces?: KbSurface[];
  ownerUserId?: string | null;
  category?: KnowledgeCollection | null;
  accessRoleIds?: string[];
  effectiveAt?: string | null;
  expiresAt?: string | null;
  reviewDueAt?: string | null;
}

/** One bounded slice of extracted text from a KnowledgeSource. */
export interface KnowledgeChunk {
  id: string;
  orgId: string;
  sourceId: string;
  sourceVersion: number;
  chunkIndex: number;
  text: string;
  charCount: number;
  /** Nearest preceding heading, when the source actually had one — never fabricated. */
  section: string | null;
  /** Null for plain text/Markdown (no real pagination); reserved for future formats. */
  page: number | null;
  createdAt: string;
}

export interface KnowledgeChunkListResponse {
  items: KnowledgeChunk[];
}

// ---------------------------------------------------------------------
// Answer feedback and knowledge-owner routing
// ---------------------------------------------------------------------

export type KnowledgeFeedbackRating = 'helpful' | 'not_helpful';
export type KnowledgeFeedbackIssueType = 'incorrect' | 'outdated' | 'conflicting' | 'missing';
export type KnowledgeFeedbackStatus = 'open' | 'reviewing' | 'resolved' | 'dismissed';

/**
 * Deliberately does NOT store the full prompt, full answer, or document
 * content — only structural references (which source/chunk/version, which
 * surface) plus whatever short, bounded explanation the person themselves
 * chose to type. `routed: false` means no owner was configured for the
 * referenced source — this is never fabricated; it goes to the shared
 * fallback queue (visible to anyone with kb:feedback_manage) instead of a
 * specific person.
 */
export interface KnowledgeFeedback {
  id: string;
  orgId: string;
  actorUserId: string;
  rating: KnowledgeFeedbackRating | null;
  issueType: KnowledgeFeedbackIssueType | null;
  /** Short, user-authored explanation only — never the AI's own answer text. */
  explanation: string | null;
  surface: KbSurface | null;
  /** Opaque, client-supplied identifier for the specific answer/turn this is about — used only for duplicate-submission detection and display correlation, never trusted for authorization. */
  answerRef: string | null;
  citationSourceId: string | null;
  citationSourceVersion: number | null;
  citationChunkId: string | null;
  status: KnowledgeFeedbackStatus;
  /** Snapshot of the source's configured owner at submission time, or null if none was configured (routed === false). */
  ownerUserId: string | null;
  routed: boolean;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SubmitKnowledgeFeedbackInput {
  rating?: KnowledgeFeedbackRating;
  issueType?: KnowledgeFeedbackIssueType;
  explanation?: string;
  surface?: KbSurface;
  answerRef?: string;
  citationSourceId?: string;
  citationSourceVersion?: number;
  citationChunkId?: string;
}

export interface ResolveKnowledgeFeedbackInput {
  status: KnowledgeFeedbackStatus;
  resolutionNote?: string | null;
}

export interface KnowledgeFeedbackListResponse {
  items: KnowledgeFeedback[];
}

export * from './permission-registry';
