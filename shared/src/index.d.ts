export type PermissionKey = 'org:read' | 'org:write' | 'users:read' | 'users:write' | 'roles:read' | 'roles:write' | 'contacts:read' | 'contacts:write' | 'contacts:import' | 'sessions:read' | 'sessions:write' | 'sessions:launch' | 'sessions:archive' | 'campaigns:read' | 'campaigns:write' | 'templates:read' | 'templates:write' | 'reports:read' | 'reports:export' | 'ai:use' | 'settings:read' | 'settings:write' | 'responses:write';
export type SessionType = 'one_on_one' | 'survey';
export type SessionStatus = 'draft' | 'scheduled' | 'ongoing' | 'completed' | 'archived';
export type SessionBoardFilter = 'ongoing' | 'favorites' | 'scheduled' | 'drafts' | 'completed' | 'archived';
export type CampaignType = 'recurring' | 'linked' | 'independent';
export type HealthStatus = 'on_track' | 'behind' | 'done' | 'no_schedule';
export type SessionSortBy = 'endAt' | 'startAt' | 'updatedAt' | 'title' | 'custom';
export type WizardStep = 'choose_type' | 'describe' | 'verify' | 'participants' | 'reports' | 'schedule';
export type CreateEntryMode = 'blank' | 'goal_first' | 'quick_create';
export declare const WIZARD_STEPS: {
    id: WizardStep;
    number: number;
    title: string;
    blurb: string;
}[];
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
    createdByName: string;
    cadence: string | null;
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
    cadence?: string | null;
    sessionTemplateId?: string | null;
    sessionCount?: number;
    sessionType?: SessionType;
    startAt?: string | null;
    endAt?: string | null;
}
export interface UpdateCampaignInput {
    title?: string;
    cadence?: string | null;
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
export declare function sessionFilterToQuery(filter: SessionBoardFilter): {
    status?: SessionStatus;
    favorite?: boolean;
};
export declare function nextWizardStep(current: WizardStep): WizardStep | null;
export declare function wizardStepPath(sessionId: string, step: WizardStep): string;
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
export declare function sessionJoinPath(session: Pick<FeedbackSession, 'id' | 'type'>): string;
