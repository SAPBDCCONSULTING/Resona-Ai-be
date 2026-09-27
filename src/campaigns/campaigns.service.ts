import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type {
  Campaign as CampaignDto,
  CampaignDetail,
  CampaignListResponse,
  FeedbackSession,
  HealthStatus,
  LinkedSequenceStep,
  SessionTopic,
  SessionType,
} from '@pulsefeedback/shared';
import {
  Campaign,
  CampaignDocument,
  Session,
  SessionDocument,
} from '../schemas/session.schema';
import {
  SessionTemplate,
  SessionTemplateDocument,
} from '../schemas/session-template.schema';
import {
  CreateCampaignDto,
  LaunchCampaignDto,
  UpdateCampaignDto,
} from './dto/campaign.dto';

export type Actor = {
  userId: string;
  orgId: string;
  name: string;
};

@Injectable()
export class CampaignsService {
  constructor(
    @InjectModel(Campaign.name) private readonly campaigns: Model<CampaignDocument>,
    @InjectModel(Session.name) private readonly sessions: Model<SessionDocument>,
    @InjectModel(SessionTemplate.name)
    private readonly templates: Model<SessionTemplateDocument>,
  ) {}

  async list(orgId: string): Promise<CampaignListResponse> {
    const docs = await this.campaigns
      .find({ orgId: new Types.ObjectId(orgId) })
      .sort({ updatedAt: -1 })
      .limit(100)
      .lean();
    const items = docs.map((d) => this.toDto(d));
    return {
      items,
      columns: {
        recurring: items.filter((c) => c.type === 'recurring'),
        linked: items.filter((c) => c.type === 'linked'),
        independent: items.filter((c) => c.type === 'independent'),
      },
    };
  }

  async getOne(orgId: string, id: string): Promise<CampaignDetail> {
    const doc = await this.campaigns
      .findOne({ _id: id, orgId: new Types.ObjectId(orgId) })
      .lean();
    if (!doc) throw new NotFoundException('Campaign not found');
    const sessions = await this.sessions
      .find({ orgId: new Types.ObjectId(orgId), campaignId: new Types.ObjectId(id) })
      .sort({ startAt: 1, createdAt: 1 })
      .lean();
    return {
      ...this.toDto(doc),
      sessions: sessions.map((s) => this.sessionToDto(s)),
    };
  }

  async create(actor: Actor, dto: CreateCampaignDto): Promise<CampaignDetail> {
    const title = dto.title.trim();
    if (!title) throw new BadRequestException('Title is required');
    if (dto.type === 'linked' && dto.linkedSequence?.some((s) => !s.title?.trim())) {
      throw new BadRequestException('Each linked step requires a title');
    }

    const sessionCount =
      dto.type === 'linked' && dto.linkedSequence?.length
        ? dto.linkedSequence.length
        : (dto.sessionCount ?? (dto.type === 'recurring' ? 3 : dto.type === 'linked' ? 2 : 1));
    const sessionType: SessionType = dto.sessionType ?? 'survey';

    let topics: SessionTopic[] = [];
    let goalPrompt: string | null = null;
    let tone: string | null = null;
    let templateId: Types.ObjectId | null = null;

    if (dto.sessionTemplateId) {
      const tpl = await this.templates
        .findOne({
          _id: dto.sessionTemplateId,
          $or: [{ orgId: null }, { orgId: new Types.ObjectId(actor.orgId) }],
        })
        .lean();
      if (!tpl) throw new NotFoundException('Session template not found');
      topics = Array.isArray(tpl.topics)
        ? (tpl.topics as SessionTopic[]).map((t, i) => ({
            id: t.id || `t${i + 1}`,
            title: t.title,
            order: t.order ?? i + 1,
          }))
        : [];
      goalPrompt = (tpl.goalPrompt as string | null) ?? null;
      tone = (tpl.tone as string | null) ?? null;
      templateId = tpl._id as Types.ObjectId;
    }

    const linkedSequence: LinkedSequenceStep[] =
      dto.type === 'linked' && dto.linkedSequence?.length
        ? dto.linkedSequence.map((s, i) => ({
            id: s.id || `step${i + 1}`,
            title: s.title,
            order: s.order ?? i + 1,
          }))
        : [];

    const linkedSteps: LinkedSequenceStep[] =
      linkedSequence.length > 0 ? [...linkedSequence].sort((a, b) => a.order - b.order) : [];

    const campaign = await this.campaigns.create({
      orgId: new Types.ObjectId(actor.orgId),
      title,
      type: dto.type,
      status: 'draft',
      startAt: dto.startAt ? new Date(dto.startAt) : null,
      endAt: dto.endAt ? new Date(dto.endAt) : null,
      createdBy: new Types.ObjectId(actor.userId),
      createdByName: actor.name,
      cadence: dto.cadence ?? (dto.type === 'recurring' ? 'monthly' : null),
      recurringMode:
        dto.type === 'recurring' ? (dto.recurringMode ?? 'unlinked') : null,
      masterPrompt: dto.type === 'linked' ? (dto.masterPrompt ?? null) : null,
      linkedSequence,
      sessionTemplateId: templateId,
      sessionsCompleted: 0,
      sessionsTotal: sessionCount,
      percent: 0,
      health: 'no_schedule' as HealthStatus,
    });

    const baseStart = dto.startAt ? new Date(dto.startAt) : new Date();
    const windowMs = 14 * 24 * 60 * 60 * 1000;
    const sessionDocs = [];

    for (let i = 0; i < sessionCount; i++) {
      const startAt = new Date(baseStart.getTime() + i * windowMs);
      const endAt = new Date(startAt.getTime() + windowMs - 24 * 60 * 60 * 1000);
      const linkedStep = linkedSteps[i];
      const label =
        dto.type === 'recurring'
          ? `${title} — Round ${i + 1}`
          : linkedStep
            ? `${title} — ${linkedStep.title}`
            : sessionCount > 1
              ? `${title} — Session ${i + 1}`
              : title;
      sessionDocs.push({
        orgId: new Types.ObjectId(actor.orgId),
        title: label,
        type: sessionType,
        status: 'draft' as const,
        startAt,
        endAt,
        createdBy: new Types.ObjectId(actor.userId),
        createdByName: actor.name,
        campaignId: campaign._id,
        progress: { invited: 0, completed: 0, percent: 0, health: 'no_schedule' },
        favorite: false,
        topics: topics.length
          ? topics
          : [
              { id: 't1', title: 'Opening check-in', order: 1 },
              { id: 't2', title: 'Core feedback', order: 2 },
              { id: 't3', title: 'Next steps', order: 3 },
            ],
        goalPrompt: goalPrompt ?? `Feedback for ${title}`,
        wizardStep: 'schedule',
        entryMode: 'blank',
        tone,
        reportTemplateId: null,
        participantIds: [],
      });
    }

    if (sessionDocs.length) {
      await this.sessions.insertMany(sessionDocs);
    }

    await this.recomputeRollup(actor.orgId, String(campaign._id));
    return this.getOne(actor.orgId, String(campaign._id));
  }

  async update(
    orgId: string,
    id: string,
    dto: UpdateCampaignDto,
  ): Promise<CampaignDetail> {
    const updates: Record<string, unknown> = {};
    if (dto.title !== undefined) updates.title = dto.title.trim() || 'Untitled campaign';
    if (dto.cadence !== undefined) updates.cadence = dto.cadence;
    if (dto.recurringMode !== undefined) updates.recurringMode = dto.recurringMode;
    if (dto.masterPrompt !== undefined) updates.masterPrompt = dto.masterPrompt;
    if (dto.linkedSequence !== undefined) {
      updates.linkedSequence = dto.linkedSequence.map((s, i) => ({
        id: s.id || `step${i + 1}`,
        title: s.title,
        order: s.order ?? i + 1,
      }));
    }
    if (dto.startAt !== undefined) updates.startAt = dto.startAt ? new Date(dto.startAt) : null;
    if (dto.endAt !== undefined) updates.endAt = dto.endAt ? new Date(dto.endAt) : null;
    if (dto.status !== undefined) updates.status = dto.status;
    if (dto.sessionTemplateId !== undefined) {
      updates.sessionTemplateId = dto.sessionTemplateId
        ? new Types.ObjectId(dto.sessionTemplateId)
        : null;
    }

    const doc = await this.campaigns
      .findOneAndUpdate(
        { _id: id, orgId: new Types.ObjectId(orgId) },
        { $set: updates },
        { new: true },
      )
      .lean();
    if (!doc) throw new NotFoundException('Campaign not found');
    return this.getOne(orgId, id);
  }

  async launch(
    orgId: string,
    id: string,
    dto: LaunchCampaignDto,
  ): Promise<CampaignDetail> {
    const detail = await this.getOne(orgId, id);
    if (!detail.title?.trim()) {
      throw new BadRequestException('Title is required before launch');
    }
    if (detail.sessionsTotal < 1) {
      throw new BadRequestException('Campaign has no sessions to launch');
    }

    const startAt = dto.startAt ?? detail.startAt ?? new Date().toISOString();
    const endAt =
      dto.endAt ??
      detail.endAt ??
      new Date(Date.now() + detail.sessionsTotal * 14 * 24 * 60 * 60 * 1000).toISOString();

    await this.campaigns.updateOne(
      { _id: id, orgId: new Types.ObjectId(orgId) },
      {
        $set: {
          status: 'ongoing',
          startAt: new Date(startAt),
          endAt: new Date(endAt),
          health: 'on_track',
        },
      },
    );

    const childSessions = await this.sessions
      .find({ orgId: new Types.ObjectId(orgId), campaignId: new Types.ObjectId(id) })
      .sort({ startAt: 1, createdAt: 1 });

    const base = new Date(startAt).getTime();
    const windowMs = 14 * 24 * 60 * 60 * 1000;
    for (let i = 0; i < childSessions.length; i++) {
      const s = childSessions[i];
      const sStart = new Date(base + i * windowMs);
      const sEnd = new Date(sStart.getTime() + windowMs - 24 * 60 * 60 * 1000);
      s.status = i === 0 ? 'ongoing' : 'scheduled';
      s.startAt = sStart;
      s.endAt = sEnd;
      s.progress = {
        ...s.progress,
        health: i === 0 ? 'on_track' : 'no_schedule',
      };
      await s.save();
    }

    await this.recomputeRollup(orgId, id);
    return this.getOne(orgId, id);
  }

  async recomputeRollup(orgId: string, campaignId: string): Promise<void> {
    const sessions = await this.sessions
      .find({
        orgId: new Types.ObjectId(orgId),
        campaignId: new Types.ObjectId(campaignId),
      })
      .lean();

    const sessionsTotal = sessions.length;
    const sessionsCompleted = sessions.filter((s) => s.status === 'completed').length;
    const percent =
      sessionsTotal === 0 ? 0 : Math.round((sessionsCompleted / sessionsTotal) * 100);

    let health: HealthStatus = 'no_schedule';
    if (sessionsTotal === 0) health = 'no_schedule';
    else if (sessionsCompleted === sessionsTotal) health = 'done';
    else if (sessions.some((s) => s.progress?.health === 'behind')) health = 'behind';
    else if (sessions.some((s) => s.status === 'ongoing' || s.status === 'scheduled')) {
      health = 'on_track';
    }

    await this.campaigns.updateOne(
      { _id: campaignId, orgId: new Types.ObjectId(orgId) },
      { $set: { sessionsTotal, sessionsCompleted, percent, health } },
    );
  }

  private toDto(d: Record<string, unknown>): CampaignDto {
    const createdAt =
      d.createdAt instanceof Date ? d.createdAt.toISOString() : new Date().toISOString();
    const updatedAt = d.updatedAt instanceof Date ? d.updatedAt.toISOString() : createdAt;
    return {
      id: String(d._id),
      orgId: String(d.orgId),
      title: String(d.title),
      type: d.type as CampaignDto['type'],
      status: d.status as CampaignDto['status'],
      startAt: d.startAt instanceof Date ? d.startAt.toISOString() : null,
      endAt: d.endAt instanceof Date ? d.endAt.toISOString() : null,
      createdBy: String(d.createdBy),
      createdByName: String(d.createdByName ?? ''),
      cadence: (d.cadence as string | null) ?? null,
      recurringMode: (d.recurringMode as CampaignDto['recurringMode']) ?? null,
      masterPrompt: (d.masterPrompt as string | null) ?? null,
      linkedSequence: Array.isArray(d.linkedSequence)
        ? (d.linkedSequence as LinkedSequenceStep[])
        : [],
      sessionTemplateId: d.sessionTemplateId ? String(d.sessionTemplateId) : null,
      sessionsCompleted: Number(d.sessionsCompleted ?? 0),
      sessionsTotal: Number(d.sessionsTotal ?? 0),
      percent: Number(d.percent ?? 0),
      health: (d.health as HealthStatus) ?? 'no_schedule',
      createdAt,
      updatedAt,
    };
  }

  private sessionToDto(d: Record<string, unknown>): FeedbackSession {
    const progress = (d.progress as FeedbackSession['progress']) ?? {
      invited: 0,
      completed: 0,
      percent: 0,
      health: 'no_schedule' as const,
    };
    const createdAt =
      d.createdAt instanceof Date ? d.createdAt.toISOString() : new Date().toISOString();
    const updatedAt = d.updatedAt instanceof Date ? d.updatedAt.toISOString() : createdAt;
    return {
      id: String(d._id),
      orgId: String(d.orgId),
      title: String(d.title),
      type: d.type as FeedbackSession['type'],
      status: d.status as FeedbackSession['status'],
      startAt: d.startAt instanceof Date ? d.startAt.toISOString() : null,
      endAt: d.endAt instanceof Date ? d.endAt.toISOString() : null,
      createdBy: String(d.createdBy),
      createdByName: String(d.createdByName ?? ''),
      campaignId: d.campaignId ? String(d.campaignId) : null,
      progress,
      favorite: Boolean(d.favorite),
      participantCount: progress.invited,
      topics: Array.isArray(d.topics) ? (d.topics as FeedbackSession['topics']) : [],
      goalPrompt: (d.goalPrompt as string | null) ?? null,
      wizardStep: (d.wizardStep as FeedbackSession['wizardStep']) ?? 'choose_type',
      entryMode: (d.entryMode as FeedbackSession['entryMode']) ?? 'blank',
      tone: (d.tone as string | null) ?? null,
      reportTemplateId: (d.reportTemplateId as string | null) ?? null,
      participantIds: Array.isArray(d.participantIds)
        ? (d.participantIds as string[])
        : [],
      createdAt,
      updatedAt,
    };
  }
}
