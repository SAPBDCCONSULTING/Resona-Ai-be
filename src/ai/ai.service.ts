import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  GenerateTopicsInput,
  GenerateTopicsResult,
  SessionTopic,
} from '@pulsefeedback/shared';
import { randomUUID } from 'crypto';

@Injectable()
export class AiService {
  constructor(private readonly config: ConfigService) {}

  async generateTopics(input: GenerateTopicsInput): Promise<GenerateTopicsResult> {
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
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim()) as string[];
    return parsed.slice(0, 5).map((title, i) => ({
      id: randomUUID(),
      title: String(title),
      order: i + 1,
    }));
  }
}
