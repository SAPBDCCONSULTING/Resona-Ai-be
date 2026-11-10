import { SURVEY_RESPONSE_TYPES } from '@pulsefeedback/shared';
import {
  CORE_PACK,
  DRAFT_PACKS,
  SYSTEM_SESSION_TEMPLATES,
} from './system-templates';
import { normalizeTemplateTopics } from './templates.service';

describe('SYSTEM_SESSION_TEMPLATES', () => {
  it('contains 50 templates with unique names', () => {
    const names = SYSTEM_SESSION_TEMPLATES.map((t) => t.name);
    expect(names).toHaveLength(50);
    expect(new Set(names).size).toBe(50);
  });

  it('publishes exactly the 12 core templates', () => {
    const published = SYSTEM_SESSION_TEMPLATES.filter(
      (t) => t.status === 'published',
    );
    expect(published).toHaveLength(12);
    expect(published.every((t) => t.pack === CORE_PACK)).toBe(true);
  });

  it('ships every other template as a draft in a themed pack', () => {
    const drafts = SYSTEM_SESSION_TEMPLATES.filter((t) => t.pack !== CORE_PACK);
    expect(drafts).toHaveLength(38);
    for (const t of drafts) {
      expect(t.status).toBe('draft');
      expect(DRAFT_PACKS).toContain(t.pack);
    }
    // No empty packs.
    for (const pack of DRAFT_PACKS) {
      expect(drafts.some((t) => t.pack === pack)).toBe(true);
    }
  });

  it.each(SYSTEM_SESSION_TEMPLATES.map((t) => [t.name, t] as const))(
    '%s has complete metadata',
    (_name, t) => {
      expect(t.description).toBeTruthy();
      expect(t.goalPrompt).toBeTruthy();
      expect(t.category).toBeTruthy();
      expect(t.tags.length).toBeGreaterThan(0);
      expect(t.audience).toBeTruthy();
      expect(t.rolloutSuggestion).toBeTruthy();
      expect(t.estimatedDurationMinutes).toBeGreaterThan(0);
      expect(t.topics.length).toBeGreaterThan(0);
      t.topics.forEach((topic, i) => {
        expect(topic.id).toBe(`t${i + 1}`);
        expect(topic.order).toBe(i + 1);
      });
    },
  );

  it('gives every survey question a valid response type', () => {
    const surveys = SYSTEM_SESSION_TEMPLATES.filter(
      (t) => t.sessionType === 'survey',
    );
    for (const topic of surveys.flatMap((t) => t.topics)) {
      expect(SURVEY_RESPONSE_TYPES).toContain(topic.responseType);
      if (topic.responseType === 'multiple_choice') {
        expect(topic.options!.length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('leaves 1:1 topics without survey response settings', () => {
    const topics = SYSTEM_SESSION_TEMPLATES.filter(
      (t) => t.sessionType === 'one_on_one',
    ).flatMap((t) => t.topics);
    for (const topic of topics) {
      expect(topic.responseType).toBeUndefined();
      expect(topic.options).toBeUndefined();
    }
  });

  it('passes the same topic validation as user templates', () => {
    for (const t of SYSTEM_SESSION_TEMPLATES) {
      expect(normalizeTemplateTopics(t.topics, t.sessionType)).toEqual(
        t.topics,
      );
    }
  });
});
