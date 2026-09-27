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

const DESCRIBE_SYSTEM_PROMPT = `You are Resona's session coach helping HR design a feedback session.
Ask ONE question at a time. Collect, in order when missing:
1) purpose/goal of the session
2) team size (how many people)
3) tone: must be one of supportive | neutral | direct
4) optional focus areas (user may skip)

When you have goal, team size, and tone, set readyToGenerate=true and fill draft:
- title: short session title
- goalPrompt: a clear synthesized brief that INCLUDES team size (e.g. "Team of 8: ...")
- tone: supportive | neutral | direct
- teamSize: as stated by the user

Until ready, keep draft fields null/empty for unknowns and readyToGenerate=false.
Session type context will be provided. Be concise and friendly.

Return ONLY valid JSON (no markdown) with this shape:
{"assistantMessage":"string","draft":{"title":null,"goalPrompt":null,"tone":null,"teamSize":null},"readyToGenerate":false}`;

const ASSISTANT_SYSTEM_PROMPT = `You are Resona AI, a helpful assistant inside an HR feedback dashboard.
Help users with: creating feedback sessions (1:1 or survey), campaigns, contacts, templates, settings, and how to use the wizard.
Be concise (2-4 short sentences). Suggest concrete next steps in the product when useful.
If they want to design a session, guide them to Sessions → Create and the Describe Session coach.
Do not invent features that are not part of a typical feedback platform.`;

@Injectable()
export class AiService {
  constructor(private readonly config: ConfigService) {}

  async generateTopics(
    input: GenerateTopicsInput,
  ): Promise<GenerateTopicsResult> {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (apiKey) {
      try {
        const topics = await this.fromOpenAi(apiKey, input);
        if (topics.length) return { topics, source: 'openai' };
      } catch {
        // fall through to heuristic
      }
    }
    return { topics: this.heuristicTopics(input), source: 'heuristic' };
  }

  async chatDescribeTurn(
    input: SessionChatTurnInput,
  ): Promise<SessionChatTurnResult> {
    const messages = (input.messages ?? []).slice(-24);
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (apiKey) {
      try {
        const result = await this.chatFromOpenAi(
          apiKey,
          input.type,
          messages,
          input.title,
        );
        if (result) return result;
      } catch {
        // fall through to local coach
      }
    }
    return this.fallbackCoach(messages, input.type, input.title);
  }

  async assistantChatTurn(
    input: AssistantChatTurnInput,
  ): Promise<AssistantChatTurnResult> {
    const messages = (input.messages ?? []).slice(-24);
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (apiKey) {
      try {
        const text = await this.assistantFromOpenAi(
          apiKey,
          messages,
          input.pageHint ?? null,
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
      ),
      source: 'heuristic',
    };
  }

  private heuristicTopics(input: GenerateTopicsInput): SessionTopic[] {
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

    return seeds.slice(0, 5).map((title, i) => ({
      id: randomUUID(),
      title,
      order: i + 1,
    }));
  }

  private async fromOpenAi(
    apiKey: string,
    input: GenerateTopicsInput,
  ): Promise<SessionTopic[]> {
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
          {
            role: 'system',
            content:
              'Return ONLY a JSON array of 4-5 short discussion topic strings for an HR feedback session. No markdown.',
          },
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
    title?: string | null,
  ): Promise<SessionChatTurnResult | null> {
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
          { role: 'system', content: DESCRIBE_SYSTEM_PROMPT },
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
      };
      if (!parsed.assistantMessage?.trim()) return null;
      const tone = this.normalizeTone(parsed.draft?.tone);
      return {
        assistantMessage: parsed.assistantMessage.trim(),
        draft: {
          title: parsed.draft?.title?.trim() || null,
          goalPrompt: parsed.draft?.goalPrompt?.trim() || null,
          tone,
          teamSize: parsed.draft?.teamSize?.trim() || null,
        },
        readyToGenerate: Boolean(parsed.readyToGenerate),
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

  /** Local scripted coach when OpenAI is unavailable. */
  private fallbackCoach(
    messages: SessionChatMessage[],
    type: SessionChatTurnInput['type'],
    title?: string | null,
  ): SessionChatTurnResult {
    const userTurns = messages
      .filter((m) => m.role === 'user')
      .map((m) => m.content.trim());
    const typeLabel = type === 'survey' ? 'survey' : '1:1';

    if (userTurns.length === 0) {
      return {
        assistantMessage: `I'll help shape this ${typeLabel} session. What is the main goal or purpose?`,
        draft: emptyDraft(),
        readyToGenerate: false,
      };
    }

    if (userTurns.length === 1) {
      return {
        assistantMessage:
          'Got it. Roughly how many people are on the team for this session?',
        draft: {
          ...emptyDraft(),
          goalPrompt: userTurns[0],
        },
        readyToGenerate: false,
      };
    }

    if (userTurns.length === 2) {
      return {
        assistantMessage:
          'Thanks. What tone should we use — supportive, neutral, or direct?',
        draft: {
          ...emptyDraft(),
          goalPrompt: userTurns[0],
          teamSize: userTurns[1],
        },
        readyToGenerate: false,
      };
    }

    const goal = userTurns[0];
    const teamSize = userTurns[1];
    const toneRaw = userTurns[2];
    const tone = this.normalizeTone(toneRaw) ?? 'supportive';
    const focus = userTurns[3]?.trim();
    const goalPrompt = [
      `Team of ${teamSize}: ${goal}`,
      focus ? `Focus: ${focus}` : null,
    ]
      .filter(Boolean)
      .join('. ');

    const shortTitle =
      (title && title !== 'Untitled session' ? title : null) ||
      goal.slice(0, 48).trim() ||
      'Feedback session';

    if (userTurns.length === 3) {
      return {
        assistantMessage:
          'Optional: any specific focus areas? Or say "skip" and we can generate topics.',
        draft: {
          title: shortTitle,
          goalPrompt,
          tone,
          teamSize,
        },
        readyToGenerate: false,
      };
    }

    return {
      assistantMessage:
        'I have enough to draft discussion topics. Click Generate AI topics when you are ready.',
      draft: {
        title: shortTitle,
        goalPrompt,
        tone,
        teamSize,
      },
      readyToGenerate: true,
    };
  }

  private async assistantFromOpenAi(
    apiKey: string,
    messages: SessionChatMessage[],
    pageHint: string | null,
  ): Promise<string | null> {
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
          { role: 'system', content: ASSISTANT_SYSTEM_PROMPT },
          ...(pageHint
            ? [
                {
                  role: 'system' as const,
                  content: `User is currently on: ${pageHint}`,
                },
              ]
            : []),
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

  private fallbackAssistant(
    messages: SessionChatMessage[],
    pageHint: string | null,
  ): string {
    const last =
      [...messages]
        .reverse()
        .find((m) => m.role === 'user')
        ?.content.toLowerCase() ?? '';
    if (/session|1:1|survey|topic/i.test(last)) {
      return 'To create a session, go to Sessions → New, pick 1:1 or Survey, then use the Describe Session coach for goal, team size, and tone. I can also answer product questions here.';
    }
    if (/campaign/i.test(last)) {
      return 'Open Campaigns from the sidebar to create Recurring, Linked, or Independent campaigns that wrap multiple sessions.';
    }
    if (/contact|participant|invite/i.test(last)) {
      return 'Manage people under Contacts, then add them on the Select Participants step when creating a session.';
    }
    if (/template/i.test(last)) {
      return 'Templates stores reusable session and report templates. Open Templates in the sidebar to browse or create one.';
    }
    if (/setting|role|permission|org/i.test(last)) {
      return 'Company profile, users, and roles live under Settings in the sidebar.';
    }
    const where = pageHint ? ` You are on ${pageHint}.` : '';
    return `Hi — I am Resona's assistant.${where} Ask about sessions, campaigns, contacts, templates, or settings, and I will point you to the right place.`;
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
