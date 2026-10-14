import { ConfigService } from '@nestjs/config';
import { AiService } from './ai.service';
import { KnowledgeBaseService } from './knowledge/knowledge-base.service';

function makeService(): AiService {
  // extractDescribeDraft and clampDiscussionResult never touch config/kb, so
  // empty stand-ins are safe here and avoid pulling in Nest DI for a unit test.
  return new AiService({} as ConfigService, {} as KnowledgeBaseService);
}

type DescribeDraft = {
  goal: string | null;
  teamSize: string | null;
  tone: string | null;
  focus: string | null;
};

type DiscussionResult = {
  assistantMessage: string;
  currentTopicIndex: number;
  topicComplete: boolean;
  agendaComplete: boolean;
  topicSummary: string | null;
};

// Both methods under test are private. Rather than widen AiService's public
// surface just for tests, access them through a narrow typed cast.
type AiServiceInternals = {
  extractDescribeDraft: (userTurns: string[]) => DescribeDraft;
  clampDiscussionResult: (
    result: DiscussionResult,
    topicCount: number,
    prevIndex: number,
  ) => DiscussionResult;
};

function internals(service: AiService): AiServiceInternals {
  return service as unknown as AiServiceInternals;
}

describe('AiService', () => {
  describe('extractDescribeDraft', () => {
    it('extracts nothing from an empty conversation', () => {
      const result = internals(makeService()).extractDescribeDraft([]);
      expect(result).toEqual({ goal: null, teamSize: null, tone: null, focus: null });
    });

    it('extracts the goal from the first substantial turn', () => {
      const result = internals(makeService()).extractDescribeDraft([
        'Understand onboarding friction for new hires',
      ]);
      expect(result.goal).toContain('onboarding friction');
    });

    it('extracts team size from a free-text chip reply', () => {
      const result = internals(makeService()).extractDescribeDraft([
        'Understand onboarding friction',
        '11-25',
      ]);
      expect(result.teamSize).toBe('11-25');
    });

    it('extracts a recognized tone word', () => {
      const result = internals(makeService()).extractDescribeDraft([
        'Understand onboarding friction',
        '11-25',
        'supportive',
      ]);
      expect(result.tone).toBe('supportive');
    });

    it('does not let a pure tone reply overwrite an already-captured goal', () => {
      const result = internals(makeService()).extractDescribeDraft([
        'Understand onboarding friction',
        'supportive',
      ]);
      expect(result.goal).toContain('onboarding friction');
      expect(result.tone).toBe('supportive');
    });
  });

  describe('clampDiscussionResult', () => {
    it('does not advance the topic index when the topic is not complete', () => {
      const result = internals(makeService()).clampDiscussionResult(
        {
          assistantMessage: 'tell me more',
          currentTopicIndex: 2,
          topicComplete: false,
          agendaComplete: false,
          topicSummary: null,
        },
        5,
        0,
      );
      expect(result.currentTopicIndex).toBe(0);
    });

    it('advances by exactly one when the topic is complete, even if the model jumped further', () => {
      const result = internals(makeService()).clampDiscussionResult(
        {
          assistantMessage: 'moving on',
          currentTopicIndex: 4,
          topicComplete: true,
          agendaComplete: false,
          topicSummary: 'summary text',
        },
        5,
        0,
      );
      expect(result.currentTopicIndex).toBe(1);
    });

    it('marks agendaComplete when the topic is complete and it was the last topic', () => {
      const result = internals(makeService()).clampDiscussionResult(
        {
          assistantMessage: 'done',
          currentTopicIndex: 4,
          topicComplete: true,
          agendaComplete: false,
          topicSummary: 'final summary',
        },
        5,
        4,
      );
      expect(result.agendaComplete).toBe(true);
      expect(result.currentTopicIndex).toBe(4);
    });

    it('falls back to a default summary when the topic is complete but none was given', () => {
      const result = internals(makeService()).clampDiscussionResult(
        {
          assistantMessage: 'next',
          currentTopicIndex: 1,
          topicComplete: true,
          agendaComplete: false,
          topicSummary: null,
        },
        3,
        0,
      );
      expect(result.topicSummary).toBeTruthy();
    });
  });
});
