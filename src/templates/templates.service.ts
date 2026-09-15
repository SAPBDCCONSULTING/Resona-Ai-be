import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type {
  ReportTemplate as ReportTemplateDto,
  SessionTemplate as SessionTemplateDto,
  SessionTopic,
  SessionType,
} from '@pulsefeedback/shared';
import {
  ReportTemplate,
  ReportTemplateDocument,
} from '../schemas/report-template.schema';
import {
  SessionTemplate,
  SessionTemplateDocument,
} from '../schemas/session-template.schema';

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
    const docs = await this.reportTemplates.find(filter).sort({ name: 1 }).lean();
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

  async listSessionTemplates(orgId: string, sessionType?: SessionType) {
    const filter: Record<string, unknown> = {
      $or: [{ orgId: null }, { orgId: new Types.ObjectId(orgId) }],
    };
    if (sessionType) filter.sessionType = sessionType;
    const docs = await this.sessionTemplates.find(filter).sort({ name: 1 }).lean();
    return { items: docs.map((d) => this.toSessionDto(d)) };
  }

  async createSessionTemplate(
    orgId: string,
    input: {
      name: string;
      description?: string;
      sessionType: SessionType;
      goalPrompt?: string | null;
      topics?: SessionTopic[];
      tone?: string | null;
    },
  ) {
    const doc = await this.sessionTemplates.create({
      orgId: new Types.ObjectId(orgId),
      name: input.name.trim(),
      description: input.description?.trim() ?? '',
      sessionType: input.sessionType,
      goalPrompt: input.goalPrompt ?? null,
      topics: (input.topics ?? []).map((t, i) => ({
        id: t.id || `t${i + 1}`,
        title: t.title,
        order: t.order ?? i + 1,
      })),
      tone: input.tone ?? null,
    });
    return this.toSessionDto(doc.toObject() as unknown as Record<string, unknown>);
  }

  private toReportDto(d: Record<string, unknown>): ReportTemplateDto {
    return {
      id: String(d._id),
      orgId: d.orgId ? String(d.orgId) : null,
      name: String(d.name),
      description: String(d.description ?? ''),
      kind: d.kind as ReportTemplateDto['kind'],
      sessionTypes: (d.sessionTypes as SessionType[]) ?? ['one_on_one', 'survey'],
    };
  }

  private toSessionDto(d: Record<string, unknown>): SessionTemplateDto {
    return {
      id: String(d._id),
      orgId: d.orgId ? String(d.orgId) : null,
      name: String(d.name),
      description: String(d.description ?? ''),
      sessionType: d.sessionType as SessionType,
      goalPrompt: (d.goalPrompt as string | null) ?? null,
      topics: Array.isArray(d.topics) ? (d.topics as SessionTopic[]) : [],
      tone: (d.tone as string | null) ?? null,
      createdAt:
        d.createdAt instanceof Date ? d.createdAt.toISOString() : new Date().toISOString(),
    };
  }
}
