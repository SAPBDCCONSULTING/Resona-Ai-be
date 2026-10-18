import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  AiCitation,
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
import { redactPii } from '../common/pii-redaction.util';
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
  private readonly logger = new Logger(AiService.name);

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

  /**
   * Goal-independent filler topics used to top up a topic list after blocked
   * terms are filtered out. These never echo user/goal text, so they can't
   * themselves carry blocked content — a safe universal backstop so a blocked
   * term never silently shrinks the topic count the UI expects.
   */
  private static readonly SAFE_FILLER_TOPICS = [
    'What is working well',
    'Where friction shows up',
    'Actions that would help next',
    'Any other feedback to share',
  ];

  /**
   * Narrow, literal, case-insensitive substring match against the org's own
   * configured blockedTopics — the one piece of OrgAiGuardrails that's a
   * structured list, not free text, and so the only piece deterministically
   * enforceable in plain code. Never broadened into semantic matching.
   */
  private static findBlockedTopic(
    text: string,
    blockedTopics: string[],
  ): string | null {
    const lower = text.toLowerCase();
    const hit = blockedTopics.find(
      (topic) => topic.trim() && lower.includes(topic.trim().toLowerCase()),
    );
    return hit ?? null;
  }

  private static blockedTopicMessage(topic: string): string {
    return `I can't help with that — this organization has restricted the assistant from discussing "${topic}".`;
  }

  /**
   * Deliberately names the conflicting sources (so the reader knows exactly
   * what to go check) and points to a human, not another automated
   * resolution — this codebase has no reliable way to resolve a genuine
   * content conflict itself. It does not create or claim to create a
   * routed escalation ticket; KnowledgeFeedback's owner-routing is a
   * separate, user-initiated flow (see knowledge-feedback.service.ts) this
   * message directs the reader toward rather than invoking automatically,
   * since a conflict between two sources may have two different owners
   * and there is no single correct automatic target.
   */
  private static conflictMessage(conflict: { sourceTitles: string[] }): string {
    const names = conflict.sourceTitles.map((t) => `"${t}"`).join(' and ');
    return `I found conflicting information across multiple published sources (${names}) and can't confidently answer this. Please flag this answer or check with your knowledge base owner/admin to resolve the discrepancy.`;
  }

  /**
   * Drops any topic title that knowingly mentions a blocked term, then tops
   * up from SAFE_FILLER_TOPICS if filtering left fewer than 5 — used for both
   * the scripted heuristic seeds and real OpenAI-returned topic titles, so
   * neither path can under-deliver or leak blocked content via topics.
   */
  private static filterBlockedTopicTitles(
    titles: string[],
    blockedTopics: string[],
  ): string[] {
    let safe = titles.filter((t) => !AiService.findBlockedTopic(t, blockedTopics));
    if (safe.length < 5) {
      const filler = AiService.SAFE_FILLER_TOPICS.filter(
        (f) => !AiService.findBlockedTopic(f, blockedTopics) && !safe.includes(f),
      );
      safe = [...safe, ...filler];
    }
    return safe.slice(0, 5);
  }

  constructor(
    private readonly config: ConfigService,
    private readonly kb: KnowledgeBaseService,
  ) {}

  /**
   * Safe diagnostic logging for a failed OpenAI call — previously these
   * catch blocks silently swallowed every failure with no log at all. Never
   * logs err.message or any request/response body (which could echo back
   * user content, a raw provider error, or in a misconfigured-proxy edge
   * case even an auth header) — only the error's type/name, same convention
   * already established in KnowledgeService.processSource. redactPii is
   * applied to the one piece of free text here (the method/surface label is
   * a static string, not user content) as defense-in-depth infrastructure
   * for this and any future logging in this module, not because this
   * specific call site currently has anything to redact.
   */
  private logOpenAiFailure(surface: string, err: unknown): void {
    const errorType = err instanceof Error ? err.name : 'UnknownError';
    this.logger.warn(redactPii(`OpenAI call failed in ${surface} (${errorType})`));
  }

  async generateTopics(
    input: GenerateTopicsInput,
    orgId?: string | null,
    roleId?: string | null,
  ): Promise<GenerateTopicsResult> {
    const guardrails = await this.kb.getOrgGuardrails(orgId);

    // Input check before the model is ever called: a goalPrompt that itself
    // names a blocked topic is never sent to OpenAI, even with instructions
    // not to use it — same "never send blocked content to a third party"
    // guarantee assistantChatTurn already provides. The heuristic path
    // already enforces blockedTopics via filterBlockedTopicTitles, so this
    // is a safe, stateless bypass (topic generation is one-shot, not a
    // multi-turn flow, so skipping OpenAI here has no progression to corrupt).
    const inputBlocked = AiService.findBlockedTopic(
      input.goalPrompt ?? '',
      guardrails.blockedTopics,
    );
    const apiKey = inputBlocked ? null : this.config.get<string>('OPENAI_API_KEY');
    if (apiKey) {
      try {
        const topics = await this.fromOpenAi(apiKey, input, guardrails, orgId, roleId);
        if (topics.length) return { topics, source: 'openai' };
      } catch (err) {
        this.logOpenAiFailure('generateTopics', err);
      }
    }
    return { topics: this.heuristicTopics(input, guardrails), source: 'heuristic' };
  }

  async chatDescribeTurn(
    input: SessionChatTurnInput,
    orgId?: string | null,
    roleId?: string | null,
  ): Promise<SessionChatTurnResult> {
    const messages = (input.messages ?? []).slice(-24);
    const guardrails = await this.kb.getOrgGuardrails(orgId);
    const lastUser =
      [...messages].reverse().find((m) => m.role === 'user')?.content ?? null;

    // Input check before the model is ever called: unlike fallbackCoach
    // (deliberately not blockedTopics-aware — see its own comment, since its
    // questions are fixed and generic and cannot be steered), the real
    // OpenAI call DOES echo back free-form model text, so a blocked term in
    // the user's own message must never reach it. Skipping straight to the
    // existing heuristic coach preserves the describe flow's state machine
    // exactly as if no API key were configured — no new "blocked" branch is
    // introduced into its goal/team/tone collection sequence.
    const inputBlocked = lastUser
      ? AiService.findBlockedTopic(lastUser, guardrails.blockedTopics)
      : null;
    const apiKey = inputBlocked ? null : this.config.get<string>('OPENAI_API_KEY');
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
          orgId,
          roleId,
        );
        // Defense in depth: discard a response whose own free-form text
        // mentions a blocked topic, same as assistantChatTurn already does —
        // treating it exactly like a parse failure falls through to the
        // existing, already-safe fallbackCoach below rather than introducing
        // a new state-machine branch.
        if (result && AiService.findBlockedTopic(result.assistantMessage, guardrails.blockedTopics)) {
          result = null;
        }
      } catch (err) {
        this.logOpenAiFailure('chatDescribeTurn', err);
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
    roleId?: string | null,
  ): Promise<AssistantChatTurnResult> {
    const messages = (input.messages ?? []).slice(-24);
    const guardrails = await this.kb.getOrgGuardrails(orgId);
    const lastUser =
      [...messages].reverse().find((m) => m.role === 'user')?.content ?? null;

    // Server-side enforcement, not just a prompt instruction: check BEFORE
    // ever calling OpenAI. A blocked query is never sent to a third party,
    // and the model's own compliance is never the only safeguard in place.
    const inputBlocked = lastUser
      ? AiService.findBlockedTopic(lastUser, guardrails.blockedTopics)
      : null;
    if (inputBlocked) {
      return {
        assistantMessage: AiService.blockedTopicMessage(inputBlocked),
        source: 'heuristic',
      };
    }

    // Server-side, before ever calling OpenAI (same reasoning as the
    // blocked-topic check above): if the eligible evidence for this query
    // contains genuinely conflicting sources that recency metadata doesn't
    // resolve, never let the model (or the heuristic fallback) silently
    // pick one side. Return a dedicated uncertainty response instead.
    const conflict = await this.kb.getDocumentConflict({
      query: lastUser,
      orgId,
      roleId,
      surface: 'assistant',
    });
    if (conflict) {
      return {
        assistantMessage: AiService.conflictMessage(conflict),
        source: 'heuristic',
        conflict,
      };
    }

    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (apiKey) {
      try {
        const text = await this.assistantFromOpenAi(
          apiKey,
          messages,
          input.pageHint ?? null,
          lastUser,
          guardrails,
          orgId,
          roleId,
        );
        // Defense in depth: verify the model's own output didn't itself
        // introduce a blocked topic the system-prompt instruction failed to
        // prevent, before trusting it enough to return to the client.
        if (text && !AiService.findBlockedTopic(text, guardrails.blockedTopics)) {
          // Citations are independently re-derived from the same verified
          // evidence the prompt was built from — never anything the model
          // itself returned (its JSON/text response has no citation field).
          const citations = await this.kb.getAssistantCitations({ query: lastUser, orgId, roleId });
          return {
            assistantMessage: text,
            source: 'openai',
            ...(citations.length ? { citations } : {}),
          };
        }
      } catch (err) {
        this.logOpenAiFailure('assistantChatTurn', err);
      }
    }
    const { message, citations } = this.fallbackAssistant(
      messages,
      input.pageHint ?? null,
      guardrails,
    );
    return {
      assistantMessage: message,
      source: 'heuristic',
      ...(citations.length ? { citations } : {}),
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
    const lastUser =
      [...messages].reverse().find((m) => m.role === 'user')?.content ?? null;

    // Input check before the model is ever called. Unlike assistantChatTurn,
    // this flow has discussion state (currentTopicIndex/topicComplete/
    // agendaComplete) that must never be corrupted by a blocked message, so
    // this does NOT reuse assistantChatTurn's "return a hard decline"
    // shape — it stays on the current topic, exactly as a not-yet-complete
    // reply would, instead of advancing or completing anything.
    const inputBlocked = lastUser
      ? AiService.findBlockedTopic(lastUser, guardrails.blockedTopics)
      : null;
    if (inputBlocked) {
      return {
        assistantMessage: AiService.blockedTopicMessage(inputBlocked),
        currentTopicIndex: index,
        topicComplete: false,
        agendaComplete: false,
        topicSummary: null,
      };
    }

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
        // Defense in depth: discard a response whose assistantMessage or
        // topicSummary mentions a blocked topic — treated exactly like a
        // parse failure (falls through to fallbackDiscussion below) so no
        // new state-machine branch is introduced here either.
        const resultBlocked =
          result &&
          (AiService.findBlockedTopic(result.assistantMessage, guardrails.blockedTopics) ||
            (result.topicSummary &&
              AiService.findBlockedTopic(result.topicSummary, guardrails.blockedTopics)));
        if (result && !resultBlocked) {
          return this.clampDiscussionResult(result, topics.length, index);
        }
      } catch (err) {
        this.logOpenAiFailure('employeeDiscussionTurn', err);
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

    const safeSeeds = AiService.filterBlockedTopicTitles(seeds, guardrails.blockedTopics);

    return safeSeeds.map((title, i) => ({
      id: randomUUID(),
      title,
      order: i + 1,
    }));
  }

  private async fromOpenAi(
    apiKey: string,
    input: GenerateTopicsInput,
    guardrails: OrgAiGuardrails,
    orgId?: string | null,
    roleId?: string | null,
  ): Promise<SessionTopic[]> {
    const system = await this.kb.buildTopicsSystemPrompt({
      query: input.goalPrompt,
      guardrails,
      orgId,
      roleId,
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
    // Server-side verification, not just a prompt instruction: the system
    // prompt already tells the model to respect blockedTopics, but nothing
    // previously checked that it actually did. Same filter+backfill as the
    // heuristic path, so both topic-generation routes give the same guarantee.
    const titles = AiService.filterBlockedTopicTitles(
      parsed.map((t) => String(t)),
      guardrails.blockedTopics,
    );
    return titles.map((title, i) => ({
      id: randomUUID(),
      title,
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
    orgId?: string | null,
    roleId?: string | null,
  ): Promise<SessionChatTurnResult | null> {
    const system = await this.kb.buildDescribeSystemPrompt({ query, guardrails, orgId, roleId });
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
    orgId?: string | null,
    roleId?: string | null,
  ): Promise<string | null> {
    const system = await this.kb.buildAssistantSystemPrompt({
      query,
      pageHint,
      guardrails,
      orgId,
      roleId,
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
  ): { message: string; citations: AiCitation[] } {
    const lastRaw =
      [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    const last = lastRaw.toLowerCase();
    const noCitations = { citations: [] as AiCitation[] };

    if (!last.trim()) {
      const where = pageHint ? ` You are on ${pageHint}.` : '';
      return {
        message: `Hi — I am Resona's assistant.${where} Ask about sessions, programs, contacts, templates, or settings.`,
        ...noCitations,
      };
    }

    const blockedHit = AiService.findBlockedTopic(last, guardrails.blockedTopics);
    if (blockedHit) {
      return { message: AiService.blockedTopicMessage(blockedHit), ...noCitations };
    }

    const [topMatch] = this.kb.retrieveScored('assistant', lastRaw, 1);
    if (topMatch && topMatch.score >= AiService.MIN_ASSISTANT_RELEVANCE_SCORE) {
      const firstLine = topMatch.article.body.split('\n')[0].slice(0, 220);
      const section =
        topMatch.article.title === 'Campaigns' ||
        topMatch.article.title === 'Programs'
          ? 'Programs'
          : 'Sessions';

      return {
        message: `${firstLine} Open ${section} from the sidebar if you want to act on this.`,
        citations: [
          {
            kind: 'curated_kb',
            sourceId: topMatch.article.id,
            sourceTitle: topMatch.article.title,
            sourceVersion: null,
            chunkId: null,
          },
        ],
      };
    }

    if (/session|1:1|survey|topic/i.test(last)) {
      return {
        message:
          'To create a session, go to Sessions → New, pick 1:1 or Survey, then use the Describe Session coach for goal, team size, and tone.',
        ...noCitations,
      };
    }

    if (/program|campaign/i.test(last)) {
      return {
        message:
          'Open Programs from the sidebar to create Recurring, Linked, or Independent programs that wrap multiple sessions.',
        ...noCitations,
      };
    }

    if (/contact|participant|invite/i.test(last)) {
      return {
        message:
          'Manage people under Contacts, then add them on the Select Participants step when creating a session.',
        ...noCitations,
      };
    }

    if (/template/i.test(last)) {
      return {
        message:
          'Templates stores reusable session and report templates. Open Templates in the sidebar to browse or create one.',
        ...noCitations,
      };
    }

    if (/setting|role|permission|org/i.test(last)) {
      return {
        message: 'Company profile, users, roles, and AI guardrails live under Settings.',
        ...noCitations,
      };
    }

    return { message: AiService.UNVERIFIED_FALLBACK, ...noCitations };
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

