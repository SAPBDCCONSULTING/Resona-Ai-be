/**
 * Resona AI Knowledge Base — curated product facts injected into chat system prompts.
 * Keep entries short and factual. Tag surfaces that should see each article.
 */

import type { KbSurface } from '@pulsefeedback/shared';

/** Re-exported so existing `import { type KbSurface } from './resona.knowledge'` call sites keep working unchanged. */
export type { KbSurface };

export type KbArticle = {
  id: string;
  title: string;
  surfaces: KbSurface[];
  /** Free-text keywords for light retrieval against the latest user message. */
  keywords: string[];
  body: string;
};

export const RESONA_KNOWLEDGE_BASE: KbArticle[] = [
  {
    id: 'product-overview',
    title: 'What Resona AI is',
    surfaces: ['assistant', 'describe'],
    keywords: ['resona', 'what is', 'product', 'platform', 'feedback'],
    body: `Resona AI is an HR feedback platform. Leaders create Sessions (1:1 discussions or surveys), invite employees, collect responses, and review progress on a board. Programs can group multiple sessions. There are no Focus Groups in this product.`,
  },
  {
    id: 'session-types',
    title: 'Session types',
    surfaces: ['assistant', 'describe', 'topics'],
    keywords: ['1:1', 'one on one', 'survey', 'session type', 'focus group'],
    body: `Only two session types exist:
- one_on_one — private AI-facilitated topic-guided chat with each employee
- survey — employees answer topics via a form (no chat)
Never suggest Focus Groups.`,
  },
  {
    id: 'wizard-steps',
    title: 'Create Session wizard (S1–S6)',
    surfaces: ['assistant', 'describe'],
    keywords: ['wizard', 'create', 'steps', 'describe', 'verify', 'launch', 'participants'],
    body: `Session creation wizard:
S1 Choose type — 1:1 or Survey. Quick create copies an existing session's configuration (goal, tone, topics, report template, invite/welcome copy) into the new draft for editing on Verify — it does not change the source session, and does not copy participants. Ask the guide shortcut is also available.
S2 Describe — Duration + Select Template + prompt → Submit → Conversation coach → topics
S3 Verify & Customize — admin/participant titles, topic pills, metrics, invite email, welcome message
S4 Select Participants — database, groups, or CSV upload
S5 Build Reports — pick or skip a report template
S6 Schedule & Launch — checklist, anonymous toggle, Launch Now or schedule dates`,
  },
  {
    // Grounded directly in schemas/report-template.schema.ts's `kind` enum and
    // the seeded report templates — do not add kinds beyond what the schema supports.
    id: 'build-reports',
    title: 'Build Reports step (S5)',
    surfaces: ['assistant', 'describe'],
    keywords: ['report', 'reports', 'build reports', 'summary', 'themes', 'scores', 'template', 'kind'],
    body: `S5 Build Reports lets HR attach a report template to the session, or skip it — attaching one is optional.
A report template has a kind: summary, themes, scores, or custom.
- summary — a high-level write-up with themes, quotes, and recommended actions.
- themes — clustered themes with frequency and sentiment.
- scores — numeric scores and trend-ready metrics (used for surveys).
- custom — an org-defined report shape.`,
  },
  {
    id: 'session-lifecycle',
    title: 'Session status lifecycle',
    surfaces: ['assistant'],
    keywords: ['status', 'draft', 'scheduled', 'ongoing', 'completed', 'lifecycle'],
    body: `Statuses: draft → scheduled → ongoing → completed (archived later).
Launch with future startAt → scheduled; start now/past → ongoing.
Soft-activate flips scheduled → ongoing when startAt is reached.`,
  },
  {
    id: 'describe-coach-rules',
    title: 'Describe Session coach behavior',
    surfaces: ['describe'],
    keywords: ['goal', 'tone', 'team', 'topics', 'duration', 'template'],
    body: `You help HR design ONE session.
Required, one question at a time, in order: goal → team size → tone (supportive|neutral|direct) → optional focus.
Duration options map to topic counts: 10–15 min≈3, 20–30≈5, 30–45≈6.
Templates (session-templates API) can seed goal + topics.
If the user volunteers topics to avoid, or desired outputs (e.g. a summary, specific metrics), acknowledge and retain them in the draft — these are optional context, never a required question, and never block readiness.
When goal + team size + tone exist: readyToGenerate=true, one short “All set — Continue” line, empty suggestions. Never loop summaries.`,
  },
  {
    id: 'tones',
    title: 'Allowed tones',
    surfaces: ['describe', 'topics', 'employee_discussion'],
    keywords: ['tone', 'supportive', 'neutral', 'direct'],
    body: `Allowed tones: supportive, neutral, direct. Map “warm” → supportive.`,
  },
  {
    id: 'employee-1on1',
    title: 'Employee 1:1 AI chat',
    surfaces: ['employee_discussion', 'assistant'],
    keywords: ['employee', 'chat', 'facilitator', 'conversation', 'join'],
    body: `Employees join via /one-on-one/join/:id, start a Conversation, and chat topic-by-topic.
Stay on one topic until covered, then advance. Do not discuss salary, medical diagnoses, or legal advice.
On agenda complete, summaries become the Response and board progress updates.`,
  },
  {
    id: 'survey-participation',
    title: 'Survey participation',
    surfaces: ['assistant'],
    keywords: ['survey', 'submit', 'form', 'responses'],
    body: `Surveys use HTTP form submit (POST /api/sessions/:id/responses), not chat. One response per employee.`,
  },
  {
    id: 'participants-contacts',
    title: 'Participants & contacts',
    surfaces: ['assistant'],
    keywords: ['participant', 'contact', 'invite', 'audience', 'anonymous', 'group', 'groups', 'csv', 'database'],
    body: `People come from Contacts, selected three ways on Select Participants: searching the contacts database, filtering by group, or importing a CSV. Audience under 5 weakens anonymity and themes. Anonymous mode hides names in views when enabled at launch.`,
  },
  {
    id: 'campaigns',
    title: 'Programs',
    surfaces: ['assistant'],
    keywords: ['program', 'programs', 'campaign', 'recurring', 'linked', 'independent'],
    body: `Programs orchestrate sessions: independent, linked, or recurring. They are not a session type. Open Programs in the sidebar.`,
  },
  {
    id: 'navigation',
    title: 'Dashboard navigation',
    surfaces: ['assistant'],
    keywords: ['where', 'how do i', 'settings', 'templates', 'contacts', 'sidebar'],
    body: `Sidebar: Today, Sessions, Programs, Contacts, Templates, Settings.
Create session: Sessions → New. Templates stores session outlines and report templates. Settings holds org profile, users, roles, AI guardrails.`,
  },
  {
    id: 'guardrails',
    title: 'Safety guardrails',
    surfaces: ['describe', 'assistant', 'employee_discussion', 'topics'],
    keywords: ['salary', 'medical', 'pii', 'privacy', 'blocked', 'safe'],
    body: `Never coach users to collect salary negotiations, medical diagnoses, protected health details, or personal finances.
Respect org blockedTopics and aiSystemPrompt when provided.
Keep language professional and concise.`,
  },
  {
    id: 'topic-quality',
    title: 'Good discussion topics',
    surfaces: ['topics', 'describe'],
    keywords: ['topic', 'generate', 'question', 'prompt'],
    body: `Topics should be short (under ~12 words), specific, non-leading, and safe for workplace feedback.
Prefer experience and support themes over performance judgment or compensation.`,
  },
];

export function articlesForSurface(surface: KbSurface): KbArticle[] {
  return RESONA_KNOWLEDGE_BASE.filter((a) => a.surfaces.includes(surface));
}
