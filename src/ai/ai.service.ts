import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  AssistantChatTurnInput,
  AssistantChatTurnResult,
  GenerateTopicsInput,
  GenerateTopicsResult,
  SessionChatDraft,
  SessionChatMessage,
  SessionChatTurnInput,
  SessionChatTurnResult,
  SessionTopic,
} from '@pulsefeedback/shared';
import { randomUUID } from 'crypto';
import {
  KnowledgeBaseService,
  type OrgAiGuardrails,
} from './knowledge/knowledge-base.service';

/**
 * A conversation message carrying which topic it belongs to, when known.
 * This is purely internal plumbing between ConversationsService and AiService
 * (never sent over HTTP as-is), so widening it here doesn't touch any public
 * API or frontend contract.
 */
export type DiscussionMessage = SessionChatMessage & { topicId?: string | null };

export type EmployeeDiscussionContext = {
  title: string;
  goalPrompt: string | null;
  tone: string | null;
  topics: SessionTopic[];
  currentTopicIndex: number;
  messages: DiscussionMessage[];
  orgId?: string | null;
};

export type EmployeeDiscussionTurnResult = {
  assistantMessage: string;
  currentTopicIndex: number;
  topicComplete: boolean;
  agendaComplete: boolean;
  topicSummary: string | null;
};

@Injectable()
export class AiService {
  /**
   * Minimum retrieveScored() score to treat a KB article as real evidence for
   * the assistant's fallback path, not just "eligible for this surface."
   * Base score is 1; a single matched keyword adds 3. So 4 means at least one
   * genuine keyword hit occurred for this specific query.
   */
  private static readonly MIN_ASSISTANT_RELEVANCE_SCORE = 4;

  /** Documented response when neither a blocked-topic nor a grounded match applies. */
  private static readonly UNVERIFIED_FALLBACK =
    "I couldn't verify this from the approved knowledge base.";

  constructor(
    private readonly config: ConfigService,
    private readonly kb: KnowledgeBaseService,
  ) {}

  async generateTopics(
    input: GenerateTopicsInput,
    orgId?: string | null,
  ): Promise<GenerateTopicsResult> {
    const guardrails = await this.kb.getOrgGuardrails(orgId);
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (apiKey) {
      try {
        const topics = await this.fromOpenAi(apiKey, input, guardrails);
        if (topics.length) return { topics, source: 'openai' };
      } catch {
        // fall through to heuristic
      }
    }
    return { topics: this.heuristicTopics(input, guardrails), source: 'heuristic' };
  }

  async chatDescribeTurn(
    input: SessionChatTurnInput,
    orgId?: string | null,
  ): Promise<SessionChatTurnResult> {
    const messages = (input.messages ?? []).slice(-24);
    const guardrails = await this.kb.getOrgGuardrails(orgId);
    const lastUser =
      [...messages].reverse().find((m) => m.role === 'user')?.content ?? null;
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    let result: SessionChatTurnResult | null = null;
    if (apiKey) {
      try {
        result = await this.chatFromOpenAi(
          apiKey,
          input.type,
          messages,
          input.title,
          lastUser,
          guardrails,
        );
      } catch {
        result = null;
      }
    }
    if (!result) {
      result = this.fallbackCoach(messages, input.type, input.title);
    }
    return this.finalizeDescribeResult(result, messages);
  }

  /** Force ready + empty chips once goal/team/tone are present — stops summary loops. */
  private finalizeDescribeResult(
    result: SessionChatTurnResult,
    messages: SessionChatMessage[],
  ): SessionChatTurnResult {
    const userTurns = messages
      .filter((m) => m.role === 'user')
      .map((m) => m.content.trim())
      .filter(Boolean);
    const extracted = this.extractDescribeDraft(userTurns);

    const tone =
      this.normalizeTone(result.draft.tone) ?? extracted.tone;
    const teamSize = result.draft.teamSize?.trim() || extracted.teamSize;
    const goalPrompt =
      result.draft.goalPrompt?.trim() ||
      (extracted.goal && teamSize
        ? `Team of ${teamSize}: ${extracted.goal}${extracted.focus ? `. Focus: ${extracted.focus}` : ''}`
        : extracted.goal);

    const ready =
      Boolean(goalPrompt && teamSize && tone) || result.readyToGenerate;

    if (ready && goalPrompt && teamSize && tone) {
      return {
        assistantMessage: result.readyToGenerate
          ? result.assistantMessage.includes('Continue')
            ? result.assistantMessage
            : 'All set — topics are ready. Click Continue to review them on Verify.'
          : 'All set — topics are ready. Click Continue to review them on Verify.',
        draft: {
          title: result.draft.title || goalPrompt.slice(0, 48),
          goalPrompt,
          tone,
          teamSize,
        },
        readyToGenerate: true,
        suggestions: [],
      };
    }

    return {
      ...result,
      draft: {
        ...result.draft,
        tone: tone ?? result.draft.tone,
        teamSize: teamSize ?? result.draft.teamSize,
        goalPrompt: goalPrompt ?? result.draft.goalPrompt,
      },
      suggestions: result.suggestions ?? [],
    };
  }

  async assistantChatTurn(
    input: AssistantChatTurnInput,
    orgId?: string | null,
  ): Promise<AssistantChatTurnResult> {
    const messages = (input.messages ?? []).slice(-24);
    const guardrails = await this.kb.getOrgGuardrails(orgId);
    const lastUser =
      [...messages].reverse().find((m) => m.role === 'user')?.content ?? null;
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (apiKey) {
      try {
        const text = await this.assistantFromOpenAi(
          apiKey,
          messages,
          input.pageHint ?? null,
          lastUser,
          guardrails,
        );
        if (text) return { assistantMessage: text, source: 'openai' };
      } catch {
        // fall through
      }
    }
    return {
      assistantMessage: this.fallbackAssistant(
        messages,
        input.pageHint ?? null,
        guardrails,
      ),
      source: 'heuristic',
    };
  }

  /**
   * Employee 1:1 facilitator — stay on one topic, advance when covered,
   * finish when all topics have summaries.
   */
  async employeeDiscussionTurn(
    ctx: EmployeeDiscussionContext,
  ): Promise<EmployeeDiscussionTurnResult> {
    const topics = [...(ctx.topics ?? [])].sort((a, b) => a.order - b.order);
    if (!topics.length) {
      return {
        assistantMessage:
          'This session has no discussion topics yet. Please contact your HR admin.',
        currentTopicIndex: 0,
        topicComplete: false,
        agendaComplete: true,
        topicSummary: null,
      };
    }

    const index = Math.min(
      Math.max(ctx.currentTopicIndex ?? 0, 0),
      topics.length - 1,
    );
    const messages = (ctx.messages ?? []).slice(-30);
    const guardrails = await this.kb.getOrgGuardrails(ctx.orgId);
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (apiKey) {
      try {
        const result = await this.discussionFromOpenAi(
          apiKey,
          {
            ...ctx,
            topics,
            currentTopicIndex: index,
            messages,
          },
          guardrails,
        );
        if (result) return this.clampDiscussionResult(result, topics.length, index);
      } catch {
        // fall through
      }
    }
    return this.fallbackDiscussion(topics, index, messages);
  }

  /** Opening line when a 1:1 conversation starts. */
  welcomeDiscussionMessage(ctx: {
    title: string;
    topics: SessionTopic[];
    tone: string | null;
  }): string {
    const topics = [...(ctx.topics ?? [])].sort((a, b) => a.order - b.order);
    const first = topics[0]?.title ?? 'your experience';
    const tone =
      ctx.tone === 'direct'
        ? 'I’ll ask direct questions'
        : ctx.tone === 'neutral'
          ? 'I’ll keep things neutral and open'
          : 'I’ll keep the tone supportive';
    return `Welcome to “${ctx.title}”. ${tone}. We’ll walk through ${topics.length || 1} topic${
      topics.length === 1 ? '' : 's'
    }, one at a time. Let’s start with: “${first}”. What’s on your mind?`;
  }

  private heuristicTopics(
    input: GenerateTopicsInput,
    guardrails: OrgAiGuardrails,
  ): SessionTopic[] {
    const goal = (input.goalPrompt || '').trim();
    const tone = input.tone || 'supportive';
    const typeLabel = input.type === 'survey' ? 'Survey' : '1:1';

    const seeds: string[] = [];
    if (/onboard|belong|new hire/i.test(goal)) {
      seeds.push(
        'First-week experience and clarity',
        'Belonging and peer support',
        'Manager accessibility',
        'Tools and process friction',
      );
    } else if (/engagement|loyalty|nps|pulse/i.test(goal)) {
      seeds.push(
        'What drives loyalty today',
        'What would elevate the experience',
        'Team communication quality',
        'Recognition and growth',
      );
    } else if (/communication|collab/i.test(goal)) {
      seeds.push(
        'Meeting effectiveness',
        'Cross-team handoffs',
        'Feedback culture',
        'Information visibility',
      );
    } else {
      const snippet = goal.slice(0, 80) || `${typeLabel} goals`;
      seeds.push(
        `Context: ${snippet}`,
        'What is working well',
        'Where friction shows up',
        'Actions that would help next',
      );
    }

    if (tone === 'direct') {
      seeds.push('Hard truths we should hear');
    } else if (tone === 'supportive') {
      seeds.push('What support would feel most useful');
    }

    // Deterministically drop any seed that knowingly mentions a configured
    // blocked topic. Narrow, literal substring match only — this must never
    // become a broad/semantic filter that could remove unrelated valid topics.
    const blocked = guardrails.blockedTopics
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    const isSafe = (text: string) =>
      !blocked.some((b) => text.toLowerCase().includes(b));
    let safeSeeds = seeds.filter(isSafe);

    // Top up with goal-independent filler if filtering left too few. These
    // never echo user/goal text, so they can't themselves carry blocked
    // content — they exist purely so a blocked term never silently shrinks
    // the topic count below what the UI expects.
    if (safeSeeds.length < 5) {
      const filler = [
        'What is working well',
        'Where friction shows up',
        'Actions that would help next',
        'Any other feedback to share',
      ].filter((f) => isSafe(f) && !safeSeeds.includes(f));
      safeSeeds = [...safeSeeds, ...filler];
    }

    return safeSeeds.slice(0, 5).map((title, i) => ({
      id: randomUUID(),
      title,
      order: i + 1,
    }));
  }

  private async fromOpenAi(
    apiKey: string,
    input: GenerateTopicsInput,
    guardrails: OrgAiGuardrails,
  ): Promise<SessionTopic[]> {
    const system = this.kb.buildTopicsSystemPrompt({
      query: input.goalPrompt,
      guardrails,
    });
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.get('OPENAI_MODEL', 'gpt-4o-mini'),
        temperature: 0.4,
        messages: [
          { role: 'system', content: system },
          {
            role: 'user',
            content: JSON.stringify({
              type: input.type,
              tone: input.tone,
              title: input.title,
              goal: input.goalPrompt,
            }),
          },
        ],
      }),
    });
    if (!res.ok) throw new Error('OpenAI request failed');
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = data.choices?.[0]?.message?.content ?? '[]';
    const parsed = JSON.parse(
      raw.replace(/```json|```/g, '').trim(),
    ) as string[];
    return parsed.slice(0, 5).map((title, i) => ({
      id: randomUUID(),
      title: String(title),
      order: i + 1,
    }));
  }

  private async chatFromOpenAi(
    apiKey: string,
    type: SessionChatTurnInput['type'],
    messages: SessionChatMessage[],
    title: string | null | undefined,
    query: string | null,
    guardrails: OrgAiGuardrails,
  ): Promise<SessionChatTurnResult | null> {
    const system = this.kb.buildDescribeSystemPrompt({ query, guardrails });
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.get('OPENAI_MODEL', 'gpt-4o-mini'),
        temperature: 0.5,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          {
            role: 'system',
            content: JSON.stringify({
              sessionType: type,
              currentTitle: title ?? null,
            }),
          },
          ...messages.map((m) => ({ role: m.role, content: m.content })),
        ],
      }),
    });
    if (!res.ok) throw new Error('OpenAI chat request failed');
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = data.choices?.[0]?.message?.content ?? '';
    return this.parseChatResult(raw);
  }

  private parseChatResult(raw: string): SessionChatTurnResult | null {
    try {
      const cleaned = raw.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(cleaned) as {
        assistantMessage?: string;
        draft?: SessionChatDraft;
        readyToGenerate?: boolean;
        suggestions?: string[];
      };
      if (!parsed.assistantMessage?.trim()) return null;
      const tone = this.normalizeTone(parsed.draft?.tone);
      const suggestions = Array.isArray(parsed.suggestions)
        ? parsed.suggestions.map((s) => String(s).trim()).filter(Boolean).slice(0, 6)
        : [];
      return {
        assistantMessage: parsed.assistantMessage.trim(),
        draft: {
          title: parsed.draft?.title?.trim() || null,
          goalPrompt: parsed.draft?.goalPrompt?.trim() || null,
          tone,
          teamSize: parsed.draft?.teamSize?.trim() || null,
        },
        readyToGenerate: Boolean(parsed.readyToGenerate),
        suggestions,
      };
    } catch {
      return null;
    }
  }

  private normalizeTone(tone?: string | null): string | null {
    if (!tone) return null;
    const t = tone.toLowerCase().trim();
    if (t === 'supportive' || t === 'neutral' || t === 'direct') return t;
    return null;
  }

  /**
   * Local scripted coach when OpenAI is unavailable.
   *
   * Deliberately not given guardrails/blockedTopics this increment. Its
   * questions are fixed, generic strings (goal → team size → tone → optional
   * focus) that never probe for specific content, so — unlike an LLM — it
   * cannot be steered into soliciting a blocked topic in the first place.
   * The only way to enforce blockedTopics here would be to inspect and
   * potentially reject the user's own free-typed goal text, which changes
   * the required-field sequence and readyToGenerate behavior this task
   * explicitly says to preserve. Reporting this rather than guessing at a
   * workaround; see the Increment 2 report for the exact tradeoff.
   */
  private fallbackCoach(
    messages: SessionChatMessage[],
    type: SessionChatTurnInput['type'],
    title?: string | null,
  ): SessionChatTurnResult {
    const typeLabel = type === 'survey' ? 'survey' : '1:1';
    const userTurns = messages
      .filter((m) => m.role === 'user')
      .map((m) => m.content.trim())
      .filter(Boolean);

    if (userTurns.length === 0) {
      return {
        assistantMessage: `I'll help shape this ${typeLabel} session. What is the main goal or purpose?`,
        draft: emptyDraft(),
        readyToGenerate: false,
        suggestions: [
          'Improve onboarding belonging',
          'Understand engagement drivers',
          'Surface blockers in 1:1s',
        ],
      };
    }

    const extracted = this.extractDescribeDraft(userTurns);
    const shortTitle =
      (title && title !== 'Untitled session' ? title : null) ||
      extracted.goal?.slice(0, 48).trim() ||
      'Feedback session';

    // Already complete → never loop; stay ready.
    if (extracted.goal && extracted.teamSize && extracted.tone) {
      const goalPrompt = [
        `Team of ${extracted.teamSize}: ${extracted.goal}`,
        extracted.focus ? `Focus: ${extracted.focus}` : null,
      ]
        .filter(Boolean)
        .join('. ');
      return {
        assistantMessage:
          'All set — topics are ready. Click Continue to review them on Verify.',
        draft: {
          title: shortTitle,
          goalPrompt,
          tone: extracted.tone,
          teamSize: extracted.teamSize,
        },
        readyToGenerate: true,
        suggestions: [],
      };
    }

    if (!extracted.goal) {
      return {
        assistantMessage: `Got your note. What is the main goal of this ${typeLabel}?`,
        draft: emptyDraft(),
        readyToGenerate: false,
        suggestions: [
          'Improve onboarding belonging',
          'Understand engagement drivers',
          'Surface blockers in 1:1s',
        ],
      };
    }

    if (!extracted.teamSize) {
      return {
        assistantMessage:
          'Got it. Roughly how many people are on the team for this session?',
        draft: {
          ...emptyDraft(),
          goalPrompt: extracted.goal,
        },
        readyToGenerate: false,
        suggestions: ['5–10', '11–25', '26–50', 'All employees'],
      };
    }

    if (!extracted.tone) {
      return {
        assistantMessage:
          'Thanks. What tone should we use — supportive, neutral, or direct?',
        draft: {
          ...emptyDraft(),
          goalPrompt: extracted.goal,
          teamSize: extracted.teamSize,
        },
        readyToGenerate: false,
        suggestions: ['supportive', 'neutral', 'direct'],
      };
    }

    // Unreachable, but keep TypeScript happy
    return {
      assistantMessage: 'All set — click Continue to review topics on Verify.',
      draft: {
        title: shortTitle,
        goalPrompt: extracted.goal,
        tone: extracted.tone,
        teamSize: extracted.teamSize,
      },
      readyToGenerate: true,
      suggestions: [],
    };
  }

  /**
   * Pull goal / team size / tone / focus from free-form user turns
   * (not turn-count), so corrections like "supportive tone" don't restart the script.
   */
  private extractDescribeDraft(userTurns: string[]): {
    goal: string | null;
    teamSize: string | null;
    tone: string | null;
    focus: string | null;
  } {
    let goal: string | null = null;
    let teamSize: string | null = null;
    let tone: string | null = null;
    let focus: string | null = null;

    for (const raw of userTurns) {
      const text = raw.trim();
      const lower = text.toLowerCase();

      const toneHit = this.normalizeTone(text) ?? this.normalizeTone(
        lower.match(/\b(supportive|neutral|direct)\b/)?.[1] ?? null,
      );
      if (toneHit && (/tone/i.test(text) || text.length < 40 || this.normalizeTone(text))) {
        tone = toneHit;
        // Pure tone-only replies shouldn't overwrite goal
        if (/^(supportive|neutral|direct)(\s+tone)?[.!]?$/i.test(text.trim())) {
          continue;
        }
      }

      const sizeMatch =
        text.match(
          /(?:team\s*(?:of|size)?|people|participants|employees)\s*[:\-]?\s*([0-9]+(?:\s*[-–]\s*[0-9]+)?\+?|[0-9]+\+)/i,
        ) ||
        text.match(/\b([0-9]+\s*[-–]\s*[0-9]+|[0-9]+\+|all employees|my team only)\b/i) ||
        text.match(/preferred duration:[\s\S]*?(?:\(~)?(\d+)\s*topics?/i);

      // Explicit audience chips
      if (/^(5–10|5-10|11–25|11-25|26–50|26-50|all employees|my team only)$/i.test(text)) {
        teamSize = text;
        continue;
      }
      if (sizeMatch?.[1] && !/duration|minutes/i.test(text.slice(0, 40))) {
        teamSize = sizeMatch[1].trim();
      } else if (/\b(11\+|5-10|5–10|26-50)\b/i.test(text)) {
        teamSize = text.match(/\b(11\+|5-10|5–10|11–25|26-50|26–50)\b/i)?.[1] ?? teamSize;
      }

      if (/^skip$/i.test(text)) {
        focus = focus ?? 'none';
        continue;
      }
      if (/^focus[:\s]/i.test(text) || /common goals|team building|communication|workload|recognition/i.test(text)) {
        if (text.length < 80) focus = text;
      }

      // First substantial message (often the compose prompt) becomes the goal
      if (!goal && text.length > 12 && !this.normalizeTone(text)) {
        // Strip duration appendix we append on Submit
        goal = text
          .replace(/\n*Preferred duration:[\s\S]*$/i, '')
          .trim() || text;
      } else if (
        goal &&
        text.length > 20 &&
        !toneHit &&
        !/^(5–10|5-10|11)/i.test(text) &&
        !/tone/i.test(text)
      ) {
        // Later long answers can refine goal if we still lack tone/size context noise
        if (!teamSize && !/people|team|employee/i.test(text)) {
          // keep original goal
        }
      }
    }

    // If first user turn is the big compose blob, prefer it as goal always
    if (userTurns[0] && userTurns[0].length > 20) {
      const first = userTurns[0]
        .replace(/\n*Preferred duration:[\s\S]*$/i, '')
        .trim();
      if (first) goal = first;
    }

    // Scan all turns again for team size mentioned in prose ("11+ people")
    for (const text of userTurns) {
      const m = text.match(/\b(\d+\+|\d+\s*[-–]\s*\d+)\s*(?:people|persons|employees|participants)?\b/i);
      if (m) teamSize = m[1].replace(/\s/g, '');
      if (/all employees/i.test(text)) teamSize = 'All employees';
    }

    return { goal, teamSize, tone, focus };
  }

  private async assistantFromOpenAi(
    apiKey: string,
    messages: SessionChatMessage[],
    pageHint: string | null,
    query: string | null,
    guardrails: OrgAiGuardrails,
  ): Promise<string | null> {
    const system = this.kb.buildAssistantSystemPrompt({
      query,
      pageHint,
      guardrails,
    });
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.get('OPENAI_MODEL', 'gpt-4o-mini'),
        temperature: 0.5,
        messages: [
          { role: 'system', content: system },
          ...messages.map((m) => ({ role: m.role, content: m.content })),
        ],
      }),
    });
    if (!res.ok) throw new Error('OpenAI assistant request failed');
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    return text || null;
  }

  /**
   * Scripted assistant used when OpenAI is unavailable. This is pure string
   * matching, not a model — it cannot "interpret" instructions, so blocked
   * topics are enforced as a plain substring check against the org's own
   * configured list, not influenced by any surrounding phrasing the user adds.
   *
   * Priority: blocked topic (never answer) → genuinely KB-grounded answer
   * (real keyword evidence, not just the base eligibility score) → the
   * existing scripted intent patterns (kept as-is, still useful for queries
   * that don't happen to hit a KB keyword, e.g. singular "template") →
   * the documented "couldn't verify" line for anything else, instead of
   * silently guessing.
   */  
  private fallbackAssistant(
    messages: SessionChatMessage[],
    pageHint: string | null,
    guardrails: OrgAiGuardrails,
  ): string {
    const lastRaw =
      [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    const last = lastRaw.toLowerCase();

    if (!last.trim()) {
      const where = pageHint ? ` You are on ${pageHint}.` : '';
      return `Hi — I am Resona's assistant.${where} Ask about sessions, programs, contacts, templates, or settings.`;
    }

    const blockedHit = guardrails.blockedTopics.find(
      (topic) => topic.trim() && last.includes(topic.trim().toLowerCase()),
    );

    if (blockedHit) {
      return `I can't help with that — this organization has restricted the assistant from discussing "${blockedHit}".`;
    }

    const [topMatch] = this.kb.retrieveScored('assistant', lastRaw, 1);
    if (topMatch && topMatch.score >= AiService.MIN_ASSISTANT_RELEVANCE_SCORE) {
      const firstLine = topMatch.article.body.split('\n')[0].slice(0, 220);
      const section =
        topMatch.article.title === 'Campaigns' ||
        topMatch.article.title === 'Programs'
          ? 'Programs'
          : 'Sessions';

      return `${firstLine} Open ${section} from the sidebar if you want to act on this.`;
    }

    if (/session|1:1|survey|topic/i.test(last)) {
      return 'To create a session, go to Sessions → New, pick 1:1 or Survey, then use the Describe Session coach for goal, team size, and tone.';
    }

    if (/program|campaign/i.test(last)) {
      return 'Open Programs from the sidebar to create Recurring, Linked, or Independent programs that wrap multiple sessions.';
    }

    if (/contact|participant|invite/i.test(last)) {
      return 'Manage people under Contacts, then add them on the Select Participants step when creating a session.';
    }

    if (/template/i.test(last)) {
      return 'Templates stores reusable session and report templates. Open Templates in the sidebar to browse or create one.';
    }

    if (/setting|role|permission|org/i.test(last)) {
      return 'Company profile, users, roles, and AI guardrails live under Settings.';
    }

    return AiService.UNVERIFIED_FALLBACK;
  }


  private async discussionFromOpenAi(
    apiKey: string,
    ctx: EmployeeDiscussionContext,
    guardrails: OrgAiGuardrails,
  ): Promise<EmployeeDiscussionTurnResult | null> {
    const topics = ctx.topics;
    const current = topics[ctx.currentTopicIndex];
    const lastUser =
      [...ctx.messages].reverse().find((m) => m.role === 'user')?.content ?? null;
    const system = this.kb.buildEmployeeDiscussionSystemPrompt({
      query: lastUser,
      guardrails,
    });

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.get('OPENAI_MODEL', 'gpt-4o-mini'),
        temperature: 0.55,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          {
            role: 'system',
            content: JSON.stringify({
              sessionTitle: ctx.title,
              goal: ctx.goalPrompt,
              tone: ctx.tone ?? 'supportive',
              topics: topics.map((t, i) => ({
                index: i,
                id: t.id,
                title: t.title,
              })),
              currentTopicIndex: ctx.currentTopicIndex,
              currentTopicTitle: current?.title ?? null,
            }),
          },
          ...ctx.messages.map((m) => ({ role: m.role, content: m.content })),
        ],
      }),
    });
    if (!res.ok) throw new Error('OpenAI discussion request failed');
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = data.choices?.[0]?.message?.content ?? '';
    return this.parseDiscussionResult(raw);
  }

  private parseDiscussionResult(raw: string): EmployeeDiscussionTurnResult | null {
    try {
      const cleaned = raw.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(cleaned) as {
        assistantMessage?: string;
        currentTopicIndex?: number;
        topicComplete?: boolean;
        agendaComplete?: boolean;
        topicSummary?: string | null;
      };
      if (!parsed.assistantMessage?.trim()) return null;
      return {
        assistantMessage: parsed.assistantMessage.trim(),
        currentTopicIndex:
          typeof parsed.currentTopicIndex === 'number'
            ? parsed.currentTopicIndex
            : 0,
        topicComplete: Boolean(parsed.topicComplete),
        agendaComplete: Boolean(parsed.agendaComplete),
        topicSummary: parsed.topicSummary?.trim() || null,
      };
    } catch {
      return null;
    }
  }

  private clampDiscussionResult(
    result: EmployeeDiscussionTurnResult,
    topicCount: number,
    prevIndex: number,
  ): EmployeeDiscussionTurnResult {
    let index = Math.min(
      Math.max(result.currentTopicIndex, prevIndex),
      Math.max(topicCount - 1, 0),
    );
    // Only allow advancing by one when topicComplete
    if (result.topicComplete && index > prevIndex + 1) {
      index = Math.min(prevIndex + 1, topicCount - 1);
    }
    if (!result.topicComplete) {
      index = prevIndex;
    }
    const agendaComplete =
      result.agendaComplete ||
      (result.topicComplete && prevIndex >= topicCount - 1);
    return {
      ...result,
      currentTopicIndex: agendaComplete ? topicCount - 1 : index,
      agendaComplete,
      topicSummary: result.topicComplete
        ? result.topicSummary || 'Employee shared feedback on this topic.'
        : null,
    };
  }

  /**
   * Scripted facilitator when OpenAI is unavailable.
   *
   * Scopes "how much has the employee said" to the CURRENT topic only, via
   * each message's topicId. Previously this counted the last 3 user messages
   * across the whole conversation regardless of which topic they belonged to —
   * on the first reply to a new topic, leftover messages from the just-finished
   * topic could pad the count to 2+, immediately marking the brand-new topic
   * complete and folding the previous topic's content into its summary. That
   * silently skipped topics and fabricated summaries blending unrelated answers.
   * If no message in the window carries topic tagging at all (unexpected, but
   * guard against it rather than break), fall back to the old whole-window
   * behavior instead of treating a tagged-but-empty result as "nothing said yet."
   */
  private fallbackDiscussion(
    topics: SessionTopic[],
    index: number,
    messages: DiscussionMessage[],
  ): EmployeeDiscussionTurnResult {
    const topic = topics[index];
    const hasTopicTags = messages.some((m) => m.topicId != null);
    const scoped = hasTopicTags
      ? messages.filter((m) => m.topicId === topic.id)
      : messages;
    const substantive = scoped
      .filter((m) => m.role === 'user')
      .slice(-3)
      .map((m) => m.content.trim())
      .filter(Boolean);

    if (substantive.length === 0) {
      return {
        assistantMessage: `Let's talk about: ${topic.title}. What stands out for you?`,
        currentTopicIndex: index,
        topicComplete: false,
        agendaComplete: false,
        topicSummary: null,
      };
    }

    if (substantive.length === 1) {
      return {
        assistantMessage: 'Thanks — can you share a concrete example or what would help most?',
        currentTopicIndex: index,
        topicComplete: false,
        agendaComplete: false,
        topicSummary: null,
      };
    }

    const summary = substantive.join(' ').slice(0, 500);
    const isLast = index >= topics.length - 1;
    if (isLast) {
      return {
        assistantMessage:
          'Thank you for sharing. That covers all the topics for this discussion.',
        currentTopicIndex: index,
        topicComplete: true,
        agendaComplete: true,
        topicSummary: summary,
      };
    }

    const next = topics[index + 1];
    return {
      assistantMessage: `Got it. Next up: ${next.title}. What’s your take?`,
      currentTopicIndex: index + 1,
      topicComplete: true,
      agendaComplete: false,
      topicSummary: summary,
    };
  }
}

function emptyDraft(): SessionChatDraft {
  return {
    title: null,
    goalPrompt: null,
    tone: null,
    teamSize: null,
  };
}

