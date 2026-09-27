import { Injectable } from '@nestjs/common';
import { OrgService } from '../../org/org.service';
import {
  articlesForSurface,
  type KbArticle,
  type KbSurface,
  RESONA_KNOWLEDGE_BASE,
} from './resona.knowledge';

export type OrgAiGuardrails = {
  aiSystemPrompt: string | null;
  blockedTopics: string[];
};

@Injectable()
export class KnowledgeBaseService {
  constructor(private readonly org: OrgService) {}

  listAll(): KbArticle[] {
    return RESONA_KNOWLEDGE_BASE;
  }

  /**
   * Rank articles for a surface; boost those matching the latest user text.
   * Always includes core articles for the surface (cap ~8).
   */
  retrieve(surface: KbSurface, query?: string | null, limit = 8): KbArticle[] {
    const pool = articlesForSurface(surface);
    const q = (query ?? '').toLowerCase();
    const scored = pool.map((article) => {
      let score = 1; // base: always eligible for its surface
      if (q) {
        for (const kw of article.keywords) {
          if (q.includes(kw.toLowerCase())) score += 3;
        }
        if (q.includes(article.title.toLowerCase())) score += 2;
      }
      // Prefer always-on cores
      if (article.id === 'guardrails' || article.id === 'product-overview') score += 1;
      if (surface === 'describe' && article.id === 'describe-coach-rules') score += 5;
      if (surface === 'employee_discussion' && article.id === 'employee-1on1') score += 5;
      return { article, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.article);
  }

  formatContext(articles: KbArticle[]): string {
    if (!articles.length) return '';
    return articles
      .map((a) => `### ${a.title}\n${a.body}`)
      .join('\n\n');
  }

  async getOrgGuardrails(orgId?: string | null): Promise<OrgAiGuardrails> {
    if (!orgId) return { aiSystemPrompt: null, blockedTopics: [] };
    try {
      const org = await this.org.get(orgId);
      return {
        aiSystemPrompt: org.aiSystemPrompt ?? null,
        blockedTopics: org.blockedTopics ?? [],
      };
    } catch {
      return { aiSystemPrompt: null, blockedTopics: [] };
    }
  }

  formatGuardrails(g: OrgAiGuardrails): string {
    const lines: string[] = [];
    if (g.aiSystemPrompt?.trim()) {
      lines.push(`Organization AI instructions:\n${g.aiSystemPrompt.trim()}`);
    }
    if (g.blockedTopics.length) {
      lines.push(
        `Blocked topics (never discuss or solicit):\n- ${g.blockedTopics.join('\n- ')}`,
      );
    }
    return lines.join('\n\n');
  }

  buildDescribeSystemPrompt(opts: {
    query?: string | null;
    guardrails?: OrgAiGuardrails;
  }): string {
    const kb = this.formatContext(this.retrieve('describe', opts.query));
    const guard = opts.guardrails ? this.formatGuardrails(opts.guardrails) : '';
    return [
      `You are Resona's session coach helping HR design a feedback session.`,
      `Use the knowledge base below as ground truth. Do not invent product features.`,
      ``,
      `Ask ONE question at a time. Collect ONLY what is still missing:`,
      `1) purpose/goal`,
      `2) team size`,
      `3) tone: supportive | neutral | direct`,
      `4) optional focus (user may skip)`,
      ``,
      `Never-ending loops are forbidden: scan full history; do not re-ask answered fields;`,
      `on corrections update draft and move on; when goal+team+tone exist set readyToGenerate=true`,
      `with ONE short line telling them to Continue, and suggestions=[].`,
      ``,
      `Return ONLY valid JSON:`,
      `{"assistantMessage":"string","draft":{"title":null,"goalPrompt":null,"tone":null,"teamSize":null},"readyToGenerate":false,"suggestions":["chip1"]}`,
      ``,
      `## Knowledge base`,
      kb,
      guard ? `\n## Org guardrails\n${guard}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  buildAssistantSystemPrompt(opts: {
    query?: string | null;
    pageHint?: string | null;
    guardrails?: OrgAiGuardrails;
  }): string {
    const kb = this.formatContext(this.retrieve('assistant', opts.query));
    const guard = opts.guardrails ? this.formatGuardrails(opts.guardrails) : '';
    return [
      `You are Resona AI, the in-dashboard product assistant.`,
      `Answer from the knowledge base. Be concise (2–4 short sentences).`,
      `Suggest concrete next steps in the product when useful.`,
      `Do not invent features. No Focus Groups.`,
      opts.pageHint ? `User is currently on: ${opts.pageHint}` : '',
      ``,
      `## Knowledge base`,
      kb,
      guard ? `\n## Org guardrails\n${guard}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  buildEmployeeDiscussionSystemPrompt(opts: {
    query?: string | null;
    guardrails?: OrgAiGuardrails;
  }): string {
    const kb = this.formatContext(this.retrieve('employee_discussion', opts.query));
    const guard = opts.guardrails ? this.formatGuardrails(opts.guardrails) : '';
    return [
      `You are Resona's AI discussion facilitator for a confidential employee 1:1.`,
      `Stay on ONE topic at a time. Ask short follow-ups (1–2 sentences).`,
      `When the topic is covered, set topicComplete=true and write topicSummary (2–4 sentences).`,
      `Advance at most one topic; on last topic set agendaComplete=true.`,
      `Never invent employee quotes.`,
      ``,
      `Return ONLY valid JSON:`,
      `{"assistantMessage":"string","currentTopicIndex":0,"topicComplete":false,"agendaComplete":false,"topicSummary":null}`,
      ``,
      `## Knowledge base`,
      kb,
      guard ? `\n## Org guardrails\n${guard}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  buildTopicsSystemPrompt(opts: {
    query?: string | null;
    guardrails?: OrgAiGuardrails;
  }): string {
    const kb = this.formatContext(this.retrieve('topics', opts.query, 5));
    const guard = opts.guardrails ? this.formatGuardrails(opts.guardrails) : '';
    return [
      `Return ONLY a JSON array of 4–5 short discussion topic strings for an HR feedback session. No markdown.`,
      `Use the knowledge base for quality and safety.`,
      ``,
      `## Knowledge base`,
      kb,
      guard ? `\n## Org guardrails\n${guard}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }
}
