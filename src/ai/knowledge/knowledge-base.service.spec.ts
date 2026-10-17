import { OrgService } from '../../org/org.service';
import { KnowledgeBaseService } from './knowledge-base.service';
import { RESONA_KNOWLEDGE_BASE } from './resona.knowledge';

function makeService(): KnowledgeBaseService {
  const org = { get: jest.fn() } as unknown as OrgService;
  return new KnowledgeBaseService(org);
}

describe('KnowledgeBaseService', () => {
  describe('retrieve', () => {
    it('only returns articles tagged for the requested surface', () => {
      const kb = makeService();
      const allowed = new Set(
        RESONA_KNOWLEDGE_BASE.filter((a) => a.surfaces.includes('employee_discussion')).map(
          (a) => a.id,
        ),
      );
      for (const article of kb.retrieve('employee_discussion')) {
        expect(allowed.has(article.id)).toBe(true);
      }
    });

    it('boosts an article whose keyword matches the query to the top', () => {
      const kb = makeService();
      const results = kb.retrieve('assistant', 'how do I use a CSV upload for participants?');
      expect(results[0].id).toBe('participants-contacts');
    });

    it('always boosts describe-coach-rules to the top on the describe surface', () => {
      const kb = makeService();
      const results = kb.retrieve('describe', 'totally unrelated text with no keyword hits');
      expect(results[0].id).toBe('describe-coach-rules');
    });

    it('respects the limit parameter', () => {
      const kb = makeService();
      expect(kb.retrieve('assistant', null, 2).length).toBeLessThanOrEqual(2);
    });
  });

  describe('formatGuardrails', () => {
    it('returns an empty string when nothing is configured', () => {
      const kb = makeService();
      expect(kb.formatGuardrails({ aiSystemPrompt: null, blockedTopics: [] })).toBe('');
    });

    it('includes the org system prompt when set', () => {
      const kb = makeService();
      const text = kb.formatGuardrails({ aiSystemPrompt: 'Be concise.', blockedTopics: [] });
      expect(text).toContain('Be concise.');
    });

    it('includes blocked topics as a list when set', () => {
      const kb = makeService();
      const text = kb.formatGuardrails({
        aiSystemPrompt: null,
        blockedTopics: ['salary', 'medical'],
      });
      expect(text).toContain('salary');
      expect(text).toContain('medical');
    });
  });

  describe('updated article content (Task 2 Part A)', () => {
    it('describe-coach-rules mentions topics to avoid and desired outputs as optional, not required', () => {
      const article = RESONA_KNOWLEDGE_BASE.find((a) => a.id === 'describe-coach-rules')!;
      expect(article.body).toMatch(/topics to avoid/i);
      expect(article.body).toMatch(/desired outputs/i);
      expect(article.body).toMatch(/optional/i);
    });

    it('participants-contacts mentions groups and CSV upload alongside the contacts database', () => {
      const article = RESONA_KNOWLEDGE_BASE.find((a) => a.id === 'participants-contacts')!;
      expect(article.body).toMatch(/group/i);
      expect(article.body).toMatch(/csv/i);
    });

    it('build-reports exists, is tagged for assistant and describe', () => {
      const article = RESONA_KNOWLEDGE_BASE.find((a) => a.id === 'build-reports');
      expect(article).toBeDefined();
      expect(article!.surfaces).toEqual(expect.arrayContaining(['assistant', 'describe']));
    });

    it('build-reports lists exactly the four schema-supported kinds, nothing invented', () => {
      const article = RESONA_KNOWLEDGE_BASE.find((a) => a.id === 'build-reports')!;
      const kindsLine = article.body.match(/kind:\s*([^.]+)\./)?.[1] ?? '';
      const listed = kindsLine
        .split(/,|\bor\b/)
        .map((s) => s.trim())
        .filter(Boolean)
        .sort();
      expect(listed).toEqual(['custom', 'scores', 'summary', 'themes']);
    });
  });

  describe('retrieveScored', () => {
    it('gives a real keyword match a higher score than articles with no match', () => {
      const kb = makeService();
      // Explicit high limit: there are more than the default 8 assistant-surface
      // articles, and this test needs every candidate present to compare against.
      const results = kb.retrieveScored('assistant', 'tell me about campaigns', 20);
      const campaigns = results.find((r) => r.article.id === 'campaigns')!;
      const unrelated = results.find((r) => r.article.id === 'navigation')!;
      expect(campaigns.score).toBeGreaterThan(unrelated.score);
    });

    it('reports only the base/core score when the query has no keyword evidence at all', () => {
      const kb = makeService();
      const results = kb.retrieveScored('assistant', 'completely unrelated query text');
      // No article should score above base(1) + the always-on core boost(1).
      for (const r of results) {
        expect(r.score).toBeLessThanOrEqual(2);
      }
    });

    it('retrieve() stays consistent with retrieveScored() — same order, articles only', () => {
      const kb = makeService();
      const query = 'how do I set up a survey campaign';
      expect(kb.retrieve('assistant', query)).toEqual(
        kb.retrieveScored('assistant', query).map((r) => r.article),
      );
    });
  });
});
