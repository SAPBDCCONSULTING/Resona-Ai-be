import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import type {
  CreateSessionTemplateInput,
  DuplicateSessionTemplateInput,
  ReportTemplate as ReportTemplateDto,
  SessionTemplate as SessionTemplateDto,
  SessionTemplateStatus,
  SessionTemplateVisibility,
  SessionTopic,
  SessionType,
  UpdateSessionTemplateInput,
} from '@pulsefeedback/shared';
import {
  ReportTemplate,
  ReportTemplateDocument,
} from '../schemas/report-template.schema';
import {
  SessionTemplate,
  SessionTemplateDocument,
} from '../schemas/session-template.schema';

export type TemplateActor = { orgId: string; userId: string };

/** Incoming topic — `order` is optional and filled from position. */
export type TemplateTopicInput = Omit<SessionTopic, 'order'> & {
  order?: number;
};
type WithTopicInput<T> = Omit<T, 'topics'> & { topics?: TemplateTopicInput[] };

export interface ListSessionTemplatesFilter {
  sessionType?: SessionType;
  /** Defaults to `published`; `all` returns every status. */
  status?: SessionTemplateStatus | 'all';
  visibility?: SessionTemplateVisibility;
  category?: string;
  pack?: string;
  tag?: string;
  search?: string;
}

/** Reads a string field from a lean document, with a fallback. */
const str = (v: unknown, fallback = ''): string =>
  typeof v === 'string' ? v : fallback;
/** Stringifies an ObjectId-like value (or returns null when unset). */
const idStr = (v: unknown): string | null =>
  v ? (v as Types.ObjectId).toString() : null;

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Documents created before metadata existed have no status — treat as published. */
const PUBLISHED_FILTER: FilterQuery<SessionTemplateDocument> = {
  $or: [{ status: 'published' }, { status: { $exists: false } }],
};

/**
 * Templates the actor may see: system templates, their org's shared
 * templates, and private templates they created themselves.
 */
export function sessionTemplateAccessFilter(
  actor: TemplateActor,
): FilterQuery<SessionTemplateDocument> {
  const orgId = new Types.ObjectId(actor.orgId);
  const own: FilterQuery<SessionTemplateDocument>[] = Types.ObjectId.isValid(
    actor.userId,
  )
    ? [
        {
          orgId,
          visibility: 'private',
          createdBy: new Types.ObjectId(actor.userId),
        },
      ]
    : [];
  return {
    $or: [{ orgId: null }, { orgId, visibility: { $ne: 'private' } }, ...own],
  };
}

/**
 * Cleans topics for storage: assigns ids/order, keeps survey response
 * settings only for surveys, and checks options make sense for the type.
 */
export function normalizeTemplateTopics(
  topics: TemplateTopicInput[] | undefined,
  sessionType: SessionType,
): SessionTopic[] {
  return (topics ?? []).map((t, i) => {
    const topic: SessionTopic = {
      id: t.id || `t${i + 1}`,
      title: t.title.trim(),
      order: t.order ?? i + 1,
    };
    if (sessionType !== 'survey' || !t.responseType) return topic;

    topic.responseType = t.responseType;
    const options = [
      ...new Set((t.options ?? []).map((o) => o.trim()).filter(Boolean)),
    ];
    if (t.responseType === 'multiple_choice' && options.length < 2) {
      throw new BadRequestException(
        `Topic "${topic.title}" is multiple choice and needs at least 2 options`,
      );
    }
    if (t.responseType === 'scale' && options.length === 1) {
      throw new BadRequestException(
        `Topic "${topic.title}" scale labels need at least 2 options`,
      );
    }
    // Text and yes/no answers have fixed formats, so options don't apply.
    if (
      (t.responseType === 'multiple_choice' || t.responseType === 'scale') &&
      options.length > 0
    ) {
      topic.options = options;
    }
    return topic;
  });
}

@Injectable()
export class TemplatesService {
  constructor(
    @InjectModel(ReportTemplate.name)
    private readonly reportTemplates: Model<ReportTemplateDocument>,
    @InjectModel(SessionTemplate.name)
    private readonly sessionTemplates: Model<SessionTemplateDocument>,
  ) {}

  async listReportTemplates(orgId: string, sessionType?: SessionType) {
    const filter: Record<string, unknown> = {
      $or: [{ orgId: null }, { orgId: new Types.ObjectId(orgId) }],
    };
    const docs = await this.reportTemplates
      .find(filter)
      .sort({ name: 1 })
      .lean();
    let items = docs.map((d) => this.toReportDto(d));
    if (sessionType) {
      items = items.filter((t) => t.sessionTypes.includes(sessionType));
    }
    return { items };
  }

  /** @deprecated alias kept for older call sites */
  async list(orgId: string, sessionType?: SessionType) {
    return this.listReportTemplates(orgId, sessionType);
  }

  async listSessionTemplates(
    actor: TemplateActor,
    query: ListSessionTemplatesFilter = {},
  ) {
    const and: FilterQuery<SessionTemplateDocument>[] = [
      sessionTemplateAccessFilter(actor),
    ];
    const status = query.status ?? 'published';
    if (status === 'published') and.push(PUBLISHED_FILTER);
    else if (status !== 'all') and.push({ status });

    if (query.visibility === 'system') {
      and.push({ orgId: null });
    } else if (query.visibility === 'organization') {
      and.push({ orgId: { $ne: null }, visibility: { $ne: 'private' } });
    } else if (query.visibility === 'private') {
      and.push({ visibility: 'private' });
    }
    if (query.sessionType) and.push({ sessionType: query.sessionType });
    if (query.category) and.push({ category: query.category });
    if (query.pack) and.push({ pack: query.pack });
    if (query.tag) and.push({ tags: query.tag });
    if (query.search?.trim()) {
      const re = new RegExp(escapeRegex(query.search.trim()), 'i');
      and.push({ $or: [{ name: re }, { description: re }, { tags: re }] });
    }

    const docs = await this.sessionTemplates
      .find({ $and: and })
      .sort({ name: 1 })
      .lean();
    return { items: docs.map((d) => this.toSessionDto(d)) };
  }

  async getSessionTemplate(actor: TemplateActor, id: string) {
    const doc = await this.findAccessible(actor, id);
    return this.toSessionDto(doc);
  }

  async createSessionTemplate(
    actor: TemplateActor,
    input: WithTopicInput<CreateSessionTemplateInput>,
  ) {
    const doc = await this.sessionTemplates.create({
      orgId: new Types.ObjectId(actor.orgId),
      name: input.name.trim(),
      description: input.description?.trim() ?? '',
      sessionType: input.sessionType,
      goalPrompt: input.goalPrompt ?? null,
      topics: normalizeTemplateTopics(input.topics, input.sessionType),
      tone: input.tone ?? null,
      category: input.category?.trim() || 'Other',
      tags: input.tags ?? [],
      audience: input.audience?.trim() ?? '',
      estimatedDurationMinutes: input.estimatedDurationMinutes ?? 15,
      visibility: input.visibility ?? 'organization',
      createdBy: this.userObjectId(actor),
      // Published by default so new outlines appear in the session wizard.
      status: input.status ?? 'published',
      rolloutSuggestion: input.rolloutSuggestion?.trim() ?? '',
      version: 1,
    });
    return this.toSessionDto(
      doc.toObject() as unknown as Record<string, unknown>,
    );
  }

  async updateSessionTemplate(
    actor: TemplateActor,
    id: string,
    input: WithTopicInput<UpdateSessionTemplateInput>,
  ) {
    const existing = await this.findAccessible(actor, id);
    if (existing.orgId === null || existing.orgId === undefined) {
      throw new ForbiddenException(
        'System templates are read-only. Duplicate the template to customize it.',
      );
    }

    const updates: Record<string, unknown> = {};
    if (input.name !== undefined) updates.name = input.name.trim();
    if (input.description !== undefined) {
      updates.description = input.description.trim();
    }
    if (input.sessionType !== undefined) {
      updates.sessionType = input.sessionType;
    }
    if (input.goalPrompt !== undefined) updates.goalPrompt = input.goalPrompt;
    if (input.tone !== undefined) updates.tone = input.tone;
    if (input.category !== undefined) {
      updates.category = input.category.trim() || 'Other';
    }
    if (input.tags !== undefined) updates.tags = input.tags;
    if (input.audience !== undefined) updates.audience = input.audience.trim();
    if (input.estimatedDurationMinutes !== undefined) {
      updates.estimatedDurationMinutes = input.estimatedDurationMinutes;
    }
    if (input.visibility !== undefined) updates.visibility = input.visibility;
    if (input.status !== undefined) updates.status = input.status;
    if (input.rolloutSuggestion !== undefined) {
      updates.rolloutSuggestion = input.rolloutSuggestion.trim();
    }
    // Re-check topics when either they or the session type change.
    if (input.topics !== undefined || input.sessionType !== undefined) {
      updates.topics = normalizeTemplateTopics(
        input.topics ?? (existing.topics as SessionTopic[]),
        input.sessionType ?? (existing.sessionType as SessionType),
      );
    }
    if (Object.keys(updates).length === 0) return this.toSessionDto(existing);

    const doc = await this.sessionTemplates
      .findOneAndUpdate(
        { _id: existing._id, orgId: existing.orgId },
        { $set: updates, $inc: { version: 1 } },
        { new: true },
      )
      .lean();
    if (!doc) throw new NotFoundException('Session template not found');
    return this.toSessionDto(doc);
  }

  /** Copies any visible template (system ones included) into the actor's org. */
  async duplicateSessionTemplate(
    actor: TemplateActor,
    id: string,
    input: DuplicateSessionTemplateInput = {},
  ) {
    const src = await this.findAccessible(actor, id);
    const sessionType = src.sessionType as SessionType;
    const doc = await this.sessionTemplates.create({
      orgId: new Types.ObjectId(actor.orgId),
      name: input.name?.trim() || `${str(src.name)} (copy)`,
      description: str(src.description),
      sessionType,
      goalPrompt: (src.goalPrompt as string | null) ?? null,
      topics: normalizeTemplateTopics(
        Array.isArray(src.topics) ? (src.topics as SessionTopic[]) : [],
        sessionType,
      ),
      tone: (src.tone as string | null) ?? null,
      category: (src.category as string | undefined) ?? 'Other',
      tags: Array.isArray(src.tags) ? (src.tags as string[]) : [],
      audience: (src.audience as string | undefined) ?? '',
      estimatedDurationMinutes:
        (src.estimatedDurationMinutes as number | undefined) ?? 15,
      visibility: input.visibility ?? 'organization',
      createdBy: this.userObjectId(actor),
      status: input.status ?? 'draft',
      rolloutSuggestion: (src.rolloutSuggestion as string | undefined) ?? '',
      sourceTemplateId: src._id as Types.ObjectId,
      version: 1,
    });
    return this.toSessionDto(
      doc.toObject() as unknown as Record<string, unknown>,
    );
  }

  private async findAccessible(
    actor: TemplateActor,
    id: string,
  ): Promise<Record<string, unknown>> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Session template not found');
    }
    const doc = await this.sessionTemplates
      .findOne({
        $and: [
          { _id: new Types.ObjectId(id) },
          sessionTemplateAccessFilter(actor),
        ],
      })
      .lean();
    if (!doc) throw new NotFoundException('Session template not found');
    return doc;
  }

  private userObjectId(actor: TemplateActor): Types.ObjectId | null {
    return Types.ObjectId.isValid(actor.userId)
      ? new Types.ObjectId(actor.userId)
      : null;
  }

  private toReportDto(d: Record<string, unknown>): ReportTemplateDto {
    return {
      id: String(d._id),
      orgId: d.orgId ? String(d.orgId) : null,
      name: String(d.name),
      description: String(d.description ?? ''),
      kind: d.kind as ReportTemplateDto['kind'],
      sessionTypes: (d.sessionTypes as SessionType[]) ?? [
        'one_on_one',
        'survey',
      ],
    };
  }

  /** Fills defaults for documents created before metadata fields existed. */
  toSessionDto(d: Record<string, unknown>): SessionTemplateDto {
    const isSystem = !d.orgId;
    const toIso = (v: unknown) => (v instanceof Date ? v.toISOString() : null);
    const createdAt = toIso(d.createdAt) ?? new Date().toISOString();
    return {
      id: idStr(d._id) ?? '',
      orgId: isSystem ? null : idStr(d.orgId),
      name: str(d.name),
      description: str(d.description),
      sessionType: d.sessionType as SessionType,
      goalPrompt: (d.goalPrompt as string | null) ?? null,
      topics: Array.isArray(d.topics) ? (d.topics as SessionTopic[]) : [],
      tone: (d.tone as string | null) ?? null,
      createdAt,
      category: (d.category as string | undefined) ?? 'Other',
      tags: Array.isArray(d.tags) ? (d.tags as string[]) : [],
      audience: (d.audience as string | undefined) ?? '',
      estimatedDurationMinutes:
        (d.estimatedDurationMinutes as number | undefined) ?? 15,
      visibility: isSystem
        ? 'system'
        : ((d.visibility as SessionTemplateVisibility | undefined) ??
          'organization'),
      createdBy: idStr(d.createdBy),
      updatedAt: toIso(d.updatedAt) ?? createdAt,
      version: (d.version as number | undefined) ?? 1,
      status: (d.status as SessionTemplateStatus | undefined) ?? 'published',
      rolloutSuggestion: (d.rolloutSuggestion as string | undefined) ?? '',
      pack: (d.pack as string | null | undefined) ?? null,
      sourceTemplateId: idStr(d.sourceTemplateId),
      readOnly: isSystem,
    };
  }
}
