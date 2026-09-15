import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { ReportTemplate as TemplateDto, SessionType } from '@pulsefeedback/shared';
import { ReportTemplate, ReportTemplateDocument } from '../schemas/report-template.schema';

@Injectable()
export class TemplatesService {
  constructor(
    @InjectModel(ReportTemplate.name)
    private readonly templates: Model<ReportTemplateDocument>,
  ) {}

  async list(orgId: string, sessionType?: SessionType) {
    const filter: Record<string, unknown> = {
      $or: [{ orgId: null }, { orgId: new Types.ObjectId(orgId) }],
    };
    const docs = await this.templates.find(filter).sort({ name: 1 }).lean();
    let items = docs.map((d) => this.toDto(d));
    if (sessionType) {
      items = items.filter((t) => t.sessionTypes.includes(sessionType));
    }
    return { items };
  }

  private toDto(d: Record<string, unknown>): TemplateDto {
    return {
      id: String(d._id),
      orgId: d.orgId ? String(d.orgId) : null,
      name: String(d.name),
      description: String(d.description ?? ''),
      kind: d.kind as TemplateDto['kind'],
      sessionTypes: (d.sessionTypes as SessionType[]) ?? ['one_on_one', 'survey'],
    };
  }
}
